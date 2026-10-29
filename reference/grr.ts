// Reference implementation copied from the acribi.com calculators (website/src/lib/grr.ts).
// Pure calculation code, no UI. MIT License, see LICENSE.

// Gauge R&R (crossed study: every operator measures every part several times).
// Pure functions shared by /learn/msa/gauge-rr/ and /tools/gauge-rr-calculator/.
//
// Methods and conventions (sources and decisions:
// (Citations in cases/.)
//   - ANOVA, two-factor random model with operator × part interaction. The
//     interaction is pooled into repeatability when its p-value > alpha
//     (default 0.05, as in the published AIAG/Minitab example). Negative
//     variance components are set to zero.
//   - Average and range method (ARM): EV = R̿·K1, AV = √((X̄diff·K2)² − EV²/(n·r)),
//     PV = Rp·K3, with K1 = 1/d2(r), K2 = 1/d2*(o, 1), K3 = 1/d2*(p, 1), computed
//     here by numerical integration (not copied from any table).
//   - Study variation = k·σ with k = 6 by default (5.15 in older material).
//   - ndc = 1.41 × σ_part / σ_GRR, truncated, minimum 1 (Minitab uses √2).
// Validated by the cases in cases/ against the published examples T1–T5.

import { normCdf } from './risk.ts';
import { ibeta } from './uncertainty.ts';

/** Measurements indexed as data[operator][part][trial]. */
export type GrrData = number[][][];

export interface StudySize { operators: number; parts: number; trials: number }

/** Checks the study is balanced and big enough. Returns error messages (empty = valid). */
export function validateData(data: GrrData): string[] {
  const errs: string[] = [];
  const o = data.length;
  if (o < 2) errs.push('At least 2 operators are needed.');
  const p = data[0]?.length ?? 0;
  if (p < 2) errs.push('At least 2 parts are needed.');
  const r = data[0]?.[0]?.length ?? 0;
  if (r < 2) errs.push('At least 2 trials per part are needed.');
  data.forEach((op, i) => {
    if (op.length !== p) errs.push(`Operator ${i + 1} has ${op.length} parts; expected ${p}.`);
    op.forEach((part, j) => {
      if (part.length !== r) errs.push(`Operator ${i + 1}, part ${j + 1} has ${part.length} trials; expected ${r}.`);
      if (part.some((x) => !Number.isFinite(x))) errs.push(`Operator ${i + 1}, part ${j + 1} has a missing or invalid value.`);
    });
  });
  if (!errs.length) {
    const all = data.flat(2);
    if (all.every((x) => x === all[0])) errs.push('All readings are identical, so there is no variation to analyze.');
  }
  return errs;
}

export const studySize = (data: GrrData): StudySize => ({ operators: data.length, parts: data[0].length, trials: data[0][0].length });

const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;
const range = (xs: number[]) => Math.max(...xs) - Math.min(...xs);

// ---------------------------------------------------------------------------
// F distribution
// ---------------------------------------------------------------------------

/** Upper-tail p-value of an F statistic with (d1, d2) degrees of freedom. */
export const fPValue = (F: number, d1: number, d2: number) => (F <= 0 ? 1 : F === Infinity ? 0 : ibeta(d2 / 2, d1 / 2, d2 / (d2 + d1 * F)));

// ---------------------------------------------------------------------------
// Range constants d2, d3, d2* (normal samples of size m)
// ---------------------------------------------------------------------------

const d2Cache = new Map<number, number>();
const er2Cache = new Map<number, number>();

/** d2(m) = E[R]/σ for the range of m normal values: ∫ 1 − Φ(x)^m − (1 − Φ(x))^m dx. */
export function d2(m: number): number {
  const hit = d2Cache.get(m);
  if (hit !== undefined) return hit;
  const a = -12, b = 12, n = 6000, h = (b - a) / n;
  const f = (x: number) => { const P = normCdf(x); return 1 - P ** m - (1 - P) ** m; };
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * f(a + i * h);
  const v = (s * h) / 3;
  d2Cache.set(m, v);
  return v;
}

