// Usage: node test/snapshot.mjs <label> [path/to/index.html]
// Saves every displayed number for the current week and the week after, in
// file mode (no Odds API key) and live mode (frozen Odds API response).
import fs from 'node:fs';
import path from 'node:path';
import { bootApp, snapshot, ROOT } from './lib/boot.mjs';

const label = process.argv[2] || 'snap';
const htmlFile = process.argv[3] ? path.resolve(process.argv[3]) : undefined;
const out = {};
for (const live of [false, true]) {
  const { window: w, errors } = await bootApp({ live, htmlFile });
  const mode = live ? 'live' : 'file';
  out[mode + ':current'] = snapshot(w);
  w.document.getElementById('next').click();
  await new Promise(r => setTimeout(r, 20));
  out[mode + ':next'] = { slateCallouts: [...w.document.querySelectorAll('#slate > .callout')].map(e => e.textContent.replace(/\s+/g, ' ').trim()),
    slate: [...w.document.querySelectorAll('#slate article.game')].map(a => a.textContent.replace(/\s+/g, ' ').trim()) };
  out[mode + ':errors'] = errors;
  w.close();
}
fs.mkdirSync(path.join(ROOT, 'test', 'out'), { recursive: true });
const file = path.join(ROOT, 'test', 'out', label + '.json');
fs.writeFileSync(file, JSON.stringify(out, null, 1));
const nums = s => (JSON.stringify(s).match(/-?\d+(\.\d+)?%?/g) || []).length;
for (const [k, v] of Object.entries(out)) console.log(k.padEnd(14), Array.isArray(v) ? `${v.length} errors` : `${(v.slate || []).length} games, ${nums(v)} numbers`);
console.log('saved', path.relative(ROOT, file));
