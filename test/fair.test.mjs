// Fair price tests. Part 1 runs the fairPrice module exactly as shipped in
// deploy/index.html, pulled out of the page. Part 2 boots the app in jsdom and
// checks the settings, the gate and the labels in file and live mode.
import fs from 'node:fs';
import path from 'node:path';
import { bootApp, APP_DIR, FIX, ROOT } from './lib/boot.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const close = (a, b, tol) => Math.abs(a - b) <= tol;
const sum = a => a.reduce((s, x) => s + x, 0);

const html = fs.readFileSync(path.join(APP_DIR, 'index.html'), 'utf8');
const src = html.match(/const fairPrice=\(\(\)=>\{[\s\S]*?\n\}\)\(\);/);
if (!src) { console.log('  FAIL fairPrice module not found in index.html'); process.exit(1); }
const fairPrice = new Function(src[0] + '\nreturn fairPrice;')();
const M = fairPrice.methods;
const amToProb = a => a > 0 ? 100 / (a + 100) : -a / (-a + 100);
const oldNoVig = (o1, o2) => { const q1 = amToProb(o1), q2 = amToProb(o2), s = q1 + q2; return s > 0 ? [q1 / s, q2 / s] : null; };

console.log('\n[1] fairPrice unit tests');

// The example in the mberk/shin README.
{
  const p = fairPrice.shin(fairPrice.implied([2.6, 2.4, 4.3]));
  const want = [0.37299406033208965, 0.4047794109200184, 0.2222265287474275];
  ok(p && p.every((x, i) => close(x, want[i], 1e-9)), `shin README example: ${p && p.map(x => x.toFixed(4)).join(', ')}`);
  ok(p && p.map(x => x.toFixed(4)).join(',') === '0.3730,0.4048,0.2222', 'shin README example to 4 places is 0.3730, 0.4048, 0.2222');
  console.log(`  shin(2.6, 2.4, 4.3) = ${p.map(x => x.toFixed(10)).join(', ')}`);
}

// Every method sums to 1: the README market, random markets of 2 to 8
// outcomes with 0 to 20% vig, and every two way price pair in the fixture.
const markets = [fairPrice.implied([2.6, 2.4, 4.3])];
let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
for (let i = 0; i < 3000; i++) {
  const n = 2 + Math.floor(rnd() * 7), w = Array.from({ length: n }, () => 0.02 + rnd());
  const s = sum(w), vig = rnd() * 0.2;
  markets.push(w.map(x => Math.min(0.995, (x / s) * (1 + vig))));
}
const csv = fs.readFileSync(path.join(FIX, 'games.csv'), 'utf8').split('\n');
const head = csv[0].split(',');
const col = k => head.indexOf(k);
const pairs = [];
for (const line of csv.slice(1)) {
  const f = line.split(',');
  for (const [a, b] of [['home_moneyline', 'away_moneyline'], ['home_spread_odds', 'away_spread_odds'], ['over_odds', 'under_odds']]) {
    const x = Number(f[col(a)]), y = Number(f[col(b)]);
    if (f[col(a)] && f[col(b)] && isFinite(x) && isFinite(y) && x !== 0 && y !== 0) pairs.push([x, y]);
  }
}
for (const [x, y] of pairs) markets.push([amToProb(x), amToProb(y)]);
let worstSum = 0, nulls = { shin: 0, power: 0, additive: 0, multiplicative: 0 }, badNull = 0;
for (const q of markets) {
  for (const m of M) {
    const p = fairPrice[m](q);
    if (!p) { nulls[m]++; if (m !== 'additive' || q.every(x => x - (sum(q) - 1) / q.length > 0)) badNull++; continue; }
    worstSum = Math.max(worstSum, Math.abs(sum(p) - 1));
    if (!p.every(x => x > 0 && x < 1)) badNull++;
  }
}
ok(worstSum < 1e-12, `every method sums to 1 on ${markets.length} markets (worst error ${worstSum.toExponential(2)})`);
ok(badNull === 0, `only additive returns null, and only when a side would go to zero or below (${badNull} other)`);
console.log(`  ${markets.length} markets (${pairs.length} from the fixture), worst sum error ${worstSum.toExponential(2)}, additive nulls ${nulls.additive}`);