/** E[R²]/σ² for the range of m normal values (double integral over x < y). */
function er2(m: number): number {
  const hit = er2Cache.get(m);
  if (hit !== undefined) return hit;
  const N = 600, a = -8, b = 8, h = (b - a) / N;
  const P: number[] = [];
  for (let i = 0; i <= N; i++) P.push(normCdf(a + i * h));
  let tot = 0;
  for (let i = 0; i <= N; i++) {
    const qi = (1 - P[i]) ** m;
    for (let j = i; j <= N; j++) {
      const val = 1 - P[j] ** m - qi + (P[j] - P[i]) ** m;
      tot += (i === j ? 0.5 : 1) * val;
    }
  }
  const v = 2 * tot * h * h;
  er2Cache.set(m, v);
  return v;
}

/** d3(m) = SD(R)/σ. */
export const d3 = (m: number) => Math.sqrt(Math.max(er2(m) - d2(m) ** 2, 0));

/** d2*(m, g) ≈ √(d2² + d3²/g) (Duncan). With g = 1 it is √(E[R²])/σ. */
export const d2star = (m: number, g: number) => Math.sqrt(d2(m) ** 2 + d3(m) ** 2 / g);

export interface KConstants { K1: number; K2: number; K3: number }

/** ARM constants (1σ convention of the AIAG MSA 4th ed.): K1 = 1/d2(r), K2 = 1/d2*(o,1), K3 = 1/d2*(p,1). */
export const kConstants = ({ operators, parts, trials }: StudySize): KConstants => ({
  K1: 1 / d2(trials),
  K2: 1 / d2star(operators, 1),
  K3: 1 / d2star(parts, 1),
});

// ---------------------------------------------------------------------------
// Shared result shape
// ---------------------------------------------------------------------------

export interface GrrOptions {
  /** Study-variation multiplier: 6 (default) or 5.15. */
  k?: number;
  /** Tolerance width USL − LSL, for %Tolerance. */
  tolerance?: number;
  /** ndc constant: 1.41 (default) or Math.SQRT2. */
  ndcFactor?: number;
}

export interface Components {
  /** Standard deviations (1σ). */
  repeatability: number;
  reproducibility: number;
  operator: number;
  interaction: number;
  grr: number;
  part: number;
  total: number;
}

export interface GrrSummary {
  sd: Components;
  /** Variance components (σ²). */
  variance: Components;
  /** k·σ. */
  studyVar: Components;
  /** 100·σ/σ_total (does not add up to 100). */
  pctStudyVar: Components;
  /** 100·σ²/σ²_total (adds up to 100). */
  pctContribution: Components;
  /** 100·k·σ/tolerance, if a tolerance was given. */
  pctTolerance?: Components;
  ndc: number;
  ndcRaw: number;
}

function summarize(v: Omit<Components, 'reproducibility' | 'grr' | 'total'>, opts: GrrOptions): GrrSummary {
  const k = opts.k ?? 6;
  const f = opts.ndcFactor ?? 1.41;
  const variance: Components = {
    repeatability: v.repeatability,
    operator: v.operator,
    interaction: v.interaction,
    reproducibility: v.operator + v.interaction,
    grr: v.repeatability + v.operator + v.interaction,
    part: v.part,
    total: v.repeatability + v.operator + v.interaction + v.part,
  };
  const map = (fn: (x: number, key: keyof Components) => number) =>
    Object.fromEntries((Object.keys(variance) as (keyof Components)[]).map((key) => [key, fn(variance[key], key)])) as unknown as Components;
  const sd = map((x) => Math.sqrt(x));
  const ndcRaw = sd.grr > 0 ? (f * sd.part) / sd.grr : Infinity;
  return {
    sd,
    variance,
    studyVar: map((_, key) => k * sd[key]),
    pctStudyVar: map((_, key) => (100 * sd[key]) / sd.total),
    pctContribution: map((x) => (100 * x) / variance.total),
    pctTolerance: opts.tolerance ? map((_, key) => (100 * k * sd[key]) / opts.tolerance!) : undefined,
    ndcRaw,
    ndc: Number.isFinite(ndcRaw) ? Math.max(1, Math.floor(ndcRaw)) : Infinity,
  };
}

// ---------------------------------------------------------------------------
// ANOVA method
// ---------------------------------------------------------------------------

