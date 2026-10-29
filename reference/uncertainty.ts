// Reference implementation copied from the acribi.com calculators (website/src/lib/uncertainty.ts).
// Pure calculation code, no UI. MIT License, see LICENSE.

// Measurement uncertainty helpers (GUM, JCGM 100:2008, and EA-4/02 M:2022).
// Pure functions, no UI. Validated by the cases in cases/ against the
// worked examples cited in cases/uncertainty-budget.json.
import { normCdf, normInv } from './risk.ts';
import { parseUsNumber } from './numbers.ts';

/** Certificate value: expanded uncertainty U with coverage factor k -> u = U / k (GUM 4.3.3). */
export const fromExpanded = (U: number, k: number) => U / k;
/** Limits ±a, rectangular distribution -> a/√3 (GUM 4.3.7; EA-4/02 3.3.2 c). */
export const rectangular = (a: number) => a / Math.sqrt(3);
/** Limits ±a, triangular distribution -> a/√6 (GUM 4.3.9). */
export const triangular = (a: number) => a / Math.sqrt(6);
/** Limits ±a, U-shaped (arcsine) distribution -> a/√2 (GUM H.1.3.4). */
export const uShaped = (a: number) => a / Math.sqrt(2);
/** Digital resolution δx (full width) -> δx/√12 (GUM F.2.2.1). */
export const resolution = (dx: number) => dx / Math.sqrt(12);
/** Type A: standard deviation s of n observations -> standard uncertainty of the mean s/√n (GUM 4.2.3). */
export const typeA = (s: number, n: number) => s / Math.sqrt(n);

export type Distribution = 'normal' | 'rectangular' | 'triangular' | 'U-shaped';

export interface BudgetRow {
  name: string;
  /** Standard uncertainty u(xᵢ), in the unit of the input quantity. */
  u: number;
  /** Sensitivity coefficient cᵢ (default 1). */
  c?: number;
}

/**
 * Combined standard uncertainty for uncorrelated inputs: law of propagation
 * of uncertainty, u_c² = Σ (cᵢ·u(xᵢ))² (GUM 5.1.2, eq. 10; EA-4/02 4.1).
 * Also returns each contribution's share of u_c² and the (wrong) linear sum,
 * for comparison.
 */
export function combine(rows: BudgetRow[]) {
  const parts = rows.map((r) => ({ ...r, ui: Math.abs((r.c ?? 1) * r.u) }));
  const variance = parts.reduce((acc, p) => acc + p.ui * p.ui, 0);
  const uc = Math.sqrt(variance);
  return {
    rows: parts.map((p) => ({ ...p, share: variance > 0 ? (p.ui * p.ui) / variance : 0 })),
    uc,
    linearSum: parts.reduce((acc, p) => acc + p.ui, 0),
  };
}

/** Expanded uncertainty U = k·u_c (GUM 6.2.1). */
export const expand = (uc: number, k: number) => k * uc;

/** Round to n significant digits (reported U: at most two, Global ACI-TECH-1-009 §5.3). */
export function roundSig(x: number, n = 2) {
  if (x === 0 || !Number.isFinite(x)) return x;
  const p = Math.pow(10, n - 1 - Math.floor(Math.log10(Math.abs(x))));
  return Math.round(x * p) / p;
}

/** Coverage probability of ±k·σ for a normal distribution (k = 2 -> 95.45 %; UKAS M3003 3.44). */
export const coverageNormal = (k: number) => normCdf(k) - normCdf(-k);

/**
 * Coverage factor for a rectangular output distribution (a dominant
 * rectangular contribution): k = p·√3 (EA-4/02 S9.14; p = 0.95 -> 1.65).
 */
export const kRectangular = (p: number) => p * Math.sqrt(3);

// ---------------------------------------------------------------------------
// Uncertainty budget calculator (/tools/uncertainty-calculator/).
// Type A from readings, degrees of freedom, Welch–Satterthwaite, Student t
// coverage factor, dominant rectangular check. Validated in
// the worked examples in cases/uncertainty-budget.json.
// (Citations in cases/.)
// ---------------------------------------------------------------------------

/** Arithmetic mean. */
export const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;

/** Experimental standard deviation with n − 1 (GUM 4.2.2), two-pass for precision. */
export function stdev(xs: number[]) {
  const n = xs.length;
  if (n < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (n - 1));
}

/**
 * Type A evaluation from n repeated readings: mean, s, standard uncertainty of
 * the mean s/√n and degrees of freedom ν = n − 1 (GUM 4.2.2–4.2.3, G.3.3).
 */
