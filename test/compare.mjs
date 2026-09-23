// Compares two snapshots. The only permitted difference is the version
// string in the footer ("Model 2.1.0." to "Model 2.2.0."), which is required
// by the version bump. Every other displayed character must match.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/boot.mjs';

const [a, b] = [process.argv[2] || 'test/baseline/before.json', process.argv[3] || 'test/out/after.json']
  .map(f => JSON.parse(fs.readFileSync(path.resolve(ROOT, f), 'utf8')));
const unver = s => s.replace(/Model \d+\.\d+\.\d+\./, 'Model <version>.');
const nums = s => JSON.stringify(s).match(/-?\d+(\.\d+)?%?/g) || [];

let fail = 0, totalNums = 0;
const rows = [];
for (const key of Object.keys(a)) {
  if (key.endsWith(':errors')) continue;
  const A = a[key], B = b[key];
  for (const part of Object.keys(A)) {
    const x = A[part], y = B && B[part];
    const xs = Array.isArray(x) ? x : [x], ys = Array.isArray(y) ? y : [y];
    let same = xs.length === ys.length, diffs = [];
    for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
      const p = part === 'foot3' ? unver(xs[i] ?? '') : xs[i], q = part === 'foot3' ? unver(ys[i] ?? '') : ys[i];
      if (p !== q) { same = false; diffs.push(i); }
    }
    const n = nums(x).length; totalNums += n;
    rows.push([key, part, xs.length, n, same ? 'identical' : 'DIFFERENT at ' + diffs.slice(0, 5).join(',')]);
    if (!same) fail++;
  }
}
const w = [14, 15, 7, 8];
console.log(['snapshot', 'section', 'items', 'numbers', 'result'].map((h, i) => h.padEnd(w[i] || 0)).join(' '));
for (const r of rows) console.log(r.map((c, i) => String(c).padEnd(w[i] || 0)).join(' '));
const va = (a['file:current'].foot3.match(/Model (\S+)\./) || [])[1], vb = (b['file:current'].foot3.match(/Model (\S+)\./) || [])[1];
console.log(`\nfooter version: ${va} -> ${vb} (the one permitted difference)`);
console.log(`${totalNums} displayed numbers compared, ${fail} section(s) different`);
process.exit(fail ? 1 : 0);
