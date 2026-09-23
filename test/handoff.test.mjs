// Real browser handoff tests (Chromium via Playwright), three origins:
//   app       http://127.0.0.1:8801   the deploy folder, served as is
//   receiver  http://localhost:8802   a mock War Room /import/receive
//   impostor  http://localhost:8803   a page on the wrong origin
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { APP_DIR, FIX, ROOT } from './lib/boot.mjs';

const CSV = fs.readFileSync(path.join(FIX, 'games.csv'), 'utf8');
const APP = 'http://127.0.0.1:8801', RECV = 'http://localhost:8802', IMP = 'http://localhost:8803';
const OUT = path.join(ROOT, 'test', 'out');

// Mock receiver: the same protocol as The War Room's receiver.ts. Ready goes
// out with '*' (no data in it); the payload is only accepted from the opener.
const receiverHtml = `<!doctype html><title>mock receiver</title><body>receiver<script>
window.__got=[];
addEventListener('message',ev=>{
  if(ev.source!==window.opener) return;
  if(ev.data&&ev.data.type==='warroom:payload'){
    window.__got.push({origin:ev.origin,payload:ev.data.payload});
    const n=(ev.data.payload.records||[]).length;
    setTimeout(()=>window.opener.postMessage({type:'warroom:received',records:n},ev.origin),300);
  }
});
window.opener&&window.opener.postMessage({type:'warroom:ready'},'*');
</script>`;
const impostorHtml = receiverHtml.replace('mock receiver', 'impostor');
const bounceHtml = `<!doctype html><script>location.replace('${IMP}/impostor')</script>`;
const silentHtml = `<!doctype html><title>silent</title><body>never says ready</body>`;

const types = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.toml': 'text/plain', '.md': 'text/plain' };
function serve(port, handler) {
  return new Promise(r => { const s = http.createServer(handler).listen(port, () => r(s)); });
}
const servers = [
  await serve(8801, (req, res) => {
    const p = decodeURIComponent(new URL(req.url, APP).pathname);
    const f = path.join(APP_DIR, p === '/' ? 'index.html' : p);
    if (!f.startsWith(APP_DIR) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
  }),
  await serve(8802, (req, res) => {
    const p = new URL(req.url, RECV).pathname;
    const body = p === '/import/receive' ? receiverHtml : p === '/bounce' ? bounceHtml : p === '/silent' ? silentHtml : null;
    res.writeHead(body ? 200 : 404, { 'content-type': 'text/html' }); res.end(body || '');
  }),
  await serve(8803, (req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(impostorHtml); }),
];

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ', m); } else { fail++; console.log('  FAIL', m); } };

const browser = await chromium.launch();
async function openApp({ receiver, width = 1280, clock = false, sw = 'block' }) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: sw, acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: APP });
  const requests = [], errors = [];
  ctx.on('request', r => requests.push(r.url()));
  await ctx.route('https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv', r => r.fulfill({ status: 200, body: CSV, contentType: 'text/plain' }));
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  if (clock) await page.clock.install();
  if (receiver) await page.addInitScript(u => localStorage.setItem('gridiron.warroom.url', u), receiver);
  await page.goto(APP + '/index.html');
  await page.waitForSelector('#slate article.game', { timeout: 30000 });
  await page.waitForFunction(() => !document.getElementById('wrSend').disabled);
  return { ctx, page, requests, errors };
}
const status = page => page.textContent('#wrStatus');