export interface AnovaRow { source: string; df: number; ss: number; ms: number; F?: number; p?: number }

export interface AnovaOptions extends GrrOptions {
  /** p-value above which the interaction is pooled (default 0.05). */
  alpha?: number;
  /** 'auto' (default): pool if p > alpha; 'keep': always keep; 'pool': always pool. */
  interaction?: 'auto' | 'keep' | 'pool';
}

export interface AnovaResult extends GrrSummary {
  method: 'anova';
  /** Two-way table with interaction (F for parts and operators over MS interaction). */
  tableWith: AnovaRow[];
  /** Table without interaction, if it was pooled. */
  tableWithout?: AnovaRow[];
  interactionP: number;
  interactionKept: boolean;
  /** Variance components that came out negative and were set to zero. */
  zeroed: string[];
}

export function anova(data: GrrData, opts: AnovaOptions = {}): AnovaResult {
  const { operators: o, parts: p, trials: r } = studySize(data);
  const all = data.flat(2);
  const gm = mean(all);
  const partMeans = Array.from({ length: p }, (_, j) => mean(data.flatMap((op) => op[j])));
  const opMeans = data.map((op) => mean(op.flat()));
  const SST = all.reduce((a, x) => a + (x - gm) ** 2, 0);
  const SSP = o * r * partMeans.reduce((a, m) => a + (m - gm) ** 2, 0);
  const SSO = p * r * opMeans.reduce((a, m) => a + (m - gm) ** 2, 0);
  let SSE = 0;
  data.forEach((op) => op.forEach((cell) => { const m = mean(cell); cell.forEach((x) => { SSE += (x - m) ** 2; }); }));
  const SSPO = SST - SSP - SSO - SSE;
  const dP = p - 1, dO = o - 1, dPO = (p - 1) * (o - 1), dE = p * o * (r - 1);
  const MSP = SSP / dP, MSO = SSO / dO, MSPO = SSPO / dPO, MSE = SSE / dE;
  // A perfect gauge (no within-cell spread) gives MSE = 0: treat any interaction as infinitely significant.
  const FPO = MSE > 0 ? MSPO / MSE : MSPO > 0 ? Infinity : 0;
  const pPO = fPValue(FPO, dPO, dE);
  const tableWith: AnovaRow[] = [
    { source: 'Part', df: dP, ss: SSP, ms: MSP, F: MSP / MSPO, p: fPValue(MSP / MSPO, dP, dPO) },
    { source: 'Operator', df: dO, ss: SSO, ms: MSO, F: MSO / MSPO, p: fPValue(MSO / MSPO, dO, dPO) },
    { source: 'Part × Operator', df: dPO, ss: SSPO, ms: MSPO, F: FPO, p: pPO },
    { source: 'Repeatability', df: dE, ss: SSE, ms: MSE },
    { source: 'Total', df: p * o * r - 1, ss: SST, ms: NaN },
  ];
  const mode = opts.interaction ?? 'auto';
  const keep = mode === 'keep' || (mode === 'auto' && pPO <= (opts.alpha ?? 0.05));
  const zeroed: string[] = [];
  const nz = (x: number, name: string) => { if (x < 0) { zeroed.push(name); return 0; } return x; };
  let comp: Omit<Components, 'reproducibility' | 'grr' | 'total'>;
  let tableWithout: AnovaRow[] | undefined;
  if (keep) {
    comp = {
      repeatability: MSE,
      operator: nz((MSO - MSPO) / (p * r), 'Operator'),
      interaction: nz((MSPO - MSE) / r, 'Part × Operator'),
      part: nz((MSP - MSPO) / (o * r), 'Part'),
    };
  } else {
    const dEp = dPO + dE;
    const MSEp = (SSPO + SSE) / dEp;
    tableWithout = [
      { source: 'Part', df: dP, ss: SSP, ms: MSP, F: MSP / MSEp, p: fPValue(MSP / MSEp, dP, dEp) },
      { source: 'Operator', df: dO, ss: SSO, ms: MSO, F: MSO / MSEp, p: fPValue(MSO / MSEp, dO, dEp) },
      { source: 'Repeatability', df: dEp, ss: SSPO + SSE, ms: MSEp },
      { source: 'Total', df: p * o * r - 1, ss: SST, ms: NaN },
    ];
    comp = {
      repeatability: MSEp,
      operator: nz((MSO - MSEp) / (p * r), 'Operator'),
      interaction: 0,
      part: nz((MSP - MSEp) / (o * r), 'Part'),
    };
  }
  return { method: 'anova', ...summarize(comp, opts), tableWith, tableWithout, interactionP: pPO, interactionKept: keep, zeroed };
}

