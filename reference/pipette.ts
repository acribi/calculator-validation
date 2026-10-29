// Reference implementation copied from the acribi.com calculators (website/src/lib/pipette.ts).
// Pure calculation code, no UI. MIT License, see LICENSE.

// Gravimetric pipette calibration (ISO 8655-6 style): convert the balance
// readings of water delivered by a pipette into volumes, then compute the mean
// volume, the systematic error and the random error (standard deviation and CV).
// Pure functions, used at build time by the pipette page components and in the
// browser by the PipetteCalculator tool.
//
// Formulas and constants:
// - Water density: Tanaka et al. (Metrologia 38, 2001), as given in NIST IR 7383
//   (2019) GLP 10 Eqn. 1 and EURAMET cg-19 v4.1 Eqn. (2), with the air-saturation
//   correction of GLP 10 Eqn. 3 / cg-19 Eqn. (3).
// - Air density: simplified CIPM formula, EURAMET cg-19 v4.1 Eqn. (4)
//   (valid 600–1100 hPa, 15–27 °C, 20–80 % RH).
// - Mass to volume: cg-19 Eqn. (1) / ISO 4787; the Z factor is the same
//   expression without the thermal-expansion term:
//   Z = 1 / (ρW − ρA) · (1 − ρA / ρB), with ρB = 8.0 g/mL (reference weights).
// Validated by the cases in cases/ against NIST GLP 10 Table 2, a published
// Z table (Eppendorf SOP, 15–30 °C, 800–1050 hPa), DKD-R 8-1 Appendix B and
// EURAMET cg-19 Example 1.
import { mean, stdev } from './test-points.ts';

/** Density of pure water in g/mL at temperature t (°C), Tanaka formula. */
export function waterDensity(t: number, airSaturated = true): number {
  const a1 = -3.983035, a2 = 301.797, a3 = 522528.9, a4 = 69.34881, a5 = 999.97495; // kg/m³
  let rho = a5 * (1 - ((t + a1) ** 2 * (t + a2)) / (a3 * (t + a4)));
  if (airSaturated) rho += (-4.612 + 0.106 * t) / 1000; // s0 + s1·t, in 10⁻³ kg/m³
  return rho / 1000;
}

/** Air density in g/mL: t in °C, p in hPa, rh in % (simplified CIPM, cg-19 Eqn. 4). */
export function airDensity(t: number, p: number, rh: number): number {
  return (0.34848 * p - 0.009 * rh * Math.exp(0.061 * t)) / (t + 273.15) / 1000;
}

export interface Conditions {
  /** Water temperature, °C. */
  waterTemp: number;
  /** Air temperature, °C (defaults to the water temperature). */
  airTemp?: number;
  /** Barometric pressure, hPa. */
  pressure: number;
  /** Relative humidity, % (defaults to 50). */
  humidity?: number;
  /** Density of the reference weights, g/mL (defaults to 8.0). */
  weightDensity?: number;
  /** Use air-saturated water density (default true, the usual lab condition). */
  airSaturated?: boolean;
}

/** Z factor in µL/mg (numerically the same as mL/g). */
export function zFactor(c: Conditions): number {
  const rhoA = airDensity(c.airTemp ?? c.waterTemp, c.pressure, c.humidity ?? 50);
  const rhoW = waterDensity(c.waterTemp, c.airSaturated ?? true);
  const rhoB = c.weightDensity ?? 8.0;
  return (1 / (rhoW - rhoA)) * (1 - rhoA / rhoB);
}

/**
 * Volume at a reference temperature (cg-19 Eqn. 1): mass difference in g → mL
 * (or mg → µL). gamma is the cubic expansion coefficient of the instrument (1/°C);
 * leave it at 0 for piston pipettes, as DKD-R 8-1 §8.6 does.
 */
export function volumeFromMass(mass: number, c: Conditions, gamma = 0, tRef = 20): number {
  return mass * zFactor(c) * (1 - gamma * (c.waterTemp - tRef));
}

export interface SeriesResult {
  selected: number;
  volumes: number[];
  mean: number;
  /** Systematic error es = mean − selected (same unit as the volumes). */
  systematic: number;
  /** Systematic error in % of the selected volume. */
  systematicPct: number;
  /** Repeatability standard deviation sr (n − 1). */
  sd: number;
  /** Coefficient of variation CV = 100 · sr / mean, in %. */
  cv: number;
  n: number;
}

/**
 * Evaluates one test volume. masses in mg (balance readings of each delivery);
 * evaporationPerCycle in mg is added to each reading, as an evaporation
 * correction determined beforehand (ISO 8655-6 9.1–9.2 principle).
 */
export function evaluateSeries(selected: number, masses: number[], c: Conditions, evaporationPerCycle = 0): SeriesResult {
  const z = zFactor(c);
  const volumes = masses.map((m) => (m + evaporationPerCycle) * z);
  return seriesFromVolumes(selected, volumes);
}

export function seriesFromVolumes(selected: number, volumes: number[]): SeriesResult {
  const m = mean(volumes);
  const sd = stdev(volumes);
  return {
    selected, volumes, mean: m, systematic: m - selected,
    systematicPct: ((m - selected) / selected) * 100,
    sd, cv: (sd / m) * 100, n: volumes.length,
  };
}

export interface Limits {
  /** Maximum permissible systematic error, ± % of the selected volume. */
  systematicPct: number;
  /** Maximum permissible random error, as CV in %. */
  cv: number;
}

export interface Verdict { systematicOk: boolean; cvOk: boolean; pass: boolean }

const EPS = 1e-9;
/** Simple comparison of the results with limits (limits included, no guard band). */
export function judge(r: SeriesResult, lim: Limits): Verdict {
  const systematicOk = Math.abs(r.systematicPct) <= lim.systematicPct + EPS;
  const cvOk = r.cv <= lim.cv + EPS;
  return { systematicOk, cvOk, pass: systematicOk && cvOk };
}

/** Expected balance reading (mg) for a target volume (µL): the inverse of Z. */
export function expectedMass(volume: number, c: Conditions): number {
  return volume / zFactor(c);
}
