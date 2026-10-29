// Loads every case file in cases/, runs each case through the reference
// implementation and compares the outputs with the expected values.
// Usage: npm test            (all files)
//        npm test -- tur-risk (only files whose name contains "tur-risk")
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { operations } from './operations.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const casesDir = join(root, 'cases');
const filter = process.argv[2];
const files = readdirSync(casesDir).filter((f) => f.endsWith('.json') && !f.startsWith('_') && (!filter || f.includes(filter))).sort();

/** Strips units: { x: { value, unit } } -> { x: value }. */
const values = (inputs) => Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, v && typeof v === 'object' && 'value' in v ? v.value : v]));

const fmt = (x) => (typeof x === 'number' ? String(+x.toPrecision(8)) : String(x));

/** Returns a list of [label, ok, detail] for one expected output. */
function compare(name, got, exp) {
  const out = [];
  if ('equals' in exp) {
    out.push([name, got === exp.equals, `got ${fmt(got)}, expected ${fmt(exp.equals)}`]);
  }
  if ('value' in exp) {
    const ok = typeof got === 'number' && Math.abs(got - exp.value) <= exp.tolerance;
    out.push([name, ok, `got ${fmt(got)}, expected ${exp.value} ± ${exp.tolerance}`]);
  }
  if ('atMost' in exp) {
    out.push([`${name} (bound)`, typeof got === 'number' && got <= exp.atMost, `got ${fmt(got)}, expected ≤ ${exp.atMost}`]);
  }
  if (exp.recomputed) {
    const r = exp.recomputed;
    const ok = typeof got === 'number' && Math.abs(got - r.value) <= r.tolerance;
    out.push([`${name} (recomputed)`, ok, `got ${fmt(got)}, expected ${r.value} ± ${r.tolerance}`]);
  }
  return out;
}

let checks = 0, failed = 0, cases = 0;
for (const file of files) {
  const doc = JSON.parse(readFileSync(join(casesDir, file), 'utf8'));
  let fileChecks = 0, fileFailed = 0;
  for (const c of doc.cases) {
    cases++;
    const op = operations[c.operation];
    if (!op) throw new Error(`${file} ${c.id}: unknown operation "${c.operation}"`);
    const got = op(values(c.inputs));
    for (const [name, exp] of Object.entries(c.expected)) {
      if (!(name in got)) throw new Error(`${file} ${c.id}: operation "${c.operation}" has no output "${name}"`);
      for (const [label, ok, detail] of compare(name, got[name], exp)) {
        checks++; fileChecks++;
        if (!ok) { failed++; fileFailed++; console.log(`FAIL  ${c.id}  ${label}: ${detail}`); }
        else if (process.env.VERBOSE) console.log(`PASS  ${c.id}  ${label}: ${detail}`);
      }
    }
  }
  console.log(`${fileFailed ? 'FAIL' : 'ok  '}  ${file.padEnd(28)} ${String(doc.cases.length).padStart(3)} cases  ${fileChecks - fileFailed}/${fileChecks} checks`);
}
console.log(`\n${cases} cases, ${checks - failed}/${checks} checks passed`);
process.exit(failed ? 1 : 0);