// 1. Right origin: the payload arrives, the app confirms the count.
console.log('\n[1] handoff to the right origin');
{
  const { ctx, page, requests, errors } = await openApp({ receiver: RECV + '/import/receive' });
  const [popup] = await Promise.all([ctx.waitForEvent('page'), page.click('#wrSend')]);
  await page.waitForFunction(() => /^Sent \d+ records\./.test(document.getElementById('wrStatus').textContent), null, { timeout: 15000 });
  const got = await popup.evaluate(() => window.__got);
  const built = await page.evaluate(() => window.wrBuild().json);
  ok(got.length === 1, `receiver got exactly one payload (${got.length})`);
  ok(got[0].origin === APP, `payload came from the app origin ${got[0].origin}`);
  ok(JSON.stringify(got[0].payload, null, 2) === built, 'handoff payload is byte for byte the built JSON');
  const st = await status(page);
  ok(st === `Sent ${got[0].payload.records.length} records. Finish the import in The War Room.`, `status: "${st}"`);
  fs.writeFileSync(path.join(OUT, 'handoff-received.json'), JSON.stringify(got[0].payload, null, 2));

  // Copy and Download match the handoff.
  await page.click('#wrCopy');
  await page.waitForFunction(() => /^Copied/.test(document.getElementById('wrStatus').textContent));
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  // The Windows clipboard turns LF into CRLF on the way back out. The bytes the
  // app writes are checked exactly in payload.test.mjs; here the round trip.
  ok(clip.replace(/\r\n/g, '\n') === built && JSON.stringify(JSON.parse(clip)) === JSON.stringify(got[0].payload),
    'Copy JSON equals the handoff payload (same JSON; the OS clipboard adds CRLF)');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#wrDownload')]);
  const dlText = fs.readFileSync(await dl.path(), 'utf8');
  ok(dlText === built, `Download JSON equals the handoff payload (${dl.suggestedFilename()})`);

  const hosts = [...new Set(requests.map(u => new URL(u).origin))];
  ok(hosts.every(h => [APP, RECV, 'https://raw.githubusercontent.com'].includes(h)), 'requests only to: ' + hosts.join(', '));
  ok(errors.length === 0, 'zero JS errors ' + errors.join(' | '));
  await ctx.close();
}

// 2. Wrong origin: the tab lands on another origin that says ready. It gets
//    nothing, and after 60 seconds the fallbacks are shown.
console.log('\n[2] tab ends up on the wrong origin');
{
  const { ctx, page, errors } = await openApp({ receiver: RECV + '/bounce', clock: true });
  const [popup] = await Promise.all([ctx.waitForEvent('page'), page.click('#wrSend')]);
  await popup.waitForURL(IMP + '/impostor');
  await popup.waitForFunction(() => Array.isArray(window.__got));
  await new Promise(r => setTimeout(r, 1500));      // impostor has said ready by now
  ok((await popup.evaluate(() => window.__got.length)) === 0, 'impostor on the wrong origin received nothing');
  ok(/^Opening The War Room/.test(await status(page)), 'app still waiting, nothing sent');
  await page.clock.fastForward(61000);
  await page.waitForFunction(() => /within 60 seconds/.test(document.getElementById('wrStatus').textContent));
  ok(await page.$eval('#wrCopy', e => e.classList.contains('hint') && !e.disabled), 'timeout highlights Copy JSON and Download JSON');
  ok((await popup.evaluate(() => window.__got.length)) === 0, 'still nothing delivered after the timeout');
  ok(errors.length === 0, 'zero JS errors');
  await ctx.close();
}

// 3. Right origin but the page never says ready: timeout shows the fallbacks.
console.log('\n[3] receiver never answers');
{
  const { ctx, page } = await openApp({ receiver: RECV + '/silent', clock: true });
  await Promise.all([ctx.waitForEvent('page'), page.click('#wrSend')]);
  await page.clock.fastForward(59000);
  ok(/^Opening The War Room/.test(await status(page)), 'no fallback message before 60 seconds');
  await page.clock.fastForward(2000);
  await page.waitForFunction(() => /within 60 seconds/.test(document.getElementById('wrStatus').textContent));
  ok(true, 'fallback message after 60 seconds: ' + await status(page));
  await ctx.close();
}

// 4. Layout: desktop and 390px, zero JS errors, no sideways scroll.
console.log('\n[4] layout');
for (const width of [1280, 390]) {
  const { ctx, page, errors } = await openApp({ width });
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(sw <= width, `${width}px: page width ${sw}, no horizontal scroll`);
  for (const t of ['#tabRatings', '#tabLog', '#tabBets', '#tabSlate']) await page.click(t);
  ok(errors.length === 0, `${width}px: zero JS errors across all tabs`);
  await page.locator('#wrPanel').screenshot({ path: path.join(OUT, `panel-${width}.png`) });
  if (width === 390) await page.screenshot({ path: path.join(OUT, 'app-390.png') });
  await ctx.close();
}

// 5. Service worker installs with the bumped cache name.
console.log('\n[5] service worker');
{
  const { ctx, page } = await openApp({ sw: 'allow' });
  const keys = await page.evaluate(async () => { await navigator.serviceWorker.ready; for (let i = 0; i < 40; i++) {
    const k = await caches.keys(); if (k.length) return k; await new Promise(r => setTimeout(r, 100)); } return []; });
  ok(keys.includes('gridiron-2.2.0'), 'cache ' + keys.join(','));
  await ctx.close();
}

await browser.close();
for (const s of servers) s.close();
console.log(`\n${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
