// Phone width check for the key number engine, in real Chromium: 390 by 844,
// the Slate tab with a game open, the alt spread ladder open, the Teasers
// setting changed. No horizontal scroll, no JS errors, screenshots saved.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { APP_DIR, FIX, ROOT } from './lib/boot.mjs';

const CSV = fs.readFileSync(path.join(FIX, 'games.csv'), 'utf8');
const APP = 'http://127.0.0.1:8804', OUT = path.join(ROOT, 'test', 'out');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const server = await new Promise(r => { const s = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, APP).pathname), f = path.join(APP_DIR, p === '/' ? 'index.html' : p);
  if (!f.startsWith(APP_DIR) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
}).listen(8804, () => r(s)); });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ', m); } else { fail++; console.log('  FAIL', m); } };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
const errors = [];
await ctx.route('https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv', r => r.fulfill({ status: 200, body: CSV, contentType: 'text/plain' }));
const page = await ctx.newPage();
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(APP + '/index.html');
await page.waitForSelector('#slate article.game', { timeout: 30000 });
const wide = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

console.log('\n[phone 390 by 844]');
ok(!(await wide()), 'Slate: no horizontal scroll');
await page.click('#knPanel summary');
ok(!(await wide()), 'Teasers panel open: no horizontal scroll');
await page.fill('#tz2', '-125'); await page.press('#tz2', 'Tab');
ok((await page.textContent('#knStatus')).includes('-125'), 'typing -125 and leaving the box saves it');
await page.screenshot({ path: path.join(OUT, 'kn-settings-390.png') });
await page.click('#knPanel summary');

await page.click('.knweek summary');
ok(!(await wide()), 'Week summary open: no horizontal scroll');
await page.screenshot({ path: path.join(OUT, 'kn-week-390.png') });
await page.click('.knweek summary');

// A game with a whole number spread so the push shows, and one flagged leg if any.
const idx = await page.evaluate(() => {
  const arts = [...document.querySelectorAll('#slate article.game')];
  const i = arts.findIndex(a => /push at/.test(a.querySelector('.kn').textContent));
  return i < 0 ? 0 : i;
});
await page.click(`#slate article.game:nth-of-type(${idx + 1}) .head`).catch(async () => { await page.locator('#slate article.game .head').nth(idx).click(); });
const art = page.locator('#slate article.game').nth(idx);
await art.locator('.kn').scrollIntoViewIfNeeded();
ok(await art.locator('.kn').isVisible(), 'Key numbers block shows when a game is opened');
ok(!(await wide()), 'Game open: no horizontal scroll');
await page.screenshot({ path: path.join(OUT, 'kn-game-390.png') });
await art.locator('.knlad summary').click();
ok(await art.locator('.knlad tr.knmain').isVisible(), 'Alt spread ladder opens and shows the shaded main line');
ok(!(await wide()), 'Ladder open: no horizontal scroll');
await art.locator('.knlad .scroll').scrollIntoViewIfNeeded();
await page.screenshot({ path: path.join(OUT, 'kn-ladder-390.png') });
const over = await page.evaluate(() => [...document.querySelectorAll('.kn, .kn table, .knweek')].filter(e => e.scrollWidth > e.clientWidth + 1).length);
ok(over === 0, 'No key number table is wider than its box');

for (const tab of ['tabRatings', 'tabLog', 'tabBets', 'tabSlate']) { await page.click('#' + tab); ok(!(await wide()), `${tab}: no horizontal scroll`); }
ok(errors.length === 0, 'zero JS errors ' + errors.slice(0, 2).join(' | '));

await browser.close(); server.close();
console.log(`\n${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
