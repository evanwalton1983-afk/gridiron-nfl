# Gridiron Model

NFL score forecasting model. Runs entirely in the browser, no server and no Python.
On load it fetches the nflverse games file, refits team, defense, and quarterback
ratings across every completed game since 1999, and predicts the selected week.

## Deploy to Netlify

Drag the `deploy` folder (and only that folder) onto the Netlify drop zone at
https://app.netlify.com/drop. It holds just the five files the live app needs.
Everything else in this project (tests, docs, node_modules) stays out of it.

That is the entire deployment. No build step, no environment variables, no
dependencies. `netlify.toml` sets the publish directory and keeps the service
worker uncached so updates take effect.

## What is in here

| file | purpose |
|---|---|
| `index.html` | the app, model included |
| `sw.js` | service worker, offline shell |
| `manifest.webmanifest` | installable app metadata |
| `icon.png` | app icon |
| `netlify.toml` | publish config and cache headers |

## How it works

The full model is inlined in `index.html` and verified to reproduce the Python
reference exactly. Refit takes roughly 130 ms.

1. Fetch `games.csv` from nflverse. Cached in localStorage for 3 hours.
2. Replay every completed game, updating team offense, team defense, and per-QB
   ratings after each one.
3. For the selected week, convert each team's expected score into a full discrete
   distribution by exponentially tilting the empirical NFL score distribution.
4. Convolve the two distributions. Read moneyline, spread, total, and team totals
   off the same joint distribution so they can never disagree.

## Reading the screen

Amber is always the model. Blue is always the market. The large number on each row
is the gap between them in points, which is the whole reason the app exists.

Tap any game to expand win probability, cover probability, over probability,
projected team totals, starting quarterbacks, and any weather or venue adjustment
that was applied.

The Team ratings tab shows the model's internal state: each team's offense and
defense in points per game relative to average, plus its current starter's QB
rating. Defense is points allowed relative to average, so negative is better.

## Offline

After the first visit the app shell is cached by the service worker and the game
data is cached in localStorage. Opening it without a connection shows the last
fetched slate and notes that the network was unavailable.

## Updating

Predictions refresh automatically as nflverse posts results. Press Refresh, or
reopen after the 3 hour cache window, and ratings rebuild from scratch.

To retune hyperparameters after more seasons accumulate, run `tune.py` in the
Python project and paste the new values into the `BEST` object in `index.html`.

## Honest note

Historical testing showed this model beats its Elo predecessor on moneyline
accuracy, log loss, and projected score error. On spreads and totals its
discrimination is at chance (AUC near 0.50). Treat the projections and win
probabilities as the useful output.

---

## Does the model update itself?

Yes, in the way that matters. Every load refetches nflverse and replays all
completed games from scratch, so last Sunday's results are in Monday's ratings
with no action from you.

What does **not** update automatically is the hyperparameter block (`BEST` near
the top of the script). That is deliberate. Those constants describe how fast
ratings should move and how much QB skill persists across seasons, which are
structural properties of the sport measured over twenty years. Re-fitting them on
sixteen new games every week would fit noise and make the model worse.

Re-run `tune.py` once each offseason, or when the Season log shows a persistent
calibration gap. That is the correct cadence.

## Season log

The third tab scores every game of the in-progress season against what the model
said **before** it was played. During the fit, when the replay reaches the current
season it freezes a score distribution from all prior years and records a
prediction for each game before learning from it, so the log is a true
walk-forward record rather than a replay of results already absorbed.

It shows:

- winner picked, spread side, and over/under records
- average margin and total miss, with the market's margin miss alongside as the
  benchmark
- a confidence check comparing what the model claimed against what actually
  happened, bucketed by how confident it was

That last panel is the one to watch. When the two columns track each other, the
model's confidence is honest. A gap that persists past thirty or forty games is
the signal that something has drifted and a re-tune is warranted. Before that,
it is small-sample noise.

## Adaptive learning rate, tested and rejected

A v3 was built with Kalman uncertainty tracking so the learning rate would fall
through each season automatically. On the 2016-2025 holdout:

| | v2 fixed gain | v3 adaptive |
|---|---|---|
| moneyline log loss | 0.63469 | 0.63240 |
| margin MAE | 10.1012 | 10.1053 |
| total MAE | 10.7859 | 10.7655 |
| spread log loss | 0.70474 | 0.70591 |
| margin MAE weeks 1-4 | 10.0879 | 10.2467 |
| margin MAE weeks 15+ | 10.3415 | 10.2740 |

It helps late in a season and clearly hurts in weeks 1 through 4, where moving
fast means overreacting to two games when last season's carryover is the better
information. The moneyline gain sits at p = 0.051, which after testing three
model variants is exactly the marginal result that does not replicate.

Not shipped. `models_v3.py` is kept in the Python project for reference.


---

## Verification

Both apps are executed in a real DOM (jsdom) as part of the build, not just
syntax-checked. Every tab is clicked, every render path runs, and the suite
asserts:

- all tabs render non-empty content with zero runtime errors
- the model reproduces the Python reference exactly
- a renamed upstream column produces a loud, accurate error rather than silent
  nulls and confident nonsense
- interactive paths work end to end (search, select, expand, sort, week stepping)

Run `node render_test.js` and `node interact_test.js` from the project root after
any change.

## Storage

Cached data lives in IndexedDB, with localStorage as a fallback only if IndexedDB
is unavailable. An earlier version used localStorage alone, which put a multi-MB
payload against a 5MB browser ceiling. A quota failure there would have silently
forced a full re-download on every open.

## Score independence, checked

The convolution treats home and away scores as independent. That assumption was
tested rather than assumed: residual correlation across 5,433 games is 0.0094,
and it flips sign by era (-0.036, +0.040, +0.028). Total standard deviation is off
by 0.47%, which is negligible. A correlated copula would add complexity for no
measurable gain and was not built.

## Early season

Weeks 1 through 4 carry an on-screen notice. Holdout margin error in that window
runs about 0.25 points worse than mid-season, because ratings have just taken the
offseason shrink and carryover is doing most of the work. Letting those weeks look
as solid as week 12 would be misleading.

## Send to War Room

The Slate tab has a **Send to War Room** button. It builds one War Room import
(contract 1.0) holding every market on the selected week, both sides of the
spread, total and moneyline, for every game not yet final. It then opens the
War Room receiver in a new tab and hands the file over. The payload goes only to
the receiver's exact origin, and only after that tab says it is ready.

If the tab is blocked or does not answer within 60 seconds, **Copy JSON** and
**Download JSON** give the same file to import by hand. The receiver address
is under Receiver, and defaults to
`https://lighthearted-kringle-dafe7e.netlify.app/import/receive`.

The export only reads the model. Probabilities are the ones behind the board,
with push included, not the push-free Model column. The nflverse closing
numbers are sent as lines only, flagged `no_price_in_app`, because they have
no book. For the War Room to accept the handoff, this site's domain must be
listed in `handoff_allowed_origins` in War Room Settings.
