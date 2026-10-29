// Reference implementation copied from the acribi.com calculators (website/src/lib/pressure-gauge.ts).
// Pure calculation code, no UI. MIT License, see LICENSE.

// Pressure gauge calibration: evaluation of ascending/descending readings,
// uncertainty of the deviation, error span, and the corrections applied to a
// deadweight tester (pressure balance): local gravity, liquid/gas head, thermal
// expansion and air buoyancy. Pure functions, used at build time by the
// /instruments/pressure-gauge/calibration-procedure/ page and its components.
//
// Models follow DKD-R 6-1 (03/2014, rev. 3), §8.3 and §8.6, and EURAMET cg-17
// (v4.1, 2022), §6.2.1 and §6.3 (sum/difference model, rectangular contributions
// from the full width of each interval, k = 2, error span = U + |deviation|), and
// EURAMET cg-3 (v2.1, 2025), eq. (3.1), (3.6), (3.7) for the pressure balance.
// The tests anchor every function to worked examples published in those
// documents, in 40 CFR 1065.630, in NIST SP 811 and in USBR 1040.

/** Standard acceleration of gravity, m/s² (NIST SP 811). */
export const G_STANDARD = 9.80665;

// ---------------------------------------------------------------- readings

export interface UpDownPoint {
  /** Reference pressure applied (same unit as the readings). */
  ref: number;
  /** Indication with increasing pressure. */
  up: number;
  /** Indication with decreasing pressure. */
  down: number;
  /** Reference pressure for the descending reading, if it differs from `ref`. */
  refDown?: number;
}

export interface UpDownResult {
  ref: number;
  devUp: number;      // up − ref
  devDown: number;    // down − refDown
  mean: number;       // (up + down) / 2
  devMean: number;    // mean indication − mean reference
  hysteresis: number; // |devDown − devUp| (DKD-R 6-1 Table B1: |M2 − M1|)
}

/** Deviation of the ascending, descending and mean indications, and hysteresis, at one point. */
export function evaluateUpDown(p: UpDownPoint): UpDownResult {
  const refDown = p.refDown ?? p.ref;
  const devUp = p.up - p.ref;
  const devDown = p.down - refDown;
  const mean = (p.up + p.down) / 2;
  const devMean = mean - (p.ref + refDown) / 2;
  return { ref: p.ref, devUp, devDown, mean, devMean, hysteresis: Math.abs(devDown - devUp) };
}

/** Error as a percentage of span (the way dial-gauge accuracy grades and classes are stated). */
export function percentOfSpan(error: number, span: number): number {
  if (!(span > 0)) throw new Error('Span must be positive');
  return (error / span) * 100;
}

// ------------------------------------------------------------- uncertainty

/** Standard uncertainty of a rectangular distribution of full width `width` (= 2a): a/√3. */
export function rectStd(width: number): number {
  return Math.abs(width) / (2 * Math.sqrt(3));
}

/** Root-sum-square of standard-uncertainty contributions (sensitivity coefficients already applied). */
export function combine(contributions: number[]): number {
  return Math.sqrt(contributions.reduce((a, u) => a + u * u, 0));
}

export interface GaugeBudgetInput {
  /** Expanded uncertainty of the reference at this point, as on its certificate. */
  Uref: number;
  /** Coverage factor of Uref (default 2). */
  kRef?: number;
  /**
   * Resolution r. Digital: the digit step (interval width r).
   * Analog: the smallest estimable fraction of a scale interval (interval width 2r).
   */
  resolution: number;
  analog?: boolean;
  /** Zero deviation f0 (full width). */
  zero?: number;
  /** Repeatability b′ (full width). */
  repeatability?: number;
  /** Reproducibility b (full width), if the gauge was remounted. */
  reproducibility?: number;
  /** Hysteresis h (full width). Include it for the mean of up and down readings. */
  hysteresis?: number;
  /** Any further standard-uncertainty contributions (already as u, not widths). */
  extra?: number[];
  /** Coverage factor of the result (default 2). */
  k?: number;
}

export interface GaugeBudget {
  contributions: { name: string; u: number }[];
  u: number;
  U: number;
}

/** Uncertainty of the deviation of an indicating gauge (DKD-R 6-1 eq. 11/13/15; cg-17 eq. 11/13, Table 5). */
export function gaugeBudget(i: GaugeBudgetInput): GaugeBudget {
  const c: { name: string; u: number }[] = [
    { name: 'reference', u: i.Uref / (i.kRef ?? 2) },
    { name: 'resolution', u: rectStd(i.analog ? 2 * i.resolution : i.resolution) },
  ];
  if (i.zero !== undefined) c.push({ name: 'zero', u: rectStd(i.zero) });
  if (i.repeatability !== undefined) c.push({ name: 'repeatability', u: rectStd(i.repeatability) });
  if (i.reproducibility !== undefined) c.push({ name: 'reproducibility', u: rectStd(i.reproducibility) });
  if (i.hysteresis !== undefined) c.push({ name: 'hysteresis', u: rectStd(i.hysteresis) });
  (i.extra ?? []).forEach((u, n) => c.push({ name: `extra ${n + 1}`, u }));
  const u = combine(c.map((x) => x.u));
  return { contributions: c, u, U: (i.k ?? 2) * u };
}

