// Reference implementation copied from the acribi.com calculators (website/src/lib/boiling-point.ts).
// Pure calculation code, no UI. MIT License, see LICENSE.

// Boiling point of pure water as a function of pressure and of altitude, for the
// boiling-water check on /instruments/thermometer/calibration-procedure/.
// Pure functions, used at build time by acribi.com pages.
//
// Sources (full citations in cases/):
// - Saturation temperature: IAPWS R7-97(2012), IAPWS-IF97, Section 8.2,
//   Eq. (31) with the coefficients of Table 34; verified against Table 36 and
//   against the NIST Chemistry WebBook (see cases/).
// - Pressure at altitude: NOAA National Weather Service, "Pressure Altitude"
//   (wxcalc), h_ft = (1 − (p/1013.25)^0.190284) × 145366.45, solved for p.
//   This is the standard atmosphere: real station pressure varies with the
//   weather, so the table is a guide, not a reference value.

const N = [
  0, // 1-based like the IAPWS table
  0.11670521452767e4,
  -0.72421316703206e6,
  -0.17073846940092e2,
  0.1202082470247e5,
  -0.32325550322333e7,
  0.1491510861353e2,
  -0.48232657361591e4,
  0.40511340542057e6,
  -0.23855557567849,
  0.65017534844798e3,
];

/** Saturation temperature in kelvin for a pressure in MPa (IAPWS-IF97 Eq. 31). */
export function saturationTemperatureK(pMPa: number): number {
  if (!(pMPa >= 611.213e-6 && pMPa <= 22.064)) throw new Error('Pressure outside the IAPWS-IF97 saturation range');
  const beta = Math.pow(pMPa, 0.25);
  const E = beta * beta + N[3] * beta + N[6];
  const F = N[1] * beta * beta + N[4] * beta + N[7];
  const G = N[2] * beta * beta + N[5] * beta + N[8];
  const D = (2 * G) / (-F - Math.sqrt(F * F - 4 * E * G));
  return (N[10] + D - Math.sqrt((N[10] + D) ** 2 - 4 * (N[9] + N[10] * D))) / 2;
}

/** Boiling point of pure water in °C for a pressure in hPa (= mbar). */
export function boilingPointC(pHpa: number): number {
  return saturationTemperatureK(pHpa / 10000) - 273.15;
}

export const cToF = (c: number) => (c * 9) / 5 + 32;

/** Standard-atmosphere pressure in hPa at an altitude in feet (NWS pressure-altitude formula, inverted). */
export function pressureAtAltitudeHpa(feet: number): number {
  return 1013.25 * Math.pow(1 - feet / 145366.45, 1 / 0.190284);
}

/** Pressure altitude in feet for a station pressure in hPa (NWS formula as published). */
export function pressureAltitudeFt(pHpa: number): number {
  return (1 - Math.pow(pHpa / 1013.25, 0.190284)) * 145366.45;
}

export interface BoilingRow { feet: number; meters: number; pressureHpa: number; c: number; f: number }

/** Boiling point of pure water at an altitude (standard atmosphere). */
export function boilingPointAtAltitude(feet: number): BoilingRow {
  const p = pressureAtAltitudeHpa(feet);
  const c = boilingPointC(p);
  return { feet, meters: feet * 0.3048, pressureHpa: p, c, f: cToF(c) };
}
