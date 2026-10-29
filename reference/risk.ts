// Reference implementation copied from the acribi.com calculators (website/src/lib/risk.ts).
// Pure calculation code, no UI. MIT License, see LICENSE.

// Measurement decision risk: TUR, specific risk and global PFA/PFR.
// Pure functions, no DOM. Used by the acribi.com TUR calculator and
// validated against official worked examples (cases/tur-risk.json)
// (Citations in cases/.)
//
// Model (JCGM 106:2012, sections 7 and 9; NASA-HDBK-8739.19-4):
//   - true values of the unit under test ~ N(mu0, sigma0)   ("process" / prior)
//   - measurement error ~ N(0, u), u = standard uncertainty = U / k
//   - tolerance interval [TL, TU], acceptance interval [AL, AU]
//   - PFA (global consumer's risk) = P(true value outside tolerance AND accepted)
//   - PFR (global producer's risk) = P(true value inside tolerance AND rejected)
// Both are joint ("unconditional") probabilities.

/** Standard normal CDF, double precision (Hart 1968 / West 2005). */
export function normCdf(x: number): number {
  const a = Math.abs(x);
  let c: number;
  if (a > 37) {
    c = 0;
  } else {
    const e = Math.exp((-a * a) / 2);
    if (a < 7.07106781186547) {
      let b = 3.52624965998911e-2 * a + 0.700383064443688;
      b = b * a + 6.37396220353165;
      b = b * a + 33.912866078383;
      b = b * a + 112.079291497871;
      b = b * a + 221.213596169931;
      b = b * a + 220.206867912376;
      c = e * b;
      b = 8.83883476483184e-2 * a + 1.75566716318264;
      b = b * a + 16.064177579207;
      b = b * a + 86.7807322029461;
      b = b * a + 296.564248779674;
      b = b * a + 637.333633378831;
      b = b * a + 793.826512519948;
      b = b * a + 440.413735824752;
      c = c / b;
    } else {
      let b = a + 0.65;
      b = a + 4 / b;
      b = a + 3 / b;
      b = a + 2 / b;
      b = a + 1 / b;
      c = e / b / 2.506628274631;
    }
  }
  return x > 0 ? 1 - c : c;
}

/** Standard normal density. */
export function normPdf(x: number): number {
  return Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI);
}

/** Inverse standard normal CDF (Acklam's rational approximation + 2 Newton steps). */
export function normInv(p: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError('p must be in (0, 1)');
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let x: number;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - pl) {
    const q = p - 0.5;
    const r = q * q;
    x = ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  for (let i = 0; i < 2; i++) x -= (normCdf(x) - p) / normPdf(x);
  return x;
}

/**
 * Test uncertainty ratio: tolerance span divided by the span of the expanded
 * uncertainty (95 %). For ±T and U this is T / U (Global ACI-TECH-1-002 §2.13, formerly ILAC G8 §1.13; A2LA G136).
 */
export function tur(lower: number, upper: number, U: number): number {
  return (upper - lower) / (2 * U);
}

/** Test accuracy ratio: tolerance span divided by the span of the reference standard's accuracy spec. */
export function tar(lower: number, upper: number, stdAccuracy: number): number {
  return (upper - lower) / (2 * stdAccuracy);
}

/**
 * Specific risk for one measured value y with standard uncertainty u
 * (normal distribution of the measurand given y): probability that the true
 * value lies inside / outside [lower, upper]. One-sided limits: pass ±Infinity.
 */
export function specificRisk(y: number, u: number, lower: number, upper: number) {
  const pBelow = Number.isFinite(lower) ? normCdf((lower - y) / u) : 0;
  const pAbove = Number.isFinite(upper) ? 1 - normCdf((upper - y) / u) : 0;
  const pOut = pBelow + pAbove;
  return { pConform: 1 - pOut, pOut };
}

/** sigma0 of a centered normal process that gives in-tolerance probability R for ±T. */
export function sigmaFromEopr(T: number, R: number): number {
  return T / normInv((1 + R) / 2);
}

/**
 * Process sigma from an *observed* EOPR (as found in calibration history),
 * removing the calibration uncertainty: sigma_true = sqrt(sigma_obs² − u²)
 * (NASA-HDBK-8739.19-4 eq. 4-17). Returns NaN when u ≥ sigma_obs (inconsistent inputs).
 */
export function sigmaFromObservedEopr(T: number, Robs: number, u: number): number {
  const sObs = sigmaFromEopr(T, Robs);
  return sObs > u ? Math.sqrt(sObs * sObs - u * u) : NaN;
}

