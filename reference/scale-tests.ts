// Reference implementation copied from the acribi.com calculators (website/src/lib/scale-tests.ts).
// Pure calculation code, no UI. MIT License, see LICENSE.

// Calculations for the calibration of non-automatic weighing instruments
// (scales and balances). Pure functions, used at build time by the scale
// procedure page (ScaleErrorChart, EccentricityTest) and checked in
// the cases in cases/scale-balance.json against EURAMET cg-18 v4.0, example H1.
//
// Sources (full citations in cases/):
// - NIST Handbook 44 (2026), 2.20 Scales, Table 6 (maintenance tolerances, in e)
//   and T.N.3.2 (acceptance tolerance = one-half of maintenance).
// - OIML R 76-1:2006, 3.5.1 Table 6 (mpe on initial verification, in e) and
//   3.5.2 (mpe in service = twice the initial values).
// - EURAMET cg-18 v4.0, 6.1 (repeatability), 6.3 (eccentricity), 7.1.1
//   (standard uncertainty of the indication), 7.5.3 (conformity).
// - USP <41> (2013 text, as summarized by two secondary sources): repeatability
//   2 s / smallest net weight <= 0.10 %, with s replaced by 0.41 d when smaller.

export type ScaleClass = 'I' | 'II' | 'III' | 'IIII' | 'IIIL';

/** Handbook 44, Table 6: maintenance tolerance in verification scale intervals (e) for a test load expressed in e. */
export function hb44MaintenanceTolerance(loadInE: number, cls: ScaleClass): number {
  const n = Math.abs(loadInE);
  switch (cls) {
    case 'I': return n <= 50000 ? 1 : n <= 200000 ? 2 : 3;
    case 'II': return n <= 5000 ? 1 : n <= 20000 ? 2 : 3;
    case 'III': return n <= 500 ? 1 : n <= 2000 ? 2 : n <= 4000 ? 3 : 5;
    case 'IIII': return n <= 50 ? 1 : n <= 200 ? 2 : n <= 400 ? 3 : 5;
    // Class III L: 1 e to 500 e, 2 e to 1000 e, then add 1 e for each
    // additional 500 e or fraction thereof.
    case 'IIIL': return n <= 500 ? 1 : n <= 1000 ? 2 : 2 + Math.ceil((n - 1000) / 500);
  }
}

/** Handbook 44, T.N.3.2: acceptance tolerance = one-half of the maintenance tolerance (in e). */
export function hb44AcceptanceTolerance(loadInE: number, cls: ScaleClass): number {
  return hb44MaintenanceTolerance(loadInE, cls) / 2;
}

/** OIML R 76-1, Table 6: mpe on initial verification, in e (class III L does not exist in R 76). */
export function oimlMpeInitial(loadInE: number, cls: Exclude<ScaleClass, 'IIIL'>): number {
  const n = Math.abs(loadInE);
  const [a, b] = { I: [50000, 200000], II: [5000, 20000], III: [500, 2000], IIII: [50, 200] }[cls];
  return n <= a ? 0.5 : n <= b ? 1 : 1.5;
}

/** OIML R 76-1, 3.5.2: mpe in service = twice the mpe on initial verification, in e. */
export function oimlMpeInService(loadInE: number, cls: Exclude<ScaleClass, 'IIIL'>): number {
  return 2 * oimlMpeInitial(loadInE, cls);
}

export interface ToleranceStep { from: number; to: number; tol: number }

/**
 * Tolerance as a step function of the load, in the load unit, from 0 to max.
 * `e` is the verification scale interval in the same unit as the load.
 */
export function toleranceSteps(
  max: number,
  e: number,
  tolInE: (loadInE: number) => number,
): ToleranceStep[] {
  const steps: ToleranceStep[] = [];
  const nMax = Math.round(max / e);
  let start = 0;
  let cur = tolInE(0);
  for (let n = 1; n <= nMax; n++) {
    const t = tolInE(n);
    if (t !== cur) {
      steps.push({ from: start * e, to: (n - 1) * e, tol: cur * e });
      start = n - 1;
      cur = t;
    }
  }
  steps.push({ from: start * e, to: max, tol: cur * e });
  return steps;
}

