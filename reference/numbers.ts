// Reference implementation copied from the acribi.com calculators (website/src/lib/numbers.ts).
// Pure calculation code, no UI. MIT License, see LICENSE.

// US number format, shared by the calculators (acribi.com is a US site):
// dot = decimal separator, comma = thousands separator. A decimal comma is
// rejected with a message instead of being silently misread.
// Used to parse pasted readings in the uncertainty calculator.

/** Result of parsing one value. `error` is set when the text is not a valid US-format number. */
export interface ParsedNumber { value: number; error?: string }

const THOUSANDS = /^[+-]?\d{1,3}(,\d{3})+(\.\d*)?$/;
const PLAIN = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * Parses a number written in US format: dot as the decimal separator, optional
 * comma thousands separators ("1,234.5"). A comma used as a decimal separator
 * ("0,25") is rejected with a clear message rather than silently misread.
 * Unicode minus and surrounding spaces are accepted. Empty text gives NaN without error.
 */
export function parseUsNumber(raw: string): ParsedNumber {
  const t = raw.trim().replace(/[−‒–]/g, '-').replace(/\s+/g, '');
  if (t === '') return { value: NaN };
  if (PLAIN.test(t)) return { value: Number(t) };
  if (THOUSANDS.test(t)) return { value: Number(t.replace(/,/g, '')) };
  if (/^[+-]?\d*,\d+$/.test(t)) return { value: NaN, error: `"${raw.trim()}" looks like a decimal comma. Use a dot as the decimal separator (0.25, not 0,25).` };
  return { value: NaN, error: `"${raw.trim()}" is not a number.` };
}
