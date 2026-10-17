// Boots the Gridiron app headless in jsdom with a frozen clock, a frozen
// nflverse file, and (optionally) a frozen Odds API response. Every network
// request and every JS error is recorded.
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..');
export const APP_DIR = path.join(ROOT, 'deploy');
export const FIX = path.join(ROOT, 'test', 'fixtures');
export const NOW = Date.parse('2026-09-23T19:00:00Z');
export const APP_ORIGIN = 'https://gridiron.test';

// The version as the app declares it, so tests follow every bump. Throws if
// index.html and sw.js disagree, because a missed sw.js bump strands phones
// on the old cached shell.
export function appVersion() {
  const m = fs.readFileSync(path.join(APP_DIR, 'index.html'), 'utf8').match(/const MODEL_VERSION='([^']+)'/);
  const s = fs.readFileSync(path.join(APP_DIR, 'sw.js'), 'utf8').match(/const APP_VERSION='([^']+)'/);
  if (!m || !s || m[1] !== s[1]) throw new Error(`MODEL_VERSION ${m && m[1]} and APP_VERSION ${s && s[1]} must match`);
  return m[1];
}

const CSV = fs.readFileSync(path.join(FIX, 'games.csv'), 'utf8');
const oddsText = () => fs.readFileSync(path.join(FIX, 'odds-api.json'), 'utf8');

export async function bootApp({ live = false, htmlFile = path.join(APP_DIR, 'index.html'), width = 1024, setup } = {}) {
  const html = fs.readFileSync(htmlFile, 'utf8');
  const requests = [], errors = [], opened = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String(e && (e.stack || e.message) || e)));
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

  const dom = new JSDOM(html, {
    url: APP_ORIGIN + '/index.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      const RealDate = w.Date;
      class FakeDate extends RealDate {
        constructor(...a) { if (a.length === 0) super(NOW); else super(...a); }
        static now() { return NOW; }
      }
      w.Date = FakeDate;
      w.performance.now = () => 0;
      Object.defineProperty(w, 'innerWidth', { value: width, configurable: true });
      w.addEventListener('error', ev => errors.push('window.error: ' + (ev.error && ev.error.stack || ev.message)));
      w.addEventListener('unhandledrejection', ev => errors.push('unhandledrejection: ' + (ev.reason && ev.reason.stack || ev.reason)));
      w.fetch = async (url) => {
        url = String(url);
        requests.push(url);
        const mk = (body, headers = {}) => ({
          ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body),
          headers: { get: k => headers[k.toLowerCase()] ?? null },
        });
        if (url === 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv') return mk(CSV);
        if (url.startsWith('https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds')) return mk(oddsText(), { 'x-requests-remaining': '480' });
        return { ok: false, status: 404, text: async () => '', json: async () => null, headers: { get: () => null } };
      };
      w.open = (url, target, feat) => { opened.push({ url: String(url), target, feat }); return null; };
      if (live) w.localStorage.setItem('gridiron.nfl.odds', JSON.stringify({ key: 'TESTKEY', mine: ['draftkings', 'fanduel', 'betmgm', 'williamhill_us', 'fanatics'] }));
      if (setup) setup(w);
    },
  });
  const w = dom.window;
  const ready = () => w.document.querySelectorAll('#slate article.game').length > 0
    && (!live || /games, pulled/.test(w.document.getElementById('peStatus').textContent));
  await waitFor(ready, 20000, () => w.document.getElementById('slate').textContent.slice(0, 300));
  await new Promise(r => setTimeout(r, 50));
  return { dom, window: w, requests, errors, opened };
}

export async function waitFor(fn, ms = 10000, why = () => '') {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting: ' + why());
    await new Promise(r => setTimeout(r, 25));
  }
}

const norm = s => s.replace(/\s+/g, ' ').trim();

// Everything the app displays, as text. Numbers are what matter; text is
// kept whole so any change at all shows up.
export function snapshot(w) {
  const d = w.document, $ = id => d.getElementById(id);
  const out = { sub: norm($('sub').textContent), foot2: norm($('foot2').textContent), foot3: norm($('foot3').textContent) };
  out.slateCallouts = [...d.querySelectorAll('#slate > .callout')].map(e => norm(e.textContent));
  out.slate = [...d.querySelectorAll('#slate article.game')].map(a => norm(a.textContent));
  $('tabRatings').click();
  out.ratings = [...d.querySelectorAll('#ratings tr')].map(r => norm(r.textContent));
  $('tabLog').click();
  out.log = norm($('log').textContent);
  $('tabBets').click();
  out.bets = norm($('bets').textContent);
  $('tabSlate').click();
  return out;
}
