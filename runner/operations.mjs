// Operations: each one maps the `inputs` of a case (plain numbers, units
// stripped) to named outputs, using the reference implementation in reference/.
// A case names its operation in `operation`; the output names match the keys
// of `expected`.
import * as risk from '../reference/risk.ts';
import * as gb from '../reference/guardband.ts';
import * as unc from '../reference/uncertainty.ts';
import * as grr from '../reference/grr.ts';
import * as pip from '../reference/pipette.ts';
import * as rel from '../reference/reliability.ts';
import * as pg from '../reference/pressure-gauge.ts';
import * as sc from '../reference/scale-tests.ts';
import * as bp from '../reference/boiling-point.ts';

// JSON has no Infinity: a missing tolerance limit is written as null.
const lim = (x, side) => (x == null ? side * Infinity : x);
const nu = (x) => (x == null ? Infinity : x);

/** Bisection on f, where f(lo) and f(hi) have opposite signs. */
function bisect(f, lo, hi, it = 100) {
  const flo = f(lo);
  for (let i = 0; i < it; i++) {
    const mid = (lo + hi) / 2;
    if (Math.sign(f(mid)) === Math.sign(flo)) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Process standard deviation from inputs: given directly, or from the end-of-period reliability (EOPR). */
function processSd(i) {
  if (i.process_sd != null) return i.process_sd;
  return risk.sigmaFromEopr(i.tolerance_upper, i.eopr);
}

function globalInputs(i) {
  return {
    lower: i.tolerance_lower,
    upper: i.tolerance_upper,
    u: i.standard_uncertainty,
    mu0: i.process_mean ?? 0,
    sigma0: processSd(i),
    accLower: i.acceptance_lower ?? undefined,
    accUpper: i.acceptance_upper ?? undefined,
  };
}

/** Uncertainty budget row from a case row (readings as an array of numbers). */
function budgetRow(r) {
  return unc.inputToRow({
    name: r.name,
    type: r.readings ? 'A' : 'B',
    readings: r.readings ? r.readings.join('\n') : undefined,
    kind: r.kind,
    value: r.value,
    k: r.coverage_factor,
    c: r.sensitivity ?? 1,
    nu: r.dof ?? undefined,
  });
}

export const operations = {
  // ---------------------------------------------------------------- TUR, TAR, decision risk
  'tur'(i) {
    const U = i.expanded_uncertainty ?? i.coverage_factor * i.standard_uncertainty;
    return { tur: risk.tur(i.tolerance_lower, i.tolerance_upper, U) };
  },
  'tar'(i) {
    return { tar: risk.tar(i.tolerance_lower, i.tolerance_upper, i.standard_accuracy) };
  },
  'specific-risk'(i) {
    const r = risk.specificRisk(i.measured_value, i.standard_uncertainty, lim(i.tolerance_lower, -1), lim(i.tolerance_upper, 1));
    return { probability_of_conformity: r.pConform, probability_of_nonconformity: r.pOut };
  },
  'conformity-interval'(i) {
    // Measured values for which the probability of conformity is at least `min_probability`.
    const f = (y) => risk.specificRisk(y, i.standard_uncertainty, i.tolerance_lower, i.tolerance_upper).pConform - i.min_probability;
    const mid = (i.tolerance_lower + i.tolerance_upper) / 2;
    return {
      lowest_measured_value: bisect(f, i.tolerance_lower, mid),
      highest_measured_value: bisect(f, mid, i.tolerance_upper),
    };
  },
  'guarded-rejection-relative'(i) {
    // Upper limit L, relative standard uncertainty w (u = w·v): reject when the probability
    // that the true value exceeds L is at least p. Threshold v = L / (1 − w·z), z = Φ⁻¹(p).
    const z = risk.normInv(i.probability);
    return { z, rejection_threshold: i.limit / (1 - i.relative_standard_uncertainty * z) };
  },
  'acceptance-limit-for-specific-risk'(i) {
    // Symmetric two-sided tolerance: acceptance limit where the specific risk equals the target.
    const f = (x) => risk.specificRisk(x, i.standard_uncertainty, i.tolerance_lower, i.tolerance_upper).pOut - i.max_specific_risk;
    return { acceptance_limit: bisect(f, (i.tolerance_lower + i.tolerance_upper) / 2, i.tolerance_upper) };
  },
  'sigma-from-eopr'(i) {
    return { process_sd: risk.sigmaFromEopr(i.tolerance_limit, i.eopr) };
  },
  'global-risk'(i) {
    const g = risk.globalRisk(globalInputs(i));
    const pAccept = g.pInTol - g.pfr + g.pfa;
    return { probability_in_tolerance: g.pInTol, pfa: g.pfa, pfr: g.pfr, probability_accept: pAccept, cfar: g.pfa / pAccept };
  },
  'acceptance-limit-for-global-pfa'(i) {
    // Symmetric acceptance limit ±A giving the target unconditional PFA. A may exceed the
    // tolerance limit L (negative guard band), as in NASA-HDBK-8739.19-4 Table 5-1.
    const base = globalInputs(i);
    const L = i.tolerance_upper;
    const A = bisect((a) => risk.globalRisk({ ...base, accLower: -a, accUpper: a }).pfa - i.target_pfa, 0.5 * L, 1.4 * L);
    const g = risk.globalRisk({ ...base, accLower: -A, accUpper: A });
    return { acceptance_ratio: A / L, pfr: g.pfr };
  },
  'uncertainty-for-global-pfa'(i) {
    // Simple acceptance, centered process: the measurement u that gives the target PFA.
    const L = i.tolerance_upper;
    const s0 = risk.sigmaFromEopr(L, i.probability_in_tolerance);
    const base = { lower: -L, upper: L, mu0: 0, sigma0: s0 };
    const u = bisect((x) => risk.globalRisk({ ...base, u: x }).pfa - i.target_pfa, 0.001 * L, 2 * L);
    const g = risk.globalRisk({ ...base, u });
    const pAccept = g.pInTol - g.pfr + g.pfa;
    return { standard_uncertainty: u, probability_accept: pAccept, pfr: g.pfr, cfar: g.pfa / pAccept };
  },
  'eopr-for-global-pfa'(i) {
    // Simple acceptance, centered process, u = L / (k·TUR): the EOPR at which PFA equals the target.
    const L = 1, u = L / (i.coverage_factor * i.tur);
    const f = (r) => risk.globalRisk({ lower: -L, upper: L, u, mu0: 0, sigma0: risk.sigmaFromEopr(L, r) }).pfa - i.target_pfa;
    return { eopr: bisect(f, 0.7, 0.99) };
  },
  'max-pfa-over-tur-observed-eopr'(i) {
    // Observed EOPR corrected to true EOPR (NASA-HDBK-8739.19-4 eq. 4-17); maximum PFA over all TURs.
    let max = 0;
    for (let u = 0.02; u <= 1.2; u += 0.005) {
      const s0 = risk.sigmaFromObservedEopr(1, i.observed_eopr, u);
      if (!Number.isFinite(s0)) continue;
      max = Math.max(max, risk.globalRisk({ lower: -1, upper: 1, u, mu0: 0, sigma0: s0 }, 600).pfa);
    }
    return { max_pfa: max };
  },

  // ---------------------------------------------------------------- guard banding
  'guard-factor-one-sided'(i) {
    const kw = gb.guardFactor(i.max_pfa);
    const sign = i.tolerance_upper != null ? -1 : 1;
    const T = i.tolerance_upper ?? i.tolerance_lower;
    return { guard_factor: kw, acceptance_limit: T + sign * kw * i.standard_uncertainty };
  },
  'guard-factor-two-sided'(i) {
    const kw = gb.guardFactorTwoSided(i.tolerance_limit, i.standard_uncertainty, i.max_pfa);
    return { guard_factor: kw, acceptance_limit: i.tolerance_limit - kw * i.standard_uncertainty };
  },
  'worst-case-global-pfa'(i) {
    // Tolerance ±1, U = 1/TUR with coverage factor k, acceptance limit 1 − M·U, centered normal
    // process; the maximum global PFA over all EOPRs and the EOPR where it occurs.
    const L = 1, U = L / i.tur;
    const m = gb.maxGlobalPfa(L, U, i.coverage_factor, L - (i.guard_band_multiplier ?? 0) * U);
    return { max_pfa: m.pfa, eopr_at_max: m.eopr };
  },
  'dobbert-multiplier'(i) {
    return { guard_band_multiplier: gb.dobbertMultiplier(i.tur) };
  },

  // ---------------------------------------------------------------- measurement uncertainty
  'standard-uncertainty'(i) {
    return { standard_uncertainty: Math.abs(i.value) / unc.divisor(i.kind, { k: i.coverage_factor, p: i.coverage_probability }) };
  },
  'expanded-uncertainty'(i) {
    return { expanded_uncertainty: unc.expand(i.combined_standard_uncertainty, i.coverage_factor) };
  },
  'coverage-probability-normal'(i) {
    return { coverage_probability: unc.coverageNormal(i.coverage_factor) };
  },
  'type-a'(i) {
    const a = unc.typeAFromReadings(i.readings);
    return { mean: a.mean, standard_deviation: a.s, standard_uncertainty_of_mean: a.u, degrees_of_freedom: a.nu };
  },
  'uncertainty-budget'(i) {
    const rows = i.rows.map(budgetRow);
    const r = unc.evaluateBudget(rows, { p: i.coverage_probability, mode: i.dof_mode ?? 'floor' });
    const out = {
      combined_standard_uncertainty: r.uc,
      effective_degrees_of_freedom: r.nuEff,
      degrees_of_freedom_used: r.nuUsed,
      coverage_factor: r.k,
      expanded_uncertainty: r.U,
      dominant_rectangular: !!(r.dominant && r.dominant.dominant),
    };
    r.rows.forEach((x, n) => (out[`contribution_${n + 1}`] = x.ui));
    if (r.dominant && r.dominant.dominant) {
      out.dominant_row = r.dominant.index + 1;
      out.dominant_ratio = r.dominant.ratio;
      out.coverage_factor_dominant = r.kDominant;
      out.expanded_uncertainty_dominant = r.kDominant * r.uc;
    }
    return out;
  },
  'welch-satterthwaite'(i) {
    const rows = i.rows.map((r) => ({ u: r.standard_uncertainty, nu: nu(r.dof) }));
    return { combined_standard_uncertainty: unc.combine(rows).uc, effective_degrees_of_freedom: unc.welchSatterthwaite(rows) };
  },
  't-coverage-factor'(i) {
    return { coverage_factor: unc.tCoverage(i.coverage_probability, nu(i.dof)) };
  },
  'dof-from-reliability'(i) {
    return { degrees_of_freedom: unc.nuFromReliability(i.relative_uncertainty_of_u) };
  },
  'k-rectangular'(i) {
    return { coverage_factor: unc.kRectangular(i.coverage_probability) };
  },
  'k-trapezoidal'(i) {
    return { coverage_factor: unc.kTrapezoid(i.beta, i.coverage_probability) };
  },
  'k-rectangular-plus-normal'(i) {
    return { coverage_factor: unc.kRectNormal(i.ratio, i.coverage_probability) };
  },
  'dominant-rectangular'(i) {
    const c = i.contributions.map((x) => ({ ui: x.standard_uncertainty, rectangular: x.distribution === 'rectangular' }));
    const d = unc.dominantRectangular(c);
    return { u_rectangular: d.uR, u_rest: d.uN, ratio: d.ratio, dominant: d.dominant, coverage_factor: unc.kRectNormal(d.ratio, i.coverage_probability) };
  },
  'root-sum-square'(i) {
    const uc = Math.hypot(...i.standard_uncertainties);
    return { combined_standard_uncertainty: uc, expanded_uncertainty: i.coverage_factor * uc };
  },

  // ---------------------------------------------------------------- gauge R&R
  'grr-anova'(i) {
    const A = grr.anova(i.measurements, {
      tolerance: i.tolerance ?? undefined,
      interaction: i.interaction ?? undefined,
      alpha: i.alpha ?? undefined,
      ndcFactor: i.ndc_factor ?? undefined,
      k: i.study_variation_multiplier ?? undefined,
    });
    const w = Object.fromEntries(A.tableWith.map((r) => [r.source, r]));
    const wo = Object.fromEntries((A.tableWithout ?? []).map((r) => [r.source, r]));
    const out = {
      ss_part: w['Part'].ss, ss_operator: w['Operator'].ss, ss_part_x_operator: w['Part × Operator'].ss,
      ss_repeatability: w['Repeatability'].ss, ss_total: w['Total'].ss,
      f_part_with_interaction: w['Part'].F, f_operator_with_interaction: w['Operator'].F,
      f_part_x_operator: w['Part × Operator'].F, p_part_x_operator: A.interactionP,
      interaction_kept: A.interactionKept,
      ms_repeatability_pooled: wo['Repeatability']?.ms, f_part_without_interaction: wo['Part']?.F, f_operator_without_interaction: wo['Operator']?.F,
      var_grr: A.variance.grr, var_repeatability: A.variance.repeatability, var_operator: A.variance.operator,
      var_interaction: A.variance.interaction, var_part: A.variance.part, var_total: A.variance.total,
      pct_contribution_grr: A.pctContribution.grr, pct_contribution_repeatability: A.pctContribution.repeatability,
      pct_contribution_reproducibility: A.pctContribution.reproducibility, pct_contribution_part: A.pctContribution.part,
      sd_grr: A.sd.grr, sd_repeatability: A.sd.repeatability, sd_reproducibility: A.sd.reproducibility, sd_part: A.sd.part, sd_total: A.sd.total,
      study_var_grr: A.studyVar.grr,
      pct_study_var_grr: A.pctStudyVar.grr, pct_study_var_repeatability: A.pctStudyVar.repeatability,
      pct_study_var_reproducibility: A.pctStudyVar.reproducibility, pct_study_var_part: A.pctStudyVar.part,
      ndc: A.ndc,
    };
    if (A.pctTolerance) {
      Object.assign(out, {
        pct_tolerance_grr: A.pctTolerance.grr, pct_tolerance_repeatability: A.pctTolerance.repeatability,
        pct_tolerance_reproducibility: A.pctTolerance.reproducibility, pct_tolerance_part: A.pctTolerance.part, pct_tolerance_total: A.pctTolerance.total,
      });
    }
    return out;
  },
  'grr-average-range'(i) {
    const R = grr.averageRange(i.measurements, i.constants ? { constants: i.constants } : {});
    return {
      K1: R.K.K1, K2: R.K.K2, K3: R.K.K3,
      average_range: R.rbarbar, operator_mean_range: R.xdiff, part_mean_range: R.rp,
      EV: R.EV, AV: R.AV, GRR: R.GRR, PV: R.PV, TV: R.TV,
      pct_EV: R.pct.EV, pct_AV: R.pct.AV, pct_GRR: R.pct.GRR, pct_PV: R.pct.PV,
    };
  },
  'range-constants'(i) {
    const out = {};
    if (i.subgroups == null) { out.d2 = grr.d2(i.subgroup_size); out.d3 = grr.d3(i.subgroup_size); }
    else out.d2_star = grr.d2star(i.subgroup_size, i.subgroups);
    return out;
  },
  'f-upper-tail-probability'(i) {
    return { p_value: grr.fPValue(i.f, i.df_numerator, i.df_denominator) };
  },

  // ---------------------------------------------------------------- pipettes and gravimetric volume
  'water-density'(i) {
    return { water_density: pip.waterDensity(i.water_temperature, i.air_saturated) };
  },
  'volume-from-mass'(i) {
    const c = { waterTemp: i.water_temperature, airTemp: i.air_temperature, pressure: i.pressure, humidity: i.relative_humidity };
    return { volume: pip.volumeFromMass(i.mass, c), z_factor: pip.zFactor(c) };
  },
  'z-factor'(i) {
    return { z_factor: pip.zFactor({ waterTemp: i.water_temperature, airTemp: i.air_temperature ?? undefined, pressure: i.pressure, humidity: i.relative_humidity }) };
  },
  'gravimetric-volume'(i) {
    // V = m / (ρW − ρA) · (1 − ρA/ρB) · [1 − γ(t − t_ref)], with ρW from the Tanaka formula.
    const rhoW = pip.waterDensity(i.water_temperature);
    const V = (i.mass / (rhoW - i.air_density)) * (1 - i.air_density / i.weight_density) * (1 - i.expansion_coefficient * (i.water_temperature - i.reference_temperature));
    return { volume: V, water_density: rhoW };
  },
  'pipette-series'(i) {
    const r = pip.seriesFromVolumes(i.nominal_volume, i.masses.map((m) => m * i.z_factor));
    return { mean_volume: r.mean, systematic_error_pct: r.systematicPct };
  },

  // ---------------------------------------------------------------- calibration intervals
  'gamma-reliability'(i) {
    const b = rel.gammaRate(i.bop_reliability, i.eop_reliability, i.interval);
    const R = rel.gammaReliability(i.time, i.bop_reliability, b);
    return {
      rate: b,
      reliability_at_time: R,
      standard_uncertainty_at_time: rel.uncertaintyGrowth(i.initial_standard_uncertainty, i.bop_reliability, R),
    };
  },

  // ---------------------------------------------------------------- pressure gauges
  'pressure-up-down'(i) {
    const r = pg.evaluateUpDown({ ref: i.reference, up: i.reading_up, down: i.reading_down });
    return { mean_reading: r.mean, hysteresis: r.hysteresis, deviation_mean: r.devMean, deviation_up: r.devUp, deviation_down: r.devDown };
  },
  'pressure-gauge-budget'(i) {
    const b = pg.gaugeBudget({
      Uref: i.reference_expanded_uncertainty, resolution: i.resolution, analog: i.analog ?? false,
      zero: i.zero_deviation ?? 0, repeatability: i.repeatability ?? 0, hysteresis: i.hysteresis ?? 0, extra: i.extra_standard_uncertainties ?? [],
    });
    const u = (n) => b.contributions.find((c) => c.name === n).u;
    const out = { u_reference: u('reference'), u_resolution: u('resolution'), combined_standard_uncertainty: b.u, expanded_uncertainty: b.U };
    if (i.zero_deviation) out.u_zero = u('zero');
    if (i.repeatability) out.u_repeatability = u('repeatability');
    if (i.hysteresis) out.u_hysteresis = u('hysteresis');
    return out;
  },
  'error-span'(i) {
    return { error_span: pg.errorSpan(i.expanded_uncertainty, i.deviation) };
  },
  'dkd-minimum-uncertainty'(i) {
    const f = pg.dkdFloor(i.sequence, i.span);
    return { minimum_expanded_uncertainty: f.U, minimum_error_span_pct: f.errorSpan };
  },
  'head-correction-gas'(i) {
    const rho = pg.gasDensity(i.gas_density_ref, i.absolute_pressure, i.reference_pressure, i.gas_temperature, i.reference_temperature ?? 20);
    return { pressure_per_height: pg.headCorrection(rho, 1, i.gravity, i.air_density ?? 0, i.mode) };
  },
  'head-correction'(i) {
    return { pressure: pg.headCorrection(i.fluid_density, i.height, i.gravity ?? pg.G_STANDARD) };
  },
  'normal-gravity'(i) {
    return { gravity: pg.gravityAtLatitude(i.latitude) };
  },
  'percent-of-span'(i) {
    return { error_pct_of_span: pg.percentOfSpan(i.reference - i.reading, i.span) };
  },

  // ---------------------------------------------------------------- scales and balances
  'hb44-tolerance'(i) {
    return {
      maintenance_tolerance_e: sc.hb44MaintenanceTolerance(i.load_in_e, i.accuracy_class),
      acceptance_tolerance_e: sc.hb44AcceptanceTolerance(i.load_in_e, i.accuracy_class),
    };
  },
  'oiml-r76-mpe'(i) {
    return { mpe_initial_e: sc.oimlMpeInitial(i.load_in_e, i.accuracy_class), mpe_in_service_e: sc.oimlMpeInService(i.load_in_e, i.accuracy_class) };
  },
  'standard-deviation'(i) {
    return { standard_deviation: sc.stdev(i.readings) };
  },
  'eccentricity'(i) {
    return { max_abs_deviation: Math.abs(sc.eccentricity(i.readings).max) };
  },
  'u-rounding'(i) {
    return { standard_uncertainty: sc.uRounding(i.scale_interval) };
  },
  'u-eccentricity'(i) {
    return { standard_uncertainty: sc.uEccentricity(i.indication, i.max_deviation, i.test_load) };
  },
  'u-indication'(i) {
    return { standard_uncertainty: sc.uIndication({ d0: i.scale_interval_zero, dI: i.scale_interval_load, s: i.repeatability_sd, uEcc: i.u_eccentricity ?? undefined }) };
  },
  'u-error'(i) {
    const u = sc.uError(i.u_indication, i.u_reference_mass);
    return { standard_uncertainty: u, expanded_uncertainty: i.coverage_factor * u };
  },
  'global-uncertainty-scale'(i) {
    return { global_expanded_uncertainty: sc.globalUncertainty(i.alpha, i.beta, i.reading) };
  },
  'minimum-weight'(i) {
    return { minimum_weight: sc.minimumWeight(i.alpha, i.beta, i.relative_requirement, i.safety_factor) };
  },

  // ---------------------------------------------------------------- water boiling point
  'saturation-temperature'(i) {
    return { saturation_temperature: bp.saturationTemperatureK(i.pressure) };
  },
  'boiling-point'(i) {
    return { boiling_point: bp.boilingPointC(i.pressure) };
  },
  'standard-atmosphere-pressure'(i) {
    // 1 inHg = 33.8638 hPa (NIST SP 811, App. B.8)
    const hPa = bp.pressureAtAltitudeHpa(i.altitude);
    return { pressure_hpa: hPa, pressure_inhg: hPa / 33.8638 };
  },
  'boiling-point-at-altitude'(i) {
    const r = bp.boilingPointAtAltitude(i.altitude);
    return { boiling_point_f: r.f, boiling_point_c: r.c };
  },
};