/** Error span U′ = U + |deviation| (DKD-R 6-1 §9.1.2; cg-17 eq. 12/14). */
export function errorSpan(U: number, deviation: number): number {
  return U + Math.abs(deviation);
}

/**
 * DKD-R 6-1 §9.3: smallest expanded uncertainty (and error span for a conformity
 * statement) that may be stated, as a fraction of the measurement span, for
 * calibration sequences B and C. Sequence A: no floor.
 */
export function dkdFloor(sequence: 'A' | 'B' | 'C', span: number): { U: number; errorSpan: number } {
  if (sequence === 'B') return { U: 0.0004 * span, errorSpan: 0.0006 * span };
  if (sequence === 'C') return { U: 0.003 * span, errorSpan: 0.006 * span };
  return { U: 0, errorSpan: 0 };
}

/** Test uncertainty ratio: tolerance half-width ÷ expanded uncertainty of the reference. */
export function tur(toleranceHalfWidth: number, Uref: number): number {
  if (!(Uref > 0)) throw new Error('Reference uncertainty must be positive');
  return toleranceHalfWidth / Uref;
}

// ----------------------------------------------------- gravity and head

/**
 * Normal gravity at sea level for a latitude in degrees (40 CFR 1065.630,
 * eq. 1065.630-1, used when the NOAA surface-gravity tool is not available).
 */
export function gravityAtLatitude(latDeg: number): number {
  const s2 = Math.sin((latDeg * Math.PI) / 180) ** 2;
  return 9.7803267715 * (1 + 5.2790414e-3 * s2 + 2.32718e-5 * s2 ** 2 + 1.262e-7 * s2 ** 3 + 7e-10 * s2 ** 4);
}

/**
 * Pressure actually generated by a deadweight tester whose weights were made
 * for gravity `gRef` (usually standard gravity) when used where gravity is
 * `gLocal`: the nominal value scales with gLocal / gRef.
 */
export function gravityCorrected(nominal: number, gLocal: number, gRef = G_STANDARD): number {
  return nominal * (gLocal / gRef);
}

/**
 * Head correction in Pa for a height difference dh (m) of pressure-transmitting
 * fluid: (ρf − ρa)·g·Δh in gauge mode, ρf·g·Δh in absolute mode (cg-3 eq. 3.6,
 * 3.7). Δh is the height of the reference level above the point where the
 * pressure is wanted (positive when the gauge sits below the reference).
 */
export function headCorrection(rhoFluid: number, dh: number, g = G_STANDARD, rhoAir = 0, mode: 'gauge' | 'absolute' = 'gauge'): number {
  return (mode === 'gauge' ? rhoFluid - rhoAir : rhoFluid) * g * dh;
}

/** Density of a gas from a reference density, by the ideal-gas approximation used in DKD-R 6-1 App. B. */
export function gasDensity(rhoRef: number, pAbs: number, pRef: number, tC: number, tRefC = 20): number {
  return rhoRef * (pAbs / pRef) * ((273.15 + tRefC) / (273.15 + tC));
}

// ------------------------------------------------------- pressure balance

export interface BalanceInput {
  /** Masses (true mass, kg) of all floating parts and weights. */
  masses: number[];
  /** Density of the weights, kg/m³ (single value or one per mass). */
  rhoMass: number | number[];
  /** Air density, kg/m³. */
  rhoAir: number;
  /** Local gravity, m/s². */
  g: number;
  /** Effective area at zero pressure and reference temperature, m². */
  A0: number;
  /** Pressure distortion coefficient λ, 1/Pa (default 0). */
  lambda?: number;
  /** Approximate (nominal) pressure for the distortion term, Pa. */
  pNominal?: number;
  /** Sum of linear expansion coefficients of piston and cylinder, 1/K. */
  alphaSum: number;
  /** Piston-cylinder temperature and its reference temperature, °C. */
  t: number;
  tRef?: number;
  /** Head correction terms (optional). */
  rhoFluid?: number;
  dh?: number;
}

/**
 * Gauge pressure (Pa) generated by a gas-operated pressure balance at its
 * reference level, plus an optional head correction to the gauge's reference
 * level (EURAMET cg-3 eq. 3.1 and 3.6; DKD-R 6-1 eq. 31).
 */
export function balancePressure(b: BalanceInput): number {
  const rhos = Array.isArray(b.rhoMass) ? b.rhoMass : b.masses.map(() => b.rhoMass as number);
  const force = b.masses.reduce((a, m, i) => a + m * b.g * (1 - b.rhoAir / rhos[i]), 0);
  const area = b.A0 * (1 + (b.lambda ?? 0) * (b.pNominal ?? 0)) * (1 + b.alphaSum * (b.t - (b.tRef ?? 20)));
  const p = force / area;
  return p + (b.rhoFluid !== undefined && b.dh ? (b.rhoFluid - b.rhoAir) * b.g * b.dh : 0);
}

// ------------------------------------------------------------- units

/** NIST SP 811, App. B.8. */
export const PA_PER_PSI = 6894.757;
export const PA_PER_BAR = 1e5;
export const PA_PER_INH2O = 249.0889; // inch of water, conventional
