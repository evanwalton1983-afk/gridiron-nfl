# Gridiron NFL: Send to War Room report

App version 2.2.0. Contract `warroom.import` 1.0. The schema in the War Room repo matches the one attached, so nothing in the contract changed.

Sample: [sample-payload-gridiron_nfl-2026-week-3.json](sample-payload-gridiron_nfl-2026-week-3.json). It covers 2026 week 3 with live prices from a test Odds API response: 96 records for 16 games.

## What the export sends

- **Records.** Every game on the selected week that is not final gets six records: spread home and away, total over and under, moneyline home and away. A game where the app evaluates no market at all (no line) is skipped and named in the status line.
- **Probabilities.** `prob_win` and `prob_loss` are the p and pOther behind each row of the app's model board. `prob_push` is what is left: the key number atom for spreads and totals, and the measured tie rate (about 0.2%) for moneylines. The on-screen Model column, which excludes pushes, is not sent. The tests show that each exported pair reproduces that column to the displayed tenth of a percent on all 186 board rows checked.
- **Ladder.** Spreads and totals carry the market line and every half point within 2 points either side, 9 steps. They are read from the same tilted distribution the app already uses, so there is no new modeling. The step at the market line equals the record's own probabilities.
- **Prices.**
  - **Live best price at your books:** odds, the other side's odds at the same book, the book short code as shown (DK, FD, MGM, CZR, FAN), and `captured_at` set to when the app pulled the Odds API response.
  - **nflverse closing numbers (no key, or a game missing from the feed):** the line only, with `no_price_in_app`. They have no book and cannot be bet, so they are never sent as a price.
  - **A side none of your books offers:** the line only at the consensus line the app displays, with `no_price_in_app`, plus `not_at_your_books` when the app says so.
  - **Moneylines with no price:** no price block at all.
- **model_config.** Holds the `BEST` rating parameters, the staking gates (KELLY_FRAC, MAX_STAKE, EV_BAR, NOVIG_BAR), the measured shrink values, the variance band cuts, the tie rate, the last fitted game, the price source, and the books selected. All of these are read, never written. The Odds API key is never included.

## Flags

| flag | when | in the sample |
|---|---|---|
| `early_season` | weeks 1 to 4 (the app's own notice) | 96 |
| `push_on_half_line` | half-point spread or total with `prob_push` above 0 | 36 |
| `no_price_in_app` | no real price for that side | 12 |
| `not_at_your_books` | game is in the feed but none of your books prices it | 6 |
| `uncertain_qb` | the app shows "quarterback unlisted" | 0 |

**push_on_half_line.** The app builds its residual distribution from games at whole and half lines together. The result is a push atom of 1.2% to 3.3% even at half-point lines, which the app itself displays ("covers (2.3% push)" at 4.5). These numbers are exported as they are, without changing the model math, and carry this flag. It also appears in file mode, where 56 of 64 spread and total records have it. Half-point ladder steps have the same property. They carry no flag of their own because flags apply to the whole record.

## Contract fields the app cannot supply

| field | why |
|---|---|
| team totals (`market.type: team_total`) | The app projects team scores but never prices a team total market, so none are sent. |
| `event.venue` | The app does not read the stadium column. |
| `event.timezone` for international games | Always `America/New_York`, because nflverse gives ET kickoff times. London and Munich games still have the correct UTC `start_time`. |
| `participants[].source_id` | No separate id. Names are nflverse codes (KC, LA, WAS), which the War Room already has as `gridiron_nfl` aliases. |
| `model.confidence`, `model.edge_supplied` | The app has no confidence score. EV and gap depend on the price, and the War Room computes them itself. |
| moneyline `projection` and `fair_line` | The app has no fair moneyline price. This matches the War Room's own NFL fixture. |

## Things to know on the War Room side

1. **Live sides can come from different books at different lines.** The app picks the best price per side, and the moneyline is read from each book's own spread line. As a result, the home and away records for one game are not always mirror images:
   - In the sample, 6 of 16 spread pairs sit at different lines.
   - 10 of 16 moneyline pairs have home win differing from away loss, by up to 2.7 points.
   
   This is what the app shows on its board. Each record is internally consistent and sums to 1, so grade each record on its own.
2. **captured_at is one time for all prices**: when the app pulled the Odds API response, not each book's own update time.
3. **Games already final are never sent.** The ratings have already absorbed those results. On a past week the Send button is disabled.

## After deploying

- Add Gridiron's Netlify domain to `handoff_allowed_origins` in War Room Settings, or the receiver discards the handoff.
- The first load after deploy rebuilds the ratings once, because the version is part of the saved fit's key. This takes about 130 ms.
- The receiver URL defaults to `https://lighthearted-kringle-dafe7e.netlify.app/import/receive` and can be changed under Receiver on the Slate tab.

## Tests (`npm test` from the project root)

- **Before and after:** 4,606 displayed numbers are identical across both price modes, the current and next week, Ratings, and the Season log. The only difference is the footer version (2.1.0 to 2.2.0).
- **Payload checks in jsdom:** 2,408 checks passed and 0 failed. They cover:
  - schema validity with ajv
  - the War Room's own import pipeline: 0 errors and 0 warnings on 96 records, in both modes
  - both sides of every market
  - probability sums, ladders and flags
  - Copy and Download are byte-identical to the payload
  - no new network requests and zero JS errors
  - no em or en dashes
- **Handoff in real Chromium, across three local origins:** 20 checks passed and 0 failed.
  - The correct receiver gets exactly one payload, the app shows "Sent 96 records...", and Copy and Download match it.
  - An impostor on the wrong origin gets nothing.
  - The 60-second timeout shows the fallbacks.
  - Zero JS errors and no sideways scroll at 1280px and 390px.
  - The service worker installs `gridiron-2.2.0`.