// ---------------------------------------------------------------------------
// Average and range method
// ---------------------------------------------------------------------------

export interface ArmOptions extends GrrOptions {
  /** Override K1, K2, K3 (for example the rounded values printed in a reference). */
  constants?: Partial<KConstants>;
}

export interface ArmResult {
  method: 'arm';
  K: KConstants;
  rbarByOperator: number[];
  xbarByOperator: number[];
  /** Average range R̿, operator-average range X̄diff, range of part averages Rp. */
  rbarbar: number;
  xdiff: number;
  rp: number;
  /** 1σ estimates. */
  EV: number;
  AV: number;
  GRR: number;
  PV: number;
  TV: number;
  /** 100·X/TV (does not add up to 100). */
  pct: { EV: number; AV: number; GRR: number; PV: number };
  /** 100·X²/TV² (adds up to 100). */
  pctContribution: { EV: number; AV: number; GRR: number; PV: number };
  pctTolerance?: { EV: number; AV: number; GRR: number; PV: number; TV: number };
  ndc: number;
  ndcRaw: number;
}

export function averageRange(data: GrrData, opts: ArmOptions = {}): ArmResult {
  const size = studySize(data);
  const { parts: p, trials: r } = size;
  const K = { ...kConstants(size), ...opts.constants };
  const rbarByOperator = data.map((op) => mean(op.map(range)));
  const xbarByOperator = data.map((op) => mean(op.flat()));
  const rbarbar = mean(rbarByOperator);
  const xdiff = range(xbarByOperator);
  const partMeans = Array.from({ length: p }, (_, j) => mean(data.flatMap((op) => op[j])));
  const rp = range(partMeans);
  const EV = rbarbar * K.K1;
  const av2 = (xdiff * K.K2) ** 2 - EV ** 2 / (p * r);
  const AV = av2 > 0 ? Math.sqrt(av2) : 0;
  const GRR = Math.hypot(EV, AV);
  const PV = rp * K.K3;
  const TV = Math.hypot(GRR, PV);
  const k = opts.k ?? 6;
  const f = opts.ndcFactor ?? 1.41;
  const ndcRaw = GRR > 0 ? (f * PV) / GRR : Infinity;
  const t = opts.tolerance;
  return {
    method: 'arm', K, rbarByOperator, xbarByOperator, rbarbar, xdiff, rp, EV, AV, GRR, PV, TV,
    pct: { EV: (100 * EV) / TV, AV: (100 * AV) / TV, GRR: (100 * GRR) / TV, PV: (100 * PV) / TV },
    pctContribution: { EV: (100 * EV ** 2) / TV ** 2, AV: (100 * AV ** 2) / TV ** 2, GRR: (100 * GRR ** 2) / TV ** 2, PV: (100 * PV ** 2) / TV ** 2 },
    pctTolerance: t ? { EV: (100 * k * EV) / t, AV: (100 * k * AV) / t, GRR: (100 * k * GRR) / t, PV: (100 * k * PV) / t, TV: (100 * k * TV) / t } : undefined,
    ndcRaw,
    ndc: Number.isFinite(ndcRaw) ? Math.max(1, Math.floor(ndcRaw)) : Infinity,
  };
}

// ---------------------------------------------------------------------------
// Acceptance bands (AIAG MSA 4th ed. via secondary sources; see cases/gauge-rr.json)
// ---------------------------------------------------------------------------

export type GrrVerdict = 'acceptable' | 'marginal' | 'unacceptable';

/** Classify a %GRR expressed in standard deviations (%Study Var or %Tolerance): < 10, 10–30, > 30. */
export const grrVerdict = (pct: number): GrrVerdict => (pct < 10 ? 'acceptable' : pct <= 30 ? 'marginal' : 'unacceptable');