// Multiplicative is the old noVig, bit for bit, on every fixture price pair.
{
  let diff = 0;
  for (const [x, y] of pairs) { const a = oldNoVig(x, y), b = fairPrice.multiplicative([amToProb(x), amToProb(y)]); if (a[0] !== b[0] || a[1] !== b[1]) diff++; }
  ok(diff === 0, `multiplicative equals the old noVig bit for bit on ${pairs.length} pairs (${diff} differ)`);
}

// Two way Shin: the closed form solves the same equation the iteration does.
{
  const shinAt = (q, z) => { const b = sum(q); return q.map(x => (Math.sqrt(z * z + 4 * (1 - z) * x * x / b) - z) / (2 * (1 - z))); };
  let worst = 0;
  for (const [x, y] of pairs.slice(0, 4000)) {
    const q = [amToProb(x), amToProb(y)];
    let lo = -0.5, hi = 0.5;
    for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (sum(shinAt(q, mid)) > 1) lo = mid; else hi = mid; }
    const ref = shinAt(q, (lo + hi) / 2), p = fairPrice.shin(q);
    worst = Math.max(worst, Math.abs(p[0] - ref[0]), Math.abs(p[1] - ref[1]));
  }
  ok(worst < 1e-10, `two way Shin closed form matches a bisection solve (worst ${worst.toExponential(2)})`);
}

// Power: k above 1 whenever the book has vig, and p really is q to the k.
{
  const q = [amToProb(-300), amToProb(250)], p = fairPrice.power(q);
  const k = Math.log(p[0]) / Math.log(q[0]);
  ok(k > 1 && close(Math.pow(q[1], k), p[1], 1e-12), `power: k ${k.toFixed(6)} above 1 and applied to both sides`);
}

// Shape: Shin and power give a big favourite more than multiplicative does.
{
  const q = [amToProb(-400), amToProb(320)];
  const mu = fairPrice.multiplicative(q)[0], sh = fairPrice.shin(q)[0], pw = fairPrice.power(q)[0];
  ok(sh > mu && pw > mu, `-400 favourite: mult ${mu.toFixed(4)}, shin ${sh.toFixed(4)}, power ${pw.toFixed(4)}`);
}

// No vig in, same probabilities out, from every method. Bad input gives null.
{
  const q = [0.25, 0.35, 0.4];
  ok(M.every(m => fairPrice[m](q).every((x, i) => close(x, q[i], 1e-12))), 'a market with no vig comes back unchanged from every method');
  ok(M.every(m => fairPrice[m]([0.6]) === null && fairPrice[m]([0.5, 1]) === null && fairPrice[m]([0.5, NaN]) === null && fairPrice[m](null) === null),
    'one outcome, a probability of 1, NaN or no array returns null');
}

console.log('\n[2] in the app');

const nums = s => JSON.stringify(s).match(/-?\d+(\.\d+)?%?/g) || [];
const unver = s => s.replace(/Model \d+\.\d+\.\d+\./, 'Model <version>.');
const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'baseline', 'before-2.1.0.json'), 'utf8'));
const { snapshot } = await import('./lib/boot.mjs');
const preset = (display, gate) => w => w.localStorage.setItem('gridiron.fair', JSON.stringify({ display, gate }));

