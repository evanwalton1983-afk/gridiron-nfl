// Key number engine tests. Part 1 checks the embedded table against the file the
// Python builder wrote. Part 2 runs the keyNum module exactly as shipped in
// deploy/index.html, pulled out of the page. Part 3 boots the app in jsdom and
// checks the per-game block, the week summary and the teaser prices setting.
import fs from 'node:fs';
import path from 'node:path';
import { bootApp, APP_DIR, ROOT } from './lib/boot.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const close = (a, b, tol) => Math.abs(a - b) <= tol;

const html = fs.readFileSync(path.join(APP_DIR, 'index.html'), 'utf8');

console.log('\n[1] embedded table');
const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'key_numbers.json'), 'utf8'));
const emb = html.match(/\/\*KEYNUM-BEGIN\*\/\r?\nconst KEYNUM=(\{.*\});\r?\n\/\*KEYNUM-END\*\//);
ok(!!emb, 'KEYNUM constant sits between its markers in index.html');
const KEYNUM = emb ? JSON.parse(emb[1]) : null;
ok(JSON.stringify(KEYNUM) === JSON.stringify(json), 'embedded KEYNUM is identical to scripts/key_numbers.json');
ok(json.seasons[1] - json.seasons[0] + 1 >= 15, `at least 15 seasons (${json.seasons[0]} to ${json.seasons[1]})`);
ok(json.lines.length === 30 && json.lines[0] === 0 && json.lines[29] === 14.5, 'lines run from pick\'em to 14.5 in half points');
ok(json.pmf.every(r => r.length === json.margin_max - json.margin_min + 1 && r.reduce((a, b) => a + b, 0) === json.scale), 'every row has one entry per margin and sums to exactly 1');
const P = (line, m) => json.pmf[line * 2][m - json.margin_min] / json.scale;
ok(P(3, 3) > 0.08 && P(3, 3) < 0.10, `push at 3 on a 3 point line is about 9% (${(100 * P(3, 3)).toFixed(1)}%)`);
ok(P(7, 7) > 0.055 && P(7, 7) < 0.075, `push at 7 on a 7 point line is about 6.5% (${(100 * P(7, 7)).toFixed(1)}%)`);
ok(P(3, 3) > P(3, 2) * 1.8 && P(3, 3) > P(3, 4) * 1.8, 'on a 3 point line, a margin of 3 is far likelier than 2 or 4');
ok(P(7, 7) > P(7, 5) * 1.3 && P(7, 7) > P(7, 8) * 1.3, 'on a 7 point line, a margin of 7 is likelier than 5 or 8');
{
  const mean = json.pmf[0].reduce((a, v, i) => a + v * (json.margin_min + i), 0) / json.scale;
  ok(Math.abs(mean) < 0.05, `pick'em row has a mean margin near 0 (${mean.toFixed(3)})`);
}
{
  let worst = 0;
  json.lines.forEach((s, li) => {
    const mean = json.pmf[li].reduce((a, v, i) => a + v * (json.margin_min + i), 0) / json.scale;
    worst = Math.max(worst, Math.abs(mean - (json.mean_fit[0] + json.mean_fit[1] * s)));
  });
  ok(worst < 0.05, `every row's mean margin sits on the fitted line (worst gap ${worst.toFixed(3)})`);
}

console.log('\n[2] keyNum module');
const mod = html.match(/const keyNum=\(\(\)=>\{[\s\S]*?\n\}\)\(\);/);
if (!mod) { console.log('  FAIL keyNum module not found in index.html'); process.exit(1); }
const amToProb = a => a > 0 ? 100 / (a + 100) : -a / (-a + 100);
const keyNum = new Function('KEYNUM', 'amToProb', mod[0] + '\nreturn keyNum;')(KEYNUM, amToProb);

ok(keyNum.row(14.5) && !keyNum.row(15) && !keyNum.row(null) && !keyNum.row(-1), 'row exists up to 14.5 and not past it');
ok(keyNum.fairAm(0.5) === -100 && close(keyNum.fairAm(0.6), -150, 1e-9) && close(keyNum.fairAm(0.4), 150, 1e-9), 'fair price: 50% is -100, 60% is -150, 40% is +150');
ok(keyNum.cents(-110) === 10 && keyNum.cents(110) === -10 && keyNum.cents(-100) === 0 && keyNum.cents(100) === 0, 'cents scale: -110 is 10, +110 is -10, either even money is 0');
ok(keyNum.amTxt(-120.4) === '-120' && keyNum.amTxt(160) === '+160', 'price text keeps its sign');

// Anchoring: the main line's cover price must come out at the price asked for.
{
  let worst = 0, n = 0;
  for (const S of [0, 0.5, 1, 2.5, 3, 3.5, 6.5, 7, 7.5, 10, 14.5]) {
    for (const q of [0.3, 0.45, 0.5, 0.52, 0.55, 0.7]) {
      const a = keyNum.anchor(keyNum.row(S), S, q);
      worst = Math.max(worst, Math.abs(keyNum.cover(a.p, S).q - q)); n++;
      if (Math.abs(a.p.reduce((x, y) => x + y, 0) - 1) > 1e-12) worst = 1;
    }
  }
  ok(worst < 1e-9, `anchored row reproduces the main line price (${n} cases, worst error ${worst.toExponential(1)})`);
  const a = keyNum.anchor(keyNum.row(3), 3, null);
  ok(!a.anchored && a.p === keyNum.row(3), 'no price means the table row comes back untouched and says so');
}

// The ladder: prices rise as the favorite gets more points, and the anchor holds.
{
  const S = 3.5, a = keyNum.anchor(keyNum.row(S), S, 0.512).p, lad = keyNum.ladder(a);
  ok(lad.length === 59 && lad[0].line === -14.5 && lad[58].line === 14.5, 'ladder runs from -14.5 to +14.5 in half points (59 rows)');
  ok(lad.every((r, i) => i === 0 || r.w >= lad[i - 1].w), 'favorite cover probability never falls toward +14.5 (a half point to a whole number only adds a push)');
  ok(lad.every((r, i) => i === 0 || r.q > lad[i - 1].q), 'fair price probability rises at every step');
  const main = lad.find(r => r.line === -S);
  ok(close(main.q, 0.512, 1e-9), `main line row equals the price asked for (${main.q.toFixed(6)})`);
  ok(lad.filter(r => r.push > 0).every(r => Number.isInteger(r.line)), 'only whole number lines can push');
  ok(lad.find(r => r.line === -3).push > 0.07 && lad.find(r => r.line === -7).push > 0.05, 'pushes at -3 and -7 are the big ones');
  const step = (r1, r2) => lad.find(r => r.line === r2).q - lad.find(r => r.line === r1).q;
  ok(step(-3.5, -2.5) > 2 * step(-5.5, -4.5), 'moving across the 3 is worth more than twice moving 5.5 to 4.5');
  // With a push the fair price is on win share, so the bet breaks even exactly.
  const l3 = lad.find(r => r.line === -3), dec = 1 + 100 / -keyNum.fairAm(l3.q);
  ok(close(l3.w * (dec - 1) - (1 - l3.w - l3.push), 0, 1e-9), 'fair price at -3 has zero expected value with the push returned');
}

// Half point value.
{
  const at = (S, q) => { const p = keyNum.anchor(keyNum.row(S), S, q).p; return keyNum.halfPoint(p, S); };
  const h3 = at(3, 0.5), h55 = at(5.5, 0.5), h7 = at(7, 0.5);
  ok(h3.fav.buy > 0 && h3.fav.sell > 0 && h3.dog.buy > 0 && h3.dog.sell > 0, 'every half point value is positive');
  ok(h3.fav.buy > 2 * h55.fav.buy, `a half point at 3 (${h3.fav.buy.toFixed(1)}) is worth over twice one at 5.5 (${h55.fav.buy.toFixed(1)})`);
  ok(h7.fav.buy > h55.fav.buy, `a half point at 7 (${h7.fav.buy.toFixed(1)}) is worth more than at 5.5`);
  ok(h3.fav.buy > 15 && h3.fav.buy < 60, `3 is worth a believable ${h3.fav.buy.toFixed(1)} cents`);
  ok(Math.abs(h3.fav.buy - h3.fav.sell) < 0.35 * h3.fav.buy, `at 3, buying (${h3.fav.buy.toFixed(1)}) and selling (${h3.fav.sell.toFixed(1)}) are worth about the same`);
}

// Teaser flags, checked against the rule by hand over every spread.
{
  const flagged = { fav: [], dog: [] };
  for (let S = 0; S <= 14.5; S += 0.5) {
    const t = keyNum.teaser(keyNum.row(S), S);
    if (t.fav.flag) flagged.fav.push(S);
    if (t.dog.flag) flagged.dog.push(S);
  }
  ok(JSON.stringify(flagged.fav) === JSON.stringify([7, 7.5, 8, 8.5]), `favorite legs flagged: ${flagged.fav.join(', ')} (want 7, 7.5, 8, 8.5)`);
  ok(JSON.stringify(flagged.dog) === JSON.stringify([1.5, 2, 2.5, 3]), `underdog legs flagged: ${flagged.dog.join(', ')} (want 1.5, 2, 2.5, 3)`);
  const t = keyNum.teaser(keyNum.row(7.5), 7.5), r = keyNum.row(7.5), M = KEYNUM.margin_min;
  ok(t.fav.from === -7.5 && t.fav.to === -1.5, 'the favorite at -7.5 is teased to -1.5');
  const want = r.reduce((a, v, i) => a + (M + i > 1.5 ? v : 0), 0);
  ok(close(t.fav.w, want, 1e-12), `-1.5 leg wins ${(100 * t.fav.w).toFixed(1)}%, the table's share of margins past 1.5`);
  ok(t.fav.push === 0 && t.dog.push === 0, 'half point legs cannot push');
  const d = keyNum.teaser(keyNum.row(1.5), 1.5);
  ok(d.dog.from === 1.5 && d.dog.to === 7.5, 'the underdog at +1.5 is teased to +7.5');
  ok(close(d.dog.w, keyNum.row(1.5).reduce((a, v, i) => a + (M + i < 7.5 ? v : 0), 0), 1e-12), '+7.5 leg wins the share of margins under 7.5');
  ok(t.fav.w > 0.68 && d.dog.w > 0.68 && t.fav.w < 0.78 && d.dog.w < 0.78, `legs through 3 and 7 are strong (${(100 * t.fav.w).toFixed(1)}% and ${(100 * d.dog.w).toFixed(1)}%)`);
  const w3 = keyNum.teaser(keyNum.row(3), 3);
  ok(w3.dog.push > 0 && w3.dog.push < 0.05 && w3.dog.flag, `the underdog at +3 teased to +9 is flagged and pushes only on a margin of 9 (${(100 * w3.dog.push).toFixed(1)}%)`);
}

// Break-even.
{
  const b2 = keyNum.breakEven(-120, 2), b3 = keyNum.breakEven(160, 3);
  ok(close(b2.team, 120 / 220, 1e-12) && close(b2.leg, Math.sqrt(120 / 220), 1e-12), `2 team at -120: ${(100 * b2.team).toFixed(2)}% teaser, ${(100 * b2.leg).toFixed(2)}% a leg`);
  ok(close(b3.team, 100 / 260, 1e-12) && close(b3.leg, Math.cbrt(100 / 260), 1e-12), `3 team at +160: ${(100 * b3.team).toFixed(2)}% teaser, ${(100 * b3.leg).toFixed(2)}% a leg`);
}

console.log('\n[3] in the app');
for (const live of [false, true]) {
  const mode = live ? 'live' : 'file';
  console.log(`  [${mode} mode]`);
  const { window: w, errors } = await bootApp({ live });
  const d = w.document, $ = id => d.getElementById(id);
  const arts = [...d.querySelectorAll('#slate article.game')];
  ok(arts.length > 0 && arts.every(a => a.querySelector('.detail .kn[data-kn]')), `${mode}: every game has a key number block (${arts.length})`);
  ok(arts.every(a => !/NaN|undefined|Infinity/.test(a.querySelector('.kn').textContent)), `${mode}: no NaN or undefined in any block`);
  ok(arts.every(a => /Half point value/.test(a.textContent) && /6 point teaser legs/.test(a.textContent) && /Alt spread prices/.test(a.textContent)), `${mode}: each block has push, half point, teaser and alt spread parts`);
  ok(arts.every(a => a.querySelectorAll('.knlad tbody tr').length === 59), `${mode}: each alt ladder has 59 rows`);
  ok(arts.every(a => a.querySelectorAll('.knlad tr.knmain').length === 1), `${mode}: each ladder shades exactly one main line row`);
  ok(!!$('slate').querySelector('.knweek'), `${mode}: week summary is on the slate`);

  // The main line read back from the page equals the market's vig free price.
  const check = w.eval(`(()=>{
    const out=[];
    for(const g of GAMES.filter(x=>x.season===SEASON&&x.week===WEEK)){
      const p=predictLive(g), k=knFor(g,p);
      if(!k||k.out)continue;
      const h=p.live?p.mktLine.spread:g.spread_line;
      let pH=p.keyAnchor;
      if(pH==null){const fp=fairPair(g.home_sp_odds,g.away_sp_odds),f=fp&&(fp[FAIR_S.display]||fp.multiplicative);pH=f?f[0]:null;}
      if(pH==null){out.push({S:k.S,anchored:k.anchored,none:true});continue;}
      out.push({S:k.S,anchored:k.anchored,q:k.main.w/(k.main.w+k.main.l),want:h>=0?pH:1-pH,w:k.main.w,l:k.main.l,push:k.main.push});
    }
    return out;})()`);
  ok(check.length > 0, `${mode}: ${check.length} games read back`);
  ok(check.filter(c => !c.none).every(c => c.anchored && close(c.q, c.want, 1e-9)), `${mode}: main line cover price equals the market's vig free price in every game`);
  ok(check.every(c => close(c.w + c.l + c.push, 1, 1e-9)), `${mode}: cover, push and fade add to 1`);
  ok(check.every(c => c.push === 0 || Number.isInteger(c.S)), `${mode}: push only on whole number lines`);

  ok(/classic half point line/.test($('slate').querySelector('.knweek').textContent), `${mode}: week summary labels classic half point legs`);
  // Teaser prices setting.
  ok($('tz2').value === '-120' && $('tz3').value === '+160', `${mode}: teaser prices start at -120 and +160`);
  const before = $('slate').querySelector('.knweek').textContent;
  $('tz2').value = '-130'; $('tz2').dispatchEvent(new w.Event('change'));
  ok($('knStatus').textContent === '2 team -130, 3 team +160', `${mode}: status shows the new price (${$('knStatus').textContent})`);
  ok(/-130/.test($('slate').querySelector('.knweek').textContent) && $('slate').querySelector('.knweek').textContent !== before, `${mode}: week summary follows the price`);
  ok(/breaks even at 56\.5%/.test($('slate').textContent), `${mode}: break-even recomputed for -130 (56.5%)`);
  ok(JSON.parse(w.localStorage.getItem('gridiron.teaser')).two === -130, `${mode}: price saved in this browser`);
  $('tz3').value = 'abc'; $('tz3').dispatchEvent(new w.Event('change'));
  ok(/Enter a price/.test($('knStatus').textContent) && JSON.parse(w.localStorage.getItem('gridiron.teaser')).three === 160, `${mode}: a bad price is refused and the old one kept`);
  $('tz3').value = '+250'; $('tz3').dispatchEvent(new w.Event('change'));
  ok(JSON.parse(w.localStorage.getItem('gridiron.teaser')).three === 250, `${mode}: "+250" is accepted`);

  // Fair price method still drives the anchor.
  $('fairDisp').value = 'multiplicative'; $('fairDisp').dispatchEvent(new w.Event('change'));
  ok(d.querySelectorAll('#slate article.game .kn').length === arts.length, `${mode}: blocks survive a fair price change`);
  // Next week renders too.
  $('next').click(); await new Promise(r => setTimeout(r, 30));
  ok(d.querySelectorAll('#slate article.game .kn').length > 0, `${mode}: next week has blocks`);
  ok(errors.length === 0, `${mode}: zero JS errors ${errors.slice(0, 2).join(' | ')}`);
  w.close();
}

console.log(`\n${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