export function typeAFromReadings(xs: number[]) {
  const n = xs.length;
  const s = stdev(xs);
  return { n, mean: n ? mean(xs) : NaN, s, u: s / Math.sqrt(n), nu: n - 1 };
}

/**
 * Parse pasted readings (one per line, or separated by spaces, tabs or
 * semicolons) in US number format, the same rule as the gauge R&R paste parser
 * (`parseUsNumber`): dot = decimal separator, comma = thousands separator
 * ("1,234" is 1234, "1,000.5" is 1000.5). A decimal comma ("0,25") is reported
 * as an error, not misread. A token such as "1.5,2.5,3.5" (commas between
 * dot-decimal values that are not thousands groups) is read as a list.
 */
export function parseReadingsChecked(text: string): { values: number[]; errors: string[] } {
  const values: number[] = [];
  const errors: string[] = [];
  for (const tok of text.split(/[\s;]+/)) {
    if (!tok) continue;
    const one = parseUsNumber(tok);
    if (!one.error) {
      if (Number.isFinite(one.value)) values.push(one.value);
      continue;
    }
    if (/^[+-]?\d*,\d+$/.test(tok)) { errors.push(one.error); continue; }
    const parts = tok.split(',').filter((p) => p !== '');
    const parsed = parts.map((p) => parseUsNumber(p));
    if (parts.length > 1 && parsed.every((p) => !p.error && Number.isFinite(p.value))) values.push(...parsed.map((p) => p.value));
    else errors.push(one.error);
  }
  return { values, errors };
}

/** Readings as numbers (invalid tokens dropped; see `parseReadingsChecked` for the error messages). */
export function parseReadings(text: string): number[] {
  return parseReadingsChecked(text).values;
}

/** Degrees of freedom of a Type B input from the relative reliability of u: ν ≈ ½ (Δu/u)⁻² (GUM G.4.2, eq. G.3). */
export const nuFromReliability = (rel: number) => 0.5 / (rel * rel);

export interface DofRow {
  u: number;
  c?: number;
  /** Degrees of freedom; Infinity (default) for a Type B input with safe limits (GUM G.4.3). */
  nu?: number;
}

/**
 * Effective degrees of freedom, Welch–Satterthwaite formula (GUM G.4.1 eq. G.2b;
 * EA-4/02 E.1; NIST TN 1297 B-1): ν_eff = u_c⁴ / Σ (cᵢuᵢ)⁴/νᵢ, independent inputs.
 * Terms with νᵢ = ∞ add nothing; returns Infinity when every νᵢ is infinite.
 */
export function welchSatterthwaite(rows: DofRow[]) {
  let uc2 = 0;
  let den = 0;
  for (const r of rows) {
    const ui = Math.abs((r.c ?? 1) * r.u);
    uc2 += ui * ui;
    const nu = r.nu ?? Infinity;
    if (Number.isFinite(nu) && nu > 0) den += (ui * ui * ui * ui) / nu;
  }
  return den > 0 ? (uc2 * uc2) / den : Infinity;
}

// --- Student t distribution (for any real ν > 0) ---------------------------

