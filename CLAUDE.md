# Gridiron NFL

## House rules

Follow these in every task.

1. Additive changes only. Keep every existing feature, data field and prediction formula working unless the task says otherwise.
2. Keep the current architecture. If this is a single-file HTML PWA, keep it single-file, load libraries from a CDN with pinned versions, and add no build step.
3. Free plans only (Supabase free, Netlify free). Warn me before anything that could push past a free limit.
4. Don't add paid services or new API keys without asking me first.
5. No em dashes or en dashes anywhere: UI text, code comments, docs.
6. If you copy code from an MIT licensed repo, keep its copyright and license notice in a comment above that code.
7. Bump the version number shown in the app and add a dated line to CHANGELOG.md.
8. Before saying done, test at phone width and tell me exactly what to tap to check it.

## How the rules apply in this repo

**Architecture.** The app is a single file, `deploy/index.html`, with all code inline and no external libraries today. It ships by dragging the `deploy` folder onto Netlify Drop, and only that folder is deployed. `package.json` and `node_modules` exist only for the test harness. They are not a build step, and nothing in `deploy/` may depend on them. If a library is ever needed, load it from a CDN with an exact version (`lib@1.2.3`, never `lib@1` or `latest`).

**Version.** It lives in two places. Change both together:

- `MODEL_VERSION` in `deploy/index.html`. Shown as "Model 2.2.0." in the page footer. It also keys the ratings fit cache (a bump forces one refit, about 130 ms) and is sent as `model_version` in the War Room export.
- `APP_VERSION` in `deploy/sw.js`. If this one is missed, installed phones keep serving the old cached shell.

A change that touches nothing in `deploy/` (docs, tests, this file) gets a CHANGELOG line but no version bump, because the app itself did not change.

**Prediction formulas.** `npm test` runs the whole suite. Its compare step checks every number the app displays against `test/baseline/before.json` and allows only the footer version to differ. If compare fails, a formula or a displayed value changed. That is only acceptable when the task asks for it, and then the baseline is re-captured on purpose with `node test/snapshot.mjs before` and moved into `test/baseline/`. `before.json` is now the 2.3.0 defaults. Since 2.4.0 the snapshot leaves out anything marked `data-kn` (the key number blocks), so the older numbers stay under guard while the new ones are tested in `test/keynumbers.test.mjs`. `before-2.1.0.json` is the original, and `test/fair.test.mjs` checks that the Multiplicative fair price setting still reproduces every number in it.

**Fair prices.** `fairPrice` in `deploy/index.html` holds four no vig methods. `nv` on a bet is always multiplicative, because closing value is graded against it. `mktEdge`, the number the no vig gate tests, is measured against the EV gate setting. Worst case means the highest fair probability of the four for the side being bet, since the gate is model minus fair price. In two way markets Shin and Additive give identical numbers.

**Free limits to watch.**

- The Odds API: the user's own key, typed into the app, on the free tier with a monthly request quota. Anything that calls it more often (a shorter `PE_TTL`, which is hourly now, or more markets, regions or sports per pull) needs a warning first.
- Netlify free: drag and drop deploys use no build minutes. Watch bandwidth if the deploy folder grows, for example from bundled data or large images.
- Supabase: not used by this app yet.

**Shared odds engine.** The block with `PE_VERSION` in `deploy/index.html` is identical in three apps. Changing it here means copying the change to the other two and bumping `PE_VERSION`, so flag that before touching it.

**Dashes.** `npm test` includes a scan of every tracked or new text file for em and en dashes (`test/no-dashes.mjs`) and fails on any hit.

**MIT code.** Put the notice in a `/* */` comment directly above the copied code inside `index.html`: source URL, the copyright line, and the full MIT permission text.

**Phone width check.** Playwright and Chromium are already installed for the tests. Serve `deploy/` over http (the handoff test does this on port 8801 and routes the nflverse CSV to `test/fixtures/games.csv`), open it at 390 by 844, go through every tab the change touches, and confirm no horizontal scroll and no console errors. Then tell the user the exact taps on their phone. When the change touches `deploy/`, the first step is always the deploy itself: open https://app.netlify.com/projects/gridirionnfl/deploys and drag the `deploy` folder (not the project folder) onto the drop box. Then give the taps. The live site is https://gridirionnfl.netlify.app, spelled with "gridirion".

**Tests.** Use `npm test`. The README's Verification section names `render_test.js` and `interact_test.js`, which are not in this repo.
