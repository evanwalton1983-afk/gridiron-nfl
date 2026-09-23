// Builds a deterministic fake Odds API response for the week 3 slate in the
// frozen games.csv, shaped exactly like /v4/sports/americanfootball_nfl/odds.
// It covers: normal games at several books with differing lines and prices,
// one game missing from the feed (file mode), one game only at books the
// owner does not use (not at your books), and whole-number lines.
import fs from 'node:fs';
import path from 'node:path';
import { FIX } from './lib/boot.mjs';

const NAMES = {ARI:'Arizona Cardinals',ATL:'Atlanta Falcons',BAL:'Baltimore Ravens',BUF:'Buffalo Bills',CAR:'Carolina Panthers',
  CHI:'Chicago Bears',CIN:'Cincinnati Bengals',CLE:'Cleveland Browns',DAL:'Dallas Cowboys',DEN:'Denver Broncos',DET:'Detroit Lions',
  GB:'Green Bay Packers',HOU:'Houston Texans',IND:'Indianapolis Colts',JAX:'Jacksonville Jaguars',KC:'Kansas City Chiefs',
  LV:'Las Vegas Raiders',LAC:'Los Angeles Chargers',LA:'Los Angeles Rams',MIA:'Miami Dolphins',MIN:'Minnesota Vikings',
  NE:'New England Patriots',NO:'New Orleans Saints',NYG:'New York Giants',NYJ:'New York Jets',PHI:'Philadelphia Eagles',
  PIT:'Pittsburgh Steelers',SF:'San Francisco 49ers',SEA:'Seattle Seahawks',TB:'Tampa Bay Buccaneers',TEN:'Tennessee Titans',WAS:'Washington Commanders'};
const BOOKS = [['draftkings','DraftKings'],['fanduel','FanDuel'],['betmgm','BetMGM'],['williamhill_us','Caesars'],
  ['fanatics','Fanatics'],['betrivers','BetRivers'],['ballybet','Bally Bet']];

let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = a => a[Math.floor(rnd() * a.length)];

const lines = fs.readFileSync(path.join(FIX, 'games.csv'), 'utf8').split('\n');
const head = lines[0].split(','), ix = Object.fromEntries(head.map((h, i) => [h, i]));
const rows = lines.slice(1).map(l => l.split(',')).filter(r => r[ix.season] === '2026' && r[ix.week] === '3');

const events = [];
for (const r of rows) {
  const home = r[ix.home_team], away = r[ix.away_team];
  if (home === 'NYG') continue;                       // TEN at NYG: not in the feed, app falls back to the file
  const onlyOthers = home === 'SF';                   // ARI at SF: only at books the owner does not use
  const sp = +r[ix.spread_line], tot = +r[ix.total_line];
  const commence = new Date(r[ix.gameday] + 'T' + r[ix.gametime] + ':00-04:00').toISOString().replace('.000', '');
  const books = BOOKS.filter(([k]) => onlyOthers ? ['betrivers', 'ballybet'].includes(k) : true).map(([key, title]) => {
    const dSp = pick([0, 0, 0, 0.5, -0.5]), dT = pick([0, 0, 0.5, -0.5]);
    const hp = -(sp + dSp);                            // home point
    const juice = () => pick([-105, -108, -110, -110, -112, -115]);
    const hj = juice(), aj = hj === -105 ? -115 : hj === -115 ? -105 : juice();
    const oj = juice(), uj = oj === -105 ? -115 : -110;
    const hMl = +r[ix.home_moneyline] + pick([-10, 0, 0, 5]), aMl = +r[ix.away_moneyline] + pick([-5, 0, 0, 10]);
    const markets = [
      { key: 'h2h', outcomes: [{ name: NAMES[home], price: hMl }, { name: NAMES[away], price: aMl }] },
      { key: 'spreads', outcomes: [{ name: NAMES[home], price: hj, point: hp }, { name: NAMES[away], price: aj, point: -hp }] },
      { key: 'totals', outcomes: [{ name: 'Over', price: oj, point: tot + dT }, { name: 'Under', price: uj, point: tot + dT }] },
    ];
    return { key, title, last_update: '2026-09-23T18:52:00Z', markets };
  });
  events.push({ id: 'ev_' + r[ix.game_id], sport_key: 'americanfootball_nfl', commence_time: commence,
    home_team: NAMES[home], away_team: NAMES[away], bookmakers: books });
}
fs.writeFileSync(path.join(FIX, 'odds-api.json'), JSON.stringify(events, null, 1));
console.log('wrote', events.length, 'events');
