// The /deploy/* rewrite in deploy/_redirects, checked in real Chromium with the
// service worker on. A small server applies the rules in the file (200 rewrites
// with :splat, same as Netlify) so the page is loaded both at the root and under
// /deploy/, the way an icon installed from either address would load it.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { APP_DIR, FIX } from './lib/boot.mjs';

const CSV = fs.readFileSync(path.join(FIX, 'games.csv'), 'utf8');
const PORT = 8805, ORIGIN = `http://127.0.0.1:${PORT}`;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

const rules = fs.readFileSync(path.join(APP_DIR, '_redirects'), 'utf8').split(/\r?\n/)
  .map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => { const [from, to, status] = l.split(/\s+/); return { from, to, status: Number(status) }; });

function resolve(p) {
  const file = x => { const f = path.join(APP_DIR, x === '/' ? 'index.html' : x); return f.startsWith(APP_DIR) && fs.existsSync(f) && fs.statSync(f).isFile() ? f : null; };
  const direct = file(p);
  if (direct && p !== '/deploy') return direct;
  for (const r of rules) {          // 200 rewrites only apply when no real file is there
    if (r.status !== 200) continue;
    if (r.from.endsWith('/*')) { const base = r.from.slice(0, -2); if (p === base + '/' || p.startsWith(base + '/')) { const t = r.to.replace(':splat', p.slice(base.length + 1)); return file(t.startsWith('/') ? t : '/' + t); } }
    else if (p === r.from) return file(r.to);
  }
  return null;
}
const server = await new Promise(r => { const s = http.createServer((req, res) => {
  const f = resolve(decodeURIComponent(new URL(req.url, ORIGIN).pathname));
  if (!f) { res.writeHead(404); return res.end('Page not found'); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
}).listen(PORT, () => r(s)); });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ', m); } else { fail++; console.log('  FAIL', m); } };
const get = async u => { const r = await fetch(ORIGIN + u); return { status: r.status, body: Buffer.from(await r.arrayBuffer()) }; };

console.log('\n[1] the rules');
ok(rules.some(r => r.from === '/deploy/*' && r.to === '/:splat' && r.status === 200), '/deploy/* is a 200 rewrite to /:splat');
for (const f of ['index.html', 'sw.js', 'manifest.webmanifest', 'icon.png']) {
  const a = await get('/' + f), b = await get('/deploy/' + f);
  ok(a.status === 200 && b.status === 200 && a.body.equals(b.body), `/deploy/${f} serves exactly the root's ${f}`);
}
ok((await get('/deploy/')).status === 200 && (await get('/deploy')).status === 200, '/deploy/ and /deploy both load the app');
ok((await get('/deploy/nope.js')).status === 404, 'a path that does not exist under /deploy/ is still a 404');
ok((await get('/README.md')).status === 404 && (await get('/deploy/README.md')).status === 404, 'nothing outside the deploy folder is reachable');

console.log('\n[2] the app in a browser, at both addresses');
const browser = await chromium.launch();
for (const base of ['/', '/deploy/index.html']) {
  const label = base === '/' ? 'root' : '/deploy/';
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
  await ctx.route('https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv', r => r.fulfill({ status: 200, body: CSV, contentType: 'text/plain' }));
  const errors = [];
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(ORIGIN + base);
  await page.waitForSelector('#slate article.game', { timeout: 30000 });
  const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return { scope: r.scope, script: r.active.scriptURL }; });
  const dir = base === '/' ? '/' : '/deploy/';
  ok(sw.scope === ORIGIN + dir && sw.script === ORIGIN + dir + 'sw.js', `${label}: service worker ${sw.script} has scope ${sw.scope}`);
  const man = await page.evaluate(async () => { const l = document.querySelector('link[rel=manifest]'); const j = await (await fetch(l.href)).json(); return { href: l.href, start: new URL(j.start_url, l.href).href, scope: new URL(j.scope, l.href).href, icon: new URL(j.icons[0].src, l.href).href }; });
  ok(man.href === ORIGIN + dir + 'manifest.webmanifest' && man.start === ORIGIN + dir + 'index.html' && man.scope === ORIGIN + dir, `${label}: manifest start_url ${man.start}, scope ${man.scope}`);
  ok((await get(new URL(man.icon).pathname)).status === 200, `${label}: icon loads (${man.icon})`);
  const cached = await page.evaluate(async () => { const c = await caches.open(await (await caches.keys())[0]); return (await c.keys()).map(r => new URL(r.url).pathname); });
  ok(cached.length > 0 && cached.every(p => p.startsWith(dir)), `${label}: shell cached under ${dir} (${cached.join(', ')})`);
  ok(await page.evaluate(() => document.getElementById('foot3').textContent.includes('Model 2.4.0')), `${label}: footer shows Model 2.4.0`);
  ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), `${label}: no horizontal scroll at 390`);
  // Offline: the cached shell still opens.
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  ok(await page.locator('h1').first().textContent().then(t => /Gridiron/.test(t)).catch(() => false), `${label}: opens offline from the cached shell`);
  await ctx.setOffline(false);
  ok(errors.length === 0, `${label}: zero JS errors ${errors.slice(0, 2).join(' | ')}`);
  await ctx.close();
}
await browser.close(); server.close();
console.log(`\n${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