export interface GlobalRiskInput {
  lower: number; // tolerance limits
  upper: number;
  u: number; // standard uncertainty of the measurement process
  mu0: number; // process mean
  sigma0: number; // process standard deviation
  accLower?: number; // acceptance limits (default = tolerance limits: simple acceptance)
  accUpper?: number;
}

/** Composite Simpson rule on [a, b] (n even). */
function simpson(f: (x: number) => number, a: number, b: number, n = 2000): number {
  if (!(b > a)) return 0;
  const h = (b - a) / n;
  let sum = f(a) + f(b);
  for (let i = 1; i < n; i++) sum += (i % 2 ? 4 : 2) * f(a + i * h);
  return (sum * h) / 3;
}

/**
 * Global consumer's (PFA) and producer's (PFR) risk by numerical integration
 * over the process distribution, split at the tolerance limits so each piece
 * is smooth (JCGM 106:2012 §9.5).
 */
export function globalRisk(inp: GlobalRiskInput, n = 2000) {
  const { lower, upper, u, mu0, sigma0 } = inp;
  const AL = inp.accLower ?? lower;
  const AU = inp.accUpper ?? upper;
  const pAccept = (eta: number) =>
    (Number.isFinite(AU) ? normCdf((AU - eta) / u) : 1) - (Number.isFinite(AL) ? normCdf((AL - eta) / u) : 0);
  const g = (eta: number) => normPdf((eta - mu0) / sigma0) / sigma0;
  const a = mu0 - 12 * sigma0;
  const b = mu0 + 12 * sigma0;
  const lo = Math.max(a, Number.isFinite(lower) ? lower : a);
  const hi = Math.min(b, Number.isFinite(upper) ? upper : b);
  const fa = (eta: number) => g(eta) * pAccept(eta);
  const fr = (eta: number) => g(eta) * (1 - pAccept(eta));
  const pfa = simpson(fa, a, lo, n) + simpson(fa, hi, b, n);
  const pfr = simpson(fr, lo, hi, n);
  const pInTol =
    (Number.isFinite(upper) ? normCdf((upper - mu0) / sigma0) : 1) -
    (Number.isFinite(lower) ? normCdf((lower - mu0) / sigma0) : 0);
  return { pfa, pfr, pInTol };
}

/**
 * Symmetric guard band w (acceptance limits = tolerance ∓ w) that brings the
 * global PFA down to `target`, by bisection. Returns 0 when simple acceptance
 * already meets the target.
 */
export function guardBandForPfa(inp: GlobalRiskInput, target: number): number {
  const T = (inp.upper - inp.lower) / 2;
  const at = (w: number) => globalRisk({ ...inp, accLower: inp.lower + w, accUpper: inp.upper - w }).pfa;
  if (at(0) <= target) return 0;
  let lo = 0;
  let hi = T * 0.999;
  if (at(hi) > target) return NaN;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) > target) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** Largest expanded uncertainty U that still gives the target TUR. */
export function maxUForTur(lower: number, upper: number, target: number): number {
  return (upper - lower) / (2 * target);
}

export interface BudgetInput {
  refU?: number; // reference standard expanded uncertainty from its certificate
  refK?: number; // and its coverage factor
  refSpec?: number; // or: reference standard accuracy spec (±a), treated as rectangular
  resolution?: number; // UUT resolution (digit / smallest division)
  repeatability?: number; // standard deviation of repeated readings
  other?: number; // any other standard uncertainty
}

/**
 * Minimal uncertainty budget (GUM, JCGM 100:2008): standard uncertainties
 * combined by root sum of squares (uncorrelated, sensitivity coefficients 1).
 *   certificate value U/k (GUM 4.3.3) · rectangular ±a -> a/√3 (GUM 4.3.7)
 *   resolution δx -> δx/√12 (GUM F.2.2.1) · repeatability s as entered
 */
export function budget(b: BudgetInput) {
  const parts: { name: string; u: number }[] = [];
  if (b.refU && b.refK) parts.push({ name: 'Reference standard (certificate U/k)', u: b.refU / b.refK });
  else if (b.refSpec) parts.push({ name: 'Reference standard (spec ±a, rectangular a/√3)', u: b.refSpec / Math.sqrt(3) });
  if (b.resolution) parts.push({ name: 'Resolution of the instrument (δx/√12)', u: b.resolution / Math.sqrt(12) });
  if (b.repeatability) parts.push({ name: 'Repeatability (standard deviation)', u: b.repeatability });
  if (b.other) parts.push({ name: 'Other', u: b.other });
  const uc = Math.sqrt(parts.reduce((acc, p) => acc + p.u * p.u, 0));
  return { parts, uc };
}
