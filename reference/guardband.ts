// Reference implementation copied from the acribi.com calculators (website/src/lib/guardband.ts).
// Pure calculation code, no UI. MIT License, see LICENSE.

// Guard band methods: acceptance limits for a symmetric tolerance ±L and an
// expanded uncertainty U, plus helpers to compare their false-accept /
// false-reject risk. Pure functions on top of src/lib/risk.ts (not modified).
// Validated by the cases in cases/ against Dobbert (2008) Table 1 and
// UKAS LAB 48 Ed. 5 worked examples
// (Citations in cases/.)
//
// Notation: tolerance ±L, U = k·u, guard band w = L − A (A = acceptance limit),
// TUR = L / U (symmetric tolerance; Global ACI-TECH-1-002 §2.13, A2LA G136).
import { globalRisk, normInv, sigmaFromEopr, specificRisk } from './risk.ts';

export type GuardBandMethod = 'simple' | 'dobbert' | 'rss' | 'r083' | 'wU';

export const METHOD_LABELS: Record<GuardBandMethod, string> = {
  simple: 'Simple acceptance (w = 0)',
  dobbert: 'Managed guard band (Dobbert)',
  rss: 'RSS: √(L² − U²)',
  r083: 'w = 0.83 U',
  wU: 'w = U',
};

/**
 * Dobbert's managed guard band multiplier (Dobbert 2008, eq. 4):
 * M = 1.04 − exp(0.38·ln(TUR) − 0.54). Guard band w = M·U95.
 * Negative above about 4.6:1 (the acceptance limit then lies outside the tolerance).
 */
export function dobbertMultiplier(tur: number): number {
  return 1.04 - Math.exp(0.38 * Math.log(tur) - 0.54);
}

/** RSS acceptance limit A = √(L² − U²) (Global ACI-TECH-1-002, App. B Ex. 3). NaN when U ≥ L. */
export function rssLimit(L: number, U: number): number {
  return U < L ? Math.sqrt(L * L - U * U) : NaN;
}

/** Guard band w = r·U (Global ACI-TECH-1-002 §6.2, Table 1). */
export function multipleOfU(U: number, r: number): number {
  return r * U;
}

/**
 * One-sided guard band factor for a maximum specific false-accept probability:
 * k_w = Φ⁻¹(1 − PFA_max); acceptance limit = TU − k_w·u (UKAS LAB 48, App. C).
 */
export function guardFactor(pfaMax: number): number {
  return normInv(1 - pfaMax);
}

/**
 * Two-sided case: smallest k_w such that a result sitting on the acceptance
 * limit has a specific false-accept probability (both tails) of at most pfaMax.
 * Equals the one-sided factor when the far tail is negligible (UKAS LAB 48, App. C).
 */
export function guardFactorTwoSided(L: number, u: number, pfaMax: number): number {
  const out = (kw: number) => specificRisk(L - kw * u, u, -L, L).pOut;
  let lo = guardFactor(pfaMax);
  if (out(lo) <= pfaMax) return lo;
  let hi = L / u; // acceptance limit at the centre: largest possible factor
  if (out(hi) > pfaMax) return NaN;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (out(mid) > pfaMax) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** Acceptance limit A (upper; the lower one is −A) for a method, tolerance ±L and U. */
export function acceptanceLimit(method: GuardBandMethod, L: number, U: number): number {
  switch (method) {
    case 'simple':
      return L;
    case 'wU':
      return L - U;
    case 'r083':
      return L - 0.83 * U;
    case 'rss':
      return rssLimit(L, U);
    case 'dobbert':
      return L - dobbertMultiplier(L / U) * U;
  }
}

/**
 * Global PFA / PFR for a centered normal population with in-tolerance
 * probability `eopr` (true, not observed), tolerance ±L, U = k·u and
 * symmetric acceptance limits ±A.
 */
export function riskAt(L: number, U: number, k: number, A: number, eopr: number, n = 600) {
  return globalRisk({ lower: -L, upper: L, u: U / k, mu0: 0, sigma0: sigmaFromEopr(L, eopr), accLower: -A, accUpper: A }, n);
}

/**
 * Worst-case global PFA over the in-tolerance probability (EOPR), found on a
 * grid and refined by golden-section search. Returns the PFA and the EOPR at
 * which it occurs (Dobbert 2008, Table 1 approach).
 */
export function maxGlobalPfa(L: number, U: number, k: number, A: number, n = 600) {
  const f = (e: number) => riskAt(L, U, k, A, e, n).pfa;
  let best = 0.5;
  let bestV = -1;
  for (let e = 0.3; e <= 0.995; e += 0.01) {
    const v = f(e);
    if (v > bestV) { bestV = v; best = e; }
  }
  let a = Math.max(0.2, best - 0.01);
  let b = Math.min(0.999, best + 0.01);
  const g = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 40; i++) {
    const c = b - g * (b - a);
    const d = a + g * (b - a);
    if (f(c) > f(d)) b = d;
    else a = c;
  }
  const eopr = (a + b) / 2;
  return { pfa: f(eopr), eopr };
}