/** Tolerance (load unit) that applies at a given load, from a list of steps (upper bound inclusive). */
export function toleranceAt(load: number, steps: ToleranceStep[]): number {
  const s = steps.find((st) => load <= st.to + 1e-9) ?? steps[steps.length - 1];
  return s.tol;
}

export function mean(values: number[]): number {
  if (!values.length) throw new Error('No readings');
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** cg-18 (6.1-1): sample standard deviation (n − 1). */
export function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1));
}

export interface EccentricityReadings {
  center: number;
  frontLeft: number;
  backLeft: number;
  backRight: number;
  frontRight: number;
}

/** cg-18 (6.3-1), methods 1 and 2: deviation of each off-centre indication from the centre indication. */
export function eccentricity(r: EccentricityReadings) {
  const deviations = {
    frontLeft: r.frontLeft - r.center,
    backLeft: r.backLeft - r.center,
    backRight: r.backRight - r.center,
    frontRight: r.frontRight - r.center,
  };
  const max = Object.values(deviations).reduce((m, v) => (Math.abs(v) > Math.abs(m) ? v : m), 0);
  return { deviations, max };
}

/** cg-18 7.1.1.1–7.1.1.2: standard uncertainty of a rounding error, d / (2 √3). */
export function uRounding(d: number): number {
  return d / (2 * Math.sqrt(3));
}

/** cg-18 (7.1.1-10): u(δI_ecc) = I · |ΔI_ecc,max| / (2 · L_ecc · √3). */
export function uEccentricity(indication: number, maxDeviation: number, eccLoad: number): number {
  return (indication * Math.abs(maxDeviation)) / (2 * eccLoad * Math.sqrt(3));
}

/** cg-18 (7.1.1-12): u²(I) = d0²/12 + dI²/12 + u²(δI_rep) + u²(δI_ecc). */
export function uIndication(p: { d0: number; dI: number; s: number; uEcc?: number }): number {
  return Math.sqrt(p.d0 ** 2 / 12 + p.dI ** 2 / 12 + p.s ** 2 + (p.uEcc ?? 0) ** 2);
}

/** cg-18 (7.1-2): u²(E) = u²(I) + u²(m_ref). */
export function uError(uI: number, uMref: number): number {
  return Math.sqrt(uI ** 2 + uMref ** 2);
}

/** cg-18 (7.5.3-1): conformity can be declared when |E| + U <= Tol. */
export function conforms(error: number, U: number, tol: number): boolean {
  return Math.abs(error) + U <= tol + 1e-12;
}

/** cg-18 (7.5.2-3e): global expanded uncertainty of a weighing result without correction, U_gl(W) = alpha + beta · R. */
export function globalUncertainty(alpha: number, beta: number, reading: number): number {
  return alpha + beta * reading;
}

/** cg-18 App. G (G-9): minimum weight R_min,SF = alpha · SF / (Req − beta · SF), with Req relative (0.01 = 1 %). */
export function minimumWeight(alpha: number, beta: number, req: number, sf = 1): number {
  const den = req - beta * sf;
  if (den <= 0) throw new Error('Requirement not achievable at any load');
  return (alpha * sf) / den;
}

/** USP <41>: the standard deviation used, s or 0.41 d if s is smaller. */
export function uspEffectiveSd(s: number, d: number): number {
  return Math.max(s, 0.41 * d);
}

/** USP <41> / <1251>: minimum weight = 2000 · s (s replaced by 0.41 d when smaller). */
export function uspMinimumWeight(s: number, d: number): number {
  return 2000 * uspEffectiveSd(s, d);
}

/** USP <41> repeatability: 2 · s / smallest net weight <= 0.10 %. */
export function uspRepeatabilityPasses(s: number, d: number, smallestNetWeight: number): boolean {
  return (2 * uspEffectiveSd(s, d)) / smallestNetWeight <= 0.001 + 1e-12;
}

/** USP <41> accuracy: reading within 0.10 % of the test weight value. */
export function uspAccuracyPasses(reading: number, weightValue: number): boolean {
  return Math.abs(reading - weightValue) / weightValue <= 0.001 + 1e-12;
}
