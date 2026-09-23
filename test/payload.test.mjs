// Payload acceptance tests in jsdom, file mode and live mode.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { bootApp, ROOT, NOW, APP_DIR } from './lib/boot.mjs';

const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'warroom-import-1.0.schema.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false }); addFormats(ajv);
const validate = ajv.compile(schema);
const OUT = path.join(ROOT, 'test', 'out'); fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('  FAIL', msg); } };
const pct1 = n => (100 * n).toFixed(1) + '%';
const isWhole = x => Math.abs(x - Math.round(x)) < 1e-9;

for (const live of [false, true]) {
  const mode = live ? 'live' : 'file';
  let clip = null, blobText = null, dlName = null;
  const { window: w, requests, errors, opened } = await bootApp({ live, setup(win) {
    Object.defineProperty(win.navigator, 'clipboard', { value: { writeText: async t => { clip = t; } }, configurable: true });
    win.URL.createObjectURL = b => { b.text().then(t => { blobText = t; }); return 'blob:x'; };
    win.URL.revokeObjectURL = () => {};
    win.HTMLAnchorElement.prototype.click = function () { dlName = this.download; };
  } });
  const d = w.document;
  console.log(`\n[${mode} mode]`);
  const reqBefore = [...new Set(requests)];

  const B = w.wrBuild();
  const P = B.payload;
  fs.writeFileSync(path.join(OUT, `sample-${mode}.json`), B.json);
  ok(B.errors.length === 0, 'in-app validator errors: ' + B.errors.join('; '));
  const valid = validate(P);
  ok(valid, 'ajv schema errors: ' + JSON.stringify(validate.errors?.slice(0, 5)));
  console.log(`  schema (ajv, draft 2020-12): ${valid ? 'valid' : 'INVALID'}; in-app validator: ${B.errors.length} errors`);

  // Records: 6 per unplayed game, both sides of every market.
  const games = [...new Set(P.records.map(r => r.event.source_event_id))];
  const slateUp = [...d.querySelectorAll('#slate article.game')].length;
  ok(games.length === 16 && slateUp === 16, `games: payload ${games.length}, slate ${slateUp}`);
  ok(P.records.length === 6 * games.length, `records ${P.records.length} != 6 x ${games.length}`);
  for (const gid of games) {
    const rs = P.records.filter(r => r.event.source_event_id === gid);
    const keys = rs.map(r => r.market.type + ':' + r.selection.side).sort().join(',');
    ok(keys === 'moneyline:away,moneyline:home,spread:away,spread:home,total:over,total:under', gid + ' sides ' + keys);
  }
  console.log(`  records: ${P.records.length} for ${games.length} games (6 each, both sides of spread, total, moneyline)`);

  // Probabilities, ladder, flags, prices.
  let halfPush = 0, ladders = 0, priced = 0, linesOnly = 0, mlNoPrice = 0;
  for (const r of P.records) {
    const m = r.model, s = m.prob_win + m.prob_push + m.prob_loss;
    ok(Math.abs(s - 1) <= 0.001, r.record_id + ' sum ' + s);
    ok(!('pNoPush' in m), 'no push-excluded column');
    const line = r.price && r.price.line;
    if (r.market.type === 'moneyline') {
      ok(m.prob_push > 0 && m.prob_push < 0.01, r.record_id + ' ML tie push ' + m.prob_push);
      ok(!m.ladder, 'no ML ladder');
    } else {
      ladders++;
      ok(m.ladder && m.ladder.length === 9, r.record_id + ' ladder length');
      const at = m.ladder.find(x => Math.abs(x.line - line) < 1e-9);
      ok(at && Math.abs(at.prob_win - m.prob_win) <= 1e-6 && Math.abs(at.prob_push - m.prob_push) <= 1e-6,
        `${r.record_id} ladder at market line ${JSON.stringify(at)} vs ${m.prob_win}/${m.prob_push}`);
      ok(Math.abs(m.ladder[0].line - (line - 2)) < 1e-9 && Math.abs(m.ladder[8].line - (line + 2)) < 1e-9, r.record_id + ' ladder span');
      const shouldFlag = !isWhole(line) && m.prob_push > 0;
      ok(r.flags.includes('push_on_half_line') === shouldFlag, r.record_id + ' push_on_half_line flag');
      if (shouldFlag) halfPush++;
    }
    ok(r.flags.includes('early_season'), r.record_id + ' early_season (week 3)');
    const hasOdds = r.price && r.price.american_odds != null;
    ok(r.flags.includes('no_price_in_app') === !hasOdds, r.record_id + ' no_price_in_app iff no odds');
    if (hasOdds) {
      priced++;
      ok(r.price.captured_at === new Date(NOW).toISOString().replace('.000Z', 'Z'), r.record_id + ' captured_at is the pull time');
      ok(['DK', 'FD', 'MGM', 'CZR', 'FAN'].includes(r.price.sportsbook), r.record_id + ' book ' + r.price.sportsbook);
    } else if (r.market.type === 'moneyline') { mlNoPrice++; ok(!('price' in r), r.record_id + ' ML without price has no price block'); }
    else { linesOnly++; ok(Object.keys(r.price).join() === 'line', r.record_id + ' line only price block'); }
    if (!live) ok(!hasOdds, 'file mode never sends the nflverse closing odds as a price');
  }
  console.log(`  probabilities sum to 1 on all records; ${ladders} ladders, rung at the market line equals the record`);
  console.log(`  prices: ${priced} with odds, ${linesOnly} line only, ${mlNoPrice} moneylines with no price block`);
  console.log(`  push_on_half_line on ${halfPush} records`);

  // Cross-check against what the board shows: Model column = win / (win + loss).
  let checked = 0;
  for (const a of d.querySelectorAll('#slate article.game')) {
    const [away, home] = a.querySelector('.match').textContent.split(' at ');
    const gid = P.records.find(r => r.event.participants[0].name === away && r.event.participants[1].name === home).event.source_event_id;
    for (const tr of a.querySelectorAll('.board tbody tr')) {
      const side = tr.querySelector('td').firstChild.textContent.trim(), shown = tr.querySelector('td.mv').textContent.trim();
      const r = P.records.find(x => x.event.source_event_id === gid && (x.selection.label === side || x.selection.label === side + ' ML'));
      ok(r, `${gid} board row ${side} has a record`);
      if (!r) continue;
      ok(pct1(r.model.prob_win / (r.model.prob_win + r.model.prob_loss)) === shown, `${gid} ${side}: board ${shown}`);
      const priceTd = tr.querySelectorAll('td')[1].textContent.trim();
      // A board with a Book column shows a live price at your books: that is sent.
      // Without one it shows the nflverse closing number, which is never sent as a price.
      const hasBook = [...a.querySelectorAll('.board th')].some(th => th.textContent === 'Book');
      if (hasBook) ok(String(r.price?.american_odds > 0 ? '+' + r.price.american_odds : r.price?.american_odds) === priceTd
        && r.price.sportsbook === tr.querySelectorAll('td')[2].textContent.trim(), `${gid} ${side} price ${priceTd}`);
      else ok(r.price?.american_odds == null && r.flags.includes('no_price_in_app'), `${gid} ${side} closing number not sent as a price`);
      checked++;
    }
  }
  console.log(`  ${checked} board rows cross-checked: exported probabilities reproduce the on-screen Model column and price`);

  // Batch.
  ok(P.batch.model_version === '2.2.0' && P.batch.source_app === 'gridiron_nfl', 'batch identity');
  ok(/^gridiron_nfl-2026-Week 3-\d{8}T\d{6}Z$/.test(P.batch.source_batch_id), 'batch id ' + P.batch.source_batch_id);
  ok(!B.json.includes('TESTKEY'), 'the Odds API key never appears in the payload');
  ok(P.batch.model_config.gain === 0.0624 && P.batch.model_config.NOVIG_BAR === 0.04, 'model_config carries BEST and gates');
  const first = P.records.find(r => r.record_id.startsWith('2026_03_ATL_GB-'));
  ok(first.event.start_time === '2026-09-25T00:15:00Z', 'ATL at GB 8:15pm EDT -> ' + first.event.start_time);

  // Fallbacks: Copy and Download carry the same JSON as the handoff payload.
  d.getElementById('wrCopy').click(); await new Promise(r => setTimeout(r, 30));
  d.getElementById('wrDownload').click(); await new Promise(r => setTimeout(r, 30));
  ok(clip === B.json, 'Copy JSON equals built payload');
  ok(blobText === B.json, 'Download JSON equals built payload');
  ok(/^warroom-gridiron_nfl-week-3-\d{8}T\d{6}Z\.json$/.test(dlName || ''), 'download name ' + dlName);
  console.log(`  Copy and Download identical to the payload; file name ${dlName}`);

  // Send with a blocked popup shows the fallbacks.
  d.getElementById('wrSend').click();
  ok(opened.length === 1 && opened[0].url === 'https://lighthearted-kringle-dafe7e.netlify.app/import/receive' && opened[0].target === '_blank'
    && !opened[0].feat, 'opens the default receiver in a new tab, without noopener');
  ok(/blocked/.test(d.getElementById('wrStatus').textContent) && d.getElementById('wrCopy').classList.contains('hint'), 'blocked popup shows fallbacks');

  // No new network requests.
  const reqAfter = [...new Set(requests)];
  const allowed = u => u === 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv' || u.startsWith('https://api.the-odds-api.com/v4/');
  ok(reqAfter.every(allowed) && reqAfter.length === reqBefore.length, 'network: ' + reqAfter.join(', '));
  console.log(`  network: ${reqAfter.map(u => new URL(u).host).join(', ')} only (same as before the change); window.open to the War Room`);
  ok(errors.length === 0, 'JS errors: ' + errors.join('\n'));
  console.log(`  JS errors: ${errors.length}`);

  // The War Room's own pipeline.
  const nowIso = new Date(NOW).toISOString();
  let wr;
  try { wr = execFileSync(process.execPath, [path.join('C:/Projects/war-room/node_modules/tsx/dist/cli.mjs'), path.join(ROOT, 'test', 'warroom-preview.mts'), path.join(OUT, `sample-${mode}.json`), nowIso],
    { cwd: 'C:/Projects/war-room', encoding: 'utf8' }); }
  catch (e) { wr = e.stdout || String(e); }
  const res = JSON.parse(wr.trim().split('\n').pop());
  ok(res.errors && res.errors.length === 0, 'War Room pipeline errors: ' + JSON.stringify(res.errors || res).slice(0, 800));
  console.log(`  War Room import pipeline: ${res.errors?.length ?? '?'} errors, counts ${JSON.stringify(res.counts)}, warnings ${JSON.stringify(res.warnings)}`);
  w.close();
}

// Past week: nothing to send, buttons disabled.
{
  const { window: w } = await bootApp({});
  const d = w.document;
  d.getElementById('prev').click(); await new Promise(r => setTimeout(r, 30));
  ok(d.getElementById('wrSend').disabled && /every game is final/.test(d.getElementById('wrStatus').textContent), 'past week disables Send');
  d.getElementById('next').click(); await new Promise(r => setTimeout(r, 30));
  ok(!d.getElementById('wrSend').disabled && d.getElementById('wrStatus').textContent === '', 'current week re-enables Send');
  console.log('\n[past week] Send disabled with "every game is final"; re-enabled on the current week');
  w.close();
}

// No em or en dashes in the changed files.
for (const f of ['index.html', 'sw.js']) {
  const t = fs.readFileSync(path.join(APP_DIR, f), 'utf8');
  ok(!/[\u2013\u2014]/.test(t), 'dash in ' + f);
}
console.log('[dashes] no em or en dashes in index.html or sw.js');

console.log(`\n${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