// All betting state, as plain data, for the week on screen and the season log.
const state = w => JSON.parse(w.eval(`JSON.stringify({
  slate: GAMES.filter(g=>g.season===SEASON&&g.week===WEEK).map(g=>{const p=predictLive(g);
    return {id:g.id,pick:p.pick&&p.pick.side,bets:p.bets.map(b=>({side:b.side,ev:b.ev,pNoPush:b.pNoPush,nv:b.nv,mktEdge:b.mktEdge,fair:b.fair}))};}),
  log: FIT.log.map(e=>({id:e.g.id,pick:e.p.pick&&e.p.pick.side})),
  EV_BAR, NOVIG_BAR })`));

for (const live of [false, true]) {
  const mode = live ? 'live' : 'file';
  console.log(`  [${mode} mode]`);

  // Multiplicative for both: every displayed number matches the 2.1.0 baseline.
  {
    const { window: w, errors } = await bootApp({ live, setup: preset('multiplicative', 'multiplicative') });
    const s = snapshot(w);
    w.document.getElementById('next').click();
    await new Promise(r => setTimeout(r, 20));
    const next = { slateCallouts: [...w.document.querySelectorAll('#slate > .callout')].map(e => e.textContent.replace(/\s+/g, ' ').trim()),
      slate: [...w.document.querySelectorAll('#slate article.game')].map(a => a.textContent.replace(/\s+/g, ' ').trim()) };
    let sections = 0, differ = [], count = 0;
    for (const [key, got] of [[mode + ':current', s], [mode + ':next', next]]) {
      const want = baseline[key];
      for (const part of Object.keys(want)) {
        const a = nums(part === 'foot3' ? unver(want[part]) : want[part]), b = nums(part === 'foot3' ? unver(got[part]) : got[part]);
        sections++; count += a.length;
        if (a.join('|') !== b.join('|')) differ.push(key + '.' + part);
      }
    }
    ok(differ.length === 0, `${mode}: multiplicative setting reproduces every displayed number (${differ.join(', ')})`);
    ok(errors.length === 0, `${mode}: zero JS errors with multiplicative (${errors.join(' | ')})`);
    console.log(`    multiplicative: ${count} displayed numbers in ${sections} sections, ${differ.length} sections differ from baseline`);
    w.close();
  }

  // Defaults: Shin shown, worst case gate.
  const { window: w, errors } = await bootApp({ live });
  const d = w.document;
  ok(d.getElementById('fairDisp').value === 'shin' && d.getElementById('fairGate').value === 'worst', `${mode}: defaults are Shin and Worst case`);
  ok(/Shin shown, worst case gate/.test(d.getElementById('fairStatus').textContent), `${mode}: panel status names both`);
  const S = state(w);
  let bets = 0, gateBad = 0, edgeBad = 0, pickBad = 0, labelBad = 0;
  for (const g of S.slate) {
    for (const b of g.bets) {
      if (!b.fair) continue;
      bets++;
      const vals = Object.values(b.fair.by), hi = Math.max(...vals);
      if (b.fair.gateP !== hi || b.fair.by[b.fair.gate] !== hi) gateBad++;
      if (Math.abs(b.mktEdge - (b.pNoPush - hi)) > 1e-15) edgeBad++;
      if (b.fair.disp !== 'shin' && b.fair.by.shin != null) labelBad++;
    }
    const want = g.bets.filter(b => b.ev != null && b.ev >= S.EV_BAR && b.mktEdge != null && b.mktEdge >= S.NOVIG_BAR);
    if (g.pick && !want.some(b => b.side === g.pick)) pickBad++;
    if (!g.pick && want.length) pickBad++;
  }
  ok(bets > 0 && gateBad === 0, `${mode}: worst case gate is the highest fair probability of the four on all ${bets} priced sides`);
  ok(edgeBad === 0, `${mode}: gap is the model minus that worst case price`);
  ok(pickBad === 0, `${mode}: a side is flagged exactly when it clears both gates`);
  ok(labelBad === 0, `${mode}: displayed fair price is Shin wherever Shin has an answer`);

  // Every fair price on screen carries its method, every gap names the gate.
  const kv = [...d.querySelectorAll('#slate .board td.kv')];
  const tags = kv.map(td => (td.querySelector('.fm') || {}).textContent);
  ok(kv.length > 0 && tags.every(t => ['Shin', 'Power', 'Add', 'Mult'].includes(t)), `${mode}: all ${kv.length} no vig cells show a method (${[...new Set(tags)].join(', ')})`);
  const gaps = [...d.querySelectorAll('#slate .board td .fm')].filter(e => /^vs /.test(e.textContent));
  ok(gaps.length === kv.filter(td => td.textContent !== 'n/a').length, `${mode}: every priced gap names its gate method (${gaps.length})`);
  ok(/gated on the worst case of four fair price methods/.test(d.getElementById('slate').textContent.replace(/\s+/g, ' ')),
    `${mode}: slate callout names the gate`);

  // Worst case is stricter: its picks are a subset of multiplicative's.
  const mult = await bootApp({ live, setup: preset('shin', 'multiplicative') });
  const SM = state(mult.window);
  const subset = (a, b) => a.every((x, i) => x.id === b[i].id && (!x.pick || b[i].pick != null));
  const nW = S.log.filter(x => x.pick).length + S.slate.filter(x => x.pick).length;
  const nM = SM.log.filter(x => x.pick).length + SM.slate.filter(x => x.pick).length;
  ok(subset(S.slate, SM.slate) && subset(S.log, SM.log) && nW <= nM, `${mode}: worst case flags no game multiplicative does not (${nW} vs ${nM}, slate plus season log)`);
  mult.window.close();

  // Switching the gate in the panel refits the season log and persists.
  w.document.getElementById('tabLog').click();
  const sel = d.getElementById('fairGate');
  sel.value = 'multiplicative'; sel.dispatchEvent(new w.Event('change'));
  const S2 = state(w);
  ok(JSON.stringify(S2.log) === JSON.stringify(SM.log) && JSON.stringify(S2.slate.map(x => x.pick)) === JSON.stringify(SM.slate.map(x => x.pick)),
    `${mode}: switching the gate to Multiplicative re-flags the slate and the season log`);
  ok(JSON.parse(w.localStorage.getItem('gridiron.fair')).gate === 'multiplicative', `${mode}: the setting is saved`);
  ok(/Multiplicative fair price as the no vig gate/.test(d.getElementById('log').textContent), `${mode}: season log names the gate`);
  const ds = d.getElementById('fairDisp');
  ds.value = 'power'; ds.dispatchEvent(new w.Event('change'));
  d.getElementById('tabSlate').click();
  const tags2 = [...d.querySelectorAll('#slate .board td.kv .fm')].map(e => e.textContent);
  ok(tags2.length && tags2.every(t => t === 'Power' || t === 'Mult'), `${mode}: switching the display to Power relabels every fair price`);

  // A multiplicative consensus is exactly peConsensus's.
  if (live) {
    const eq = w.eval(`(()=>{let n=0,bad=0;for(const g of GAMES.filter(g=>g.season===SEASON&&g.week===WEEK)){const m=peEventFor(g);if(!m)continue;
      const books=peBooksOf(m.ev,PE_S.mine);
      for(const [k,a,b] of [['spreads',m.hn,m.an],['h2h',m.hn,m.an],['totals','Over','Under']]){const c=peConsensus(books,k,a,b);if(!c)continue;
        const f=fairConsensus(books,k,a,b,c);n++;if(f.multiplicative[0]!==c.pA)bad++;}}return n+':'+bad;})()`);
    const [n, bad] = eq.split(':').map(Number);
    ok(n > 0 && bad === 0, `live: multiplicative consensus equals peConsensus bit for bit on ${n} markets`);
  }
  ok(errors.length === 0, `${mode}: zero JS errors with the defaults (${errors.join(' | ')})`);
  w.close();
}

console.log(`\n${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
