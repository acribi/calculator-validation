// Reference implementation copied from the acribi.com calculators (website/src/lib/reliability.ts).
// Pure calculation code, no UI. MIT License, see LICENSE.

// Measurement reliability models for calibration intervals (pure functions).
// Source: NASA-HDBK-8739.19-3 (2010), §9.3 reliability models and §9.4 analysis
// example. Validated by the cases in cases/ against the §9.4 worked example
// (Citations in cases/.)
import { normInv } from './risk.ts';

/** Gamma reliability model, NASA-HDBK-8739.19-3 eq. (9-30): R(t) = a·e^(−bt)·[1 + bt + (bt)²/2 + (bt)³/6]. */
export function gammaReliability(t: number, a: number, b: number): number {
  const x = b * t;
  return a * Math.exp(-x) * (1 + x + (x * x) / 2 + (x * x * x) / 6);
}

/** Finds the root of a decreasing function f on [lo, hi] by bisection. */
function bisectDecreasing(f: (x: number) => number, lo: number, hi: number, it = 100): number {
  for (let i = 0; i < it; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Gamma-model rate b such that R(interval) = eop, given R(0) = bop. */
export function gammaRate(bop: number, eop: number, interval = 1): number {
  return bisectDecreasing((b) => gammaReliability(interval, bop, b) - eop, 1e-9, 100 / interval);
}

/** Time at which the gamma model falls to a reliability target (same time unit as b). */
export function gammaIntervalForTarget(target: number, a: number, b: number): number {
  if (target >= a) return 0;
  return bisectDecreasing((t) => gammaReliability(t, a, b) - target, 0, 1000 / b);
}

/**
 * Uncertainty growth, NASA-HDBK-8739.19-3 eq. (9-15): for a normally distributed bias
 * and symmetric limits ±L, u(t) = u(0)·Φ⁻¹((1 + R(0))/2) / Φ⁻¹((1 + R(t))/2).
 */
export function uncertaintyGrowth(u0: number, r0: number, rt: number): number {
  return (u0 * normInv((1 + r0) / 2)) / normInv((1 + rt) / 2);
}
