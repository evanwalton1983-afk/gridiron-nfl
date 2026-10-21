// House rule: no em dashes or en dashes anywhere. Scans every tracked file
// plus new files git is not ignoring, skipping binaries, and fails on any hit.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './lib/boot.mjs';

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(f => f && !/\.(png|jpe?g|gif|ico|webp)$/i.test(f));
const DASH = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']');   // en dash, em dash
let hits = 0;
for (const f of files) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
    if (DASH.test(line)) { hits++; console.log(`  FAIL ${f}:${i + 1}: ${line.trim().slice(0, 100)}`); }
  });
}
console.log(hits ? `${hits} line(s) with an em or en dash` : `  ok   no em or en dashes in ${files.length} files`);
process.exit(hits ? 1 : 0);
