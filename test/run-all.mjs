// Runs the whole acceptance suite: before/after comparison, payload tests in
// jsdom, and the real browser handoff tests.
import { execFileSync } from 'node:child_process';
const steps = [
  ['snapshot after', ['test/snapshot.mjs', 'after']],
  ['compare to baseline', ['test/compare.mjs', 'test/baseline/before.json', 'test/out/after.json']],
  ['payload (jsdom)', ['test/payload.test.mjs']],
  ['handoff (Chromium)', ['test/handoff.test.mjs']],
  ['fair price', ['test/fair.test.mjs']],
  ['no em or en dashes', ['test/no-dashes.mjs']],
];
let failed = 0;
for (const [name, args] of steps) {
  console.log(`\n===== ${name} =====`);
  try { execFileSync(process.execPath, args, { stdio: 'inherit' }); }
  catch { failed++; console.log(`>>> ${name} FAILED`); }
}
console.log(failed ? `\n${failed} step(s) failed` : '\nALL STEPS PASSED');
process.exit(failed ? 1 : 0);