function lnGamma(x: number): number {
  // Lanczos approximation (g = 7, n = 9), relative error ~1e-15.
  const g = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  x -= 1;
  let a = g[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += g[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function betacf(a: number, b: number, x: number): number {
  // Continued fraction for the incomplete beta function (modified Lentz).
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 20000; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-16) break;
  }
  return h;
}

/** Regularized incomplete beta function I_x(a, b). Exported for src/lib/grr.ts (F-test p-values). */
export function ibeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Two-sided coverage of the Student t distribution: P(|T| ≤ t) for ν degrees of freedom. */
export function tCoverageProbability(t: number, nu: number) {
  if (!Number.isFinite(nu)) return normCdf(t) - normCdf(-t);
  return 1 - ibeta(nu / 2, 0.5, nu / (nu + t * t));
}

/**
 * Coverage factor t_p(ν): the value with P(|T| ≤ t) = p for a Student t with ν
 * degrees of freedom (real ν > 0; ν = ∞ gives the normal value). This is the
 * function tabulated in GUM Table G.2 / NIST TN 1297 Table B.1 / EA-4/02 Table E.1;
 * we compute it rather than copy the table.
 */
export function tCoverage(p: number, nu: number) {
  if (!(p > 0 && p < 1) || !(nu > 0)) return NaN;
  if (!Number.isFinite(nu) || nu > 1e7) return normInv((1 + p) / 2);
  let lo = 0;
  let hi = 4;
  while (tCoverageProbability(hi, nu) < p) hi *= 2;
  for (let i = 0; i < 200 && hi - lo > 1e-13 * hi; i++) {
    const mid = (lo + hi) / 2;
    if (tCoverageProbability(mid, nu) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Rows of the printed t tables (GUM G.2, TN 1297 B.1): used by the 'table' mode. */
const T_TABLE_ROWS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 25, 30, 35, 40, 45, 50, 100];

export type DofMode = 'floor' | 'exact' | 'table';

/**
 * Coverage factor k = t_p(ν_eff) (GUM G.6.4; EA-4/02 E2; NIST TN 1297 B.3).
 * - 'floor' (default): truncate ν_eff (to one decimal) to the next lower integer (GUM G.6.4 step 3; EA-4/02 E2 c);
 * - 'exact': t for the non-integer ν_eff (JCGM GUM-5:2026 §2.4.1.4; UKAS M3003 B.8);
 * - 'table': use the next lower printed table row (reproduces UKAS M3003 B.10).
 */
export function coverageFactor(p: number, nuEff: number, mode: DofMode = 'floor') {
  if (!Number.isFinite(nuEff)) return { k: tCoverage(p, Infinity), nu: Infinity };
  let nu = nuEff;
  // ν_eff is shown to one decimal; truncation applies to that value, so 18.999 (shown as 19.0) uses 19 (GUM G.4.1 example).
  // Below ν = 1 there is no lower integer or table row: keep the exact value (rounding up to 1 would shrink k).
  if (nuEff < 1) return { k: tCoverage(p, nuEff), nu: nuEff };
  if (mode === 'floor') nu = Math.max(1, Math.floor(Math.round(nuEff * 10) / 10));
  if (mode === 'table') {
    if (nuEff > 1e6) nu = Infinity;
    else nu = T_TABLE_ROWS.filter((r) => r <= nuEff + 1e-9).pop() ?? 1;
  }
  return { k: tCoverage(p, nu), nu };
}

/**
 * Coverage factor for a rectangular contribution convolved with a normal
 * remainder: ratio = u_N / u_R (UKAS M3003 App. C, table C.7; EA-4/02 S9.14).
 * ratio = 0 -> p·√3 (1.65 at 95.45 %); ratio -> ∞ -> the normal value.
 */
export function kRectNormal(ratio: number, p: number) {
  const a = Math.sqrt(3); // u_R = 1
  const s = ratio;
  const uc = Math.sqrt(1 + s * s);
  const G = (z: number) => z * normCdf(z) + Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI);
  const cover = (t: number) =>
    s < 1e-9 ? Math.min(1, t / a) : (s / (2 * a)) * (G((t + a) / s) - G((t - a) / s) - G((a - t) / s) + G((-t - a) / s));
  let lo = 0;
  let hi = 10 * uc;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (cover(mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2 / uc;
}

/** Coverage factor for a trapezoidal distribution with edge parameter β (EA-4/02 S10.13, eq. S10.10). */
export const kTrapezoid = (beta: number, p: number) => (1 - Math.sqrt((1 - p) * (1 - beta * beta))) / Math.sqrt((1 + beta * beta) / 6);

/** Threshold for a dominant rectangular term: u_N / u_R ≲ 0.70 (UKAS M3003 C.4, for 95.45 %). */
export const DOMINANT_RATIO = 0.7;

/**
 * Checks whether one rectangular contribution dominates the budget
 * (UKAS M3003 C.4; EA-4/02 S9.14; GUM G.6.5). `contributions` are |cᵢ|·u(xᵢ).
 */
export function dominantRectangular(contributions: { ui: number; rectangular: boolean }[]) {
  let idx = -1;
  for (let i = 0; i < contributions.length; i++) {
    if (contributions[i].rectangular && (idx < 0 || contributions[i].ui > contributions[idx].ui)) idx = i;
  }
  if (idx < 0 || !(contributions[idx].ui > 0)) return null;
  const uR = contributions[idx].ui;
  const uN = Math.sqrt(contributions.reduce((a, c, i) => (i === idx ? a : a + c.ui * c.ui), 0));
  const ratio = uN / uR;
  return { index: idx, uR, uN, ratio, dominant: ratio <= DOMINANT_RATIO };
}

// --- Type B inputs -> standard uncertainty ----------------------------------

export type InputKind = 'normal-k' | 'normal-p' | 'rectangular' | 'triangular' | 'u-shaped' | 'resolution' | 'standard';

/** Divisor that turns the entered value into a standard uncertainty (GUM 4.3.3–4.3.9, F.2.2.1, H.1.3.4). */
export function divisor(kind: InputKind, opts: { k?: number; p?: number } = {}) {
  switch (kind) {
    case 'normal-k':
      return opts.k ?? 2;
    case 'normal-p':
      // Expanded uncertainty quoted at a confidence level, normal distribution assumed (GUM 4.3.4).
      return opts.p! > 0 && opts.p! < 1 ? normInv((1 + opts.p!) / 2) : NaN;
    case 'rectangular':
      return Math.sqrt(3);
    case 'triangular':
      return Math.sqrt(6);
    case 'u-shaped':
      return Math.sqrt(2);
    case 'resolution':
      return Math.sqrt(12); // full resolution step δx -> δx/√12
    case 'standard':
      return 1;
  }
}

export interface CalcRow {
  name: string;
  /** Standard uncertainty u(xᵢ) in the input unit. */
  u: number;
  /** Sensitivity coefficient cᵢ (default 1). */
  c?: number;
  /** Degrees of freedom (default ∞). */
  nu?: number;
  /** Rectangular-type input (rectangular limits or resolution): used by the dominance check. */
  rectangular?: boolean;
}

/**
 * Full budget evaluation: contributions, shares, u_c (GUM 5.1.2), ν_eff
 * (Welch–Satterthwaite), k = t_p(ν_eff) and U = k·u_c (GUM G.6.4), plus the
 * dominant-rectangular check and its alternative coverage factor.
 */
export function evaluateBudget(rows: CalcRow[], opts: { p?: number; mode?: DofMode } = {}) {
  const p = opts.p ?? coverageNormal(2);
  const comb = combine(rows.map((r) => ({ name: r.name, u: r.u, c: r.c })));
  const nuEff = welchSatterthwaite(rows);
  const { k, nu } = coverageFactor(p, nuEff, opts.mode ?? 'floor');
  const kExact = tCoverage(p, nuEff);
  const dom = dominantRectangular(comb.rows.map((r, i) => ({ ui: r.ui, rectangular: !!rows[i].rectangular })));
  const kDominant = dom && dom.dominant ? kRectNormal(dom.ratio, p) : NaN;
  return {
    rows: comb.rows.map((r, i) => ({ ...r, nu: rows[i].nu ?? Infinity })),
    uc: comb.uc,
    nuEff,
    nuUsed: nu,
    k,
    kExact,
    U: k * comb.uc,
    p,
    dominant: dom,
    kDominant,
  };
}

/** Decimal places that show x to n significant digits (negative = round to tens, hundreds…). */
export function decimalsFor(x: number, n = 2) {
  if (!(Math.abs(x) > 0) || !Number.isFinite(x)) return 0;
  return n - 1 - Math.floor(Math.log10(Math.abs(roundSig(x, n))));
}

/**
 * Result statement values: U to two significant digits and y rounded to the
 * same decimal position (Global ACI-TECH-1-009 §5.3; GUM 7.2.6).
 */
export function formatResult(y: number, U: number, sig = 2) {
  const d = decimalsFor(U, sig);
  const fix = (v: number) => (d >= 0 ? v.toFixed(d) : String(Math.round(v / 10 ** -d) * 10 ** -d));
  return { y: Number.isFinite(y) ? fix(y) : '', U: fix(roundSig(U, sig)), decimals: d };
}

/** One budget line as entered in the calculator (Type A readings or a Type B value). */
export interface BudgetInput {
  name: string;
  type: 'A' | 'B';
  /** Type A: pasted readings. */
  readings?: string;
  /** Type B: how the value is given. */
  kind?: InputKind;
  /** Type B: U, half-width a, resolution step δx or u, depending on `kind`. */
  value?: number;
  /** normal-k: coverage factor of the quoted U. */
  k?: number;
  /** normal-p: coverage probability of the quoted U (0–1). */
  p?: number;
  c?: number;
  /** Type B degrees of freedom (blank = ∞). */
  nu?: number;
  unit?: string;
}

/** Converts an entered line into a standard uncertainty with its ν (Type A: GUM 4.2; Type B: GUM 4.3). */
export function inputToRow(inp: BudgetInput) {
  if (inp.type === 'A') {
    const xs = parseReadings(inp.readings ?? '');
    const a = typeAFromReadings(xs);
    return { name: inp.name, u: a.u, c: inp.c ?? 1, nu: a.nu, rectangular: false, divisor: Math.sqrt(a.n), typeA: a };
  }
  const kind = inp.kind ?? 'standard';
  const d = divisor(kind, { k: inp.k, p: inp.p });
  return {
    name: inp.name,
    u: Math.abs(inp.value ?? NaN) / d,
    c: inp.c ?? 1,
    nu: inp.nu != null && inp.nu > 0 ? inp.nu : Infinity,
    rectangular: kind === 'rectangular' || kind === 'resolution',
    divisor: d,
    typeA: null,
  };
}
