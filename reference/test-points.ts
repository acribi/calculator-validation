// Reference implementation copied from the acribi.com calculators (website/src/lib/test-points.ts).
// Pure calculation code, no UI. MIT License, see LICENSE.

// Evaluation of instrument test-point data: error of each reading against the
// nominal (reference or set) value and a tolerance that is either relative (%)
// or absolute (in the unit of the instrument). Pure functions, used at build time
// by acribi.com pages and reusable by the instrument procedure pages.
//
// Convention: error = reading − nominal (VIM 4.1: indication minus reference).
// For a setting torque wrench, "reading" is what the reference transducer shows
// when the wrench releases, and "nominal" is the value set on the wrench, so the
// relative error is the ISO 6789-1 style deviation (reading − set) / set.

export type Tolerance =
  | { type: 'relative'; value: number }   // ± value % of nominal
  | { type: 'absolute'; value: number };  // ± value, in the instrument unit

export interface PointData {
  nominal: number;
  readings: number[];
  /** Optional per-point tolerance that overrides the series tolerance. */
  tolerance?: Tolerance;
}

export interface PointResult {
  nominal: number;
  readings: number[];
  /** Error of each reading, in % (relative tolerance) or in the unit (absolute). */
  errors: number[];
  mean: number;
  meanError: number;
  /** Error with the largest magnitude. */
  worstError: number;
  /** Tolerance limit expressed in the same scale as `errors` (always positive). */
  limit: number;
  /** True when every reading is within ± limit (limits included). */
  pass: boolean;
  /** Number of readings outside the limit. */
  outside: number;
}

const EPS = 1e-9;

export function error(reading: number, nominal: number, type: Tolerance['type']): number {
  if (type === 'relative') {
    if (nominal === 0) throw new Error('Relative error needs a non-zero nominal value');
    return ((reading - nominal) / nominal) * 100;
  }
  return reading - nominal;
}

export function mean(values: number[]): number {
  if (!values.length) throw new Error('No readings');
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Sample standard deviation (n − 1). Returns 0 for a single reading. */
export function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1));
}

export function evaluatePoint(p: PointData, tol: Tolerance): PointResult {
  const t = p.tolerance ?? tol;
  const errors = p.readings.map((r) => error(r, p.nominal, t.type));
  const m = mean(p.readings);
  const meanError = error(m, p.nominal, t.type);
  const worstError = errors.reduce((w, e) => (Math.abs(e) > Math.abs(w) ? e : w), 0);
  const outside = errors.filter((e) => Math.abs(e) > t.value + EPS).length;
  return { nominal: p.nominal, readings: p.readings, errors, mean: m, meanError, worstError, limit: t.value, pass: outside === 0, outside };
}

export function evaluateSeries(points: PointData[], tol: Tolerance): { points: PointResult[]; pass: boolean } {
  const results = points.map((p) => evaluatePoint(p, tol));
  return { points: results, pass: results.every((r) => r.pass) };
}

/** Lower and upper acceptance values in the instrument unit for one nominal value. */
export function acceptanceLimits(nominal: number, tol: Tolerance): [number, number] {
  const d = tol.type === 'relative' ? (Math.abs(nominal) * tol.value) / 100 : tol.value;
  return [nominal - d, nominal + d];
}
