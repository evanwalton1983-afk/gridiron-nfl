# Send to War Room: Model App Export Button

**Run this only after War Room Phase 1 is accepted,** so the import contract and the `/import/receive` page are final. Run it once per app, in separate sessions: Gridiron NFL, then Gridiron CFB, then Corner UFC.

Attach two things to each session: the app's current HTML file, and `contract/warroom-import-1.0.schema.json` from The War Room repo. If the schema version in the repo is newer than 1.0, follow the repo version and tell me what changed.

---

## 1. Hard constraints (never violate)

1. **Do not change prediction logic.** No changes to model math, parameters, data fetching, caching, ratings, calibration, or any number the app displays. This change is additive only.
2. **Prove it.** Before editing, boot the app headless (jsdom) and save every displayed probability, line, projection, and rating for the current slate or card. After editing, do the same and compare. They must be identical. Show me the comparison.
3. **No credentials or keys of any kind** in the app. The app is a public web page. It never talks to Supabase or any database.
4. The app never places bets, and nothing in the button suggests placing one.
5. No em dashes or en dashes anywhere, including UI text and comments.
6. Bump the app's VERSION constant and the service worker cache version.
7. Plan first, show me the plan, and wait for approval before editing.

---

## 2. What the button does

A **Send to War Room** button on the slate (NFL, CFB) or card (UFC) view.

1. Build one canonical payload (import contract v1.0) for **every market the app evaluated** on the current week or card: both sides of every market, not just flagged plays. Skipping unflagged markets would skew War Room calibration.
2. Open the War Room receiver in a new tab. The URL is a setting in the app, default `https://<war-room-domain>/import/receive` (I will fill in the domain).
3. Wait for `{type: "warroom:ready"}` from that exact origin. Ignore messages from any other origin.
4. Post `{type: "warroom:payload", payload}` to that origin only (never `"*"`).
5. Wait for `{type: "warroom:received", records: n}` and show "Sent n records. Finish the import in The War Room."
6. If there is no ready message within 60 seconds, or the popup is blocked, show the fallbacks.

**Fallbacks** (always visible in a small menu next to the button):
- **Copy JSON** to the clipboard
- **Download JSON** as `warroom-<source_app>-<label>-<timestamp>.json`

---

## 3. Payload rules (all apps)

- **batch.source_batch_id:** `<source_app>-<season>-<grouping label>-<UTC timestamp>`
- **batch.model_version:** the app's VERSION constant
- **batch.model_config:** the model's current parameter values, as stored metadata (for example market trust and recency settings). Read them, never change them.
- **batch.generated_at:** when the button was pressed (UTC)
- **Probabilities:** `prob_win`, `prob_push`, `prob_loss` from the app's own existing distribution. They must sum to 1 within 0.001.
- **Ladder (spreads and totals):** probabilities at the market line and at every half point within 2 points either side, computed from the distribution the app already uses. If producing this would require new modeling rather than reading the existing distribution, omit the ladder and tell me why.
- **Prices:** the line and odds the app already shows, with `captured_at` = when the app fetched that price data (an absolute UTC time, never "N min ago") and the book name as shown. If a market has no real price in the app, add flag `no_price_in_app` and send no odds: spreads and totals still send a line-only price block (`"price": { "line": -3.5 }`, no odds, book, or `captured_at`), because The War Room rejects a spread or total without its line; moneylines send no price block at all. **Never send a placeholder or default price as if it were real** (for example CFB's default -110 juice when no book is shown).
- **Flags:** pass through the app's own warnings, for example `early_season`, `fcs_opponent`, `thin_record`, `uncertain_qb`.
- **Timestamps:** UTC with the event's IANA time zone.
- Validate the payload against the attached JSON Schema before sending. If validation fails, show the errors and do not send.

---

## 4. Per-app notes

### Gridiron NFL (`source_app: gridiron_nfl`)
- Markets: spread, total, and moneyline, both sides.
- Push probability at whole-number lines from the score distribution the app already uses. Moneylines carry the tie probability as `prob_push` too.
- The on-screen "Model" column excludes pushes (p / (p + pOther)). Do not export that column; export `prob_win`, `prob_push` and `prob_loss` from the distribution itself.
- Team totals only if the app already computes them.
- Do **not** remove the app's bet ledger in this change. It gets retired separately once War Room Phase 4 is live.

### Gridiron CFB (`source_app: gridiron_cfb`)
- Same markets and rules as NFL.
- Include the app's early-season, FCS, and totals-caution warnings as flags.
- Spreads and totals only carry odds when a book is shown for that market. When the app is using its default -110, send a line-only price block (`"price": { "line": -7 }`: the line, and no odds, book, or `captured_at`) and add flag `unverified_price`. The War Room stores the line and treats the market as unpriced.
- Read the model version from the app's VERSION constant (the app never displays it).
- Use the team names the app shows; The War Room handles aliases.

### Corner UFC (`source_app: corner_ufc`)
- Market: moneyline only, both fighters.
- Corner's Card tab shows real prices (best price and book per fighter). Send them as the price block with the book and an absolute `captured_at`. Fights with no price shown are sent without a price block and flag `no_price_in_app`.
- There is no card name anywhere in Corner. Default `grouping.label` to `UFC <fight date>` and let me edit it before sending.
- `prob_push` = 0 unless Corner already models draws.
- Bout details: weight class, scheduled rounds, card position, and bout order where Corner knows them.
- If Corner only knows the fight date, send `start_time_precision: "date"`. The War Room fills the exact time from odds data.
- Include thin-record and layoff uncertainty as flags.

---

## 5. Tests and acceptance

1. Before and after comparison of every displayed number is identical (constraint 2).
2. The payload validates against the War Room JSON Schema for a full slate or card.
3. Every evaluated market appears with both sides; the record count matches what the app displays.
4. Handoff test with a mock receiver page: the right origin gets the payload, a wrong origin gets nothing, and the timeout shows the fallbacks.
5. Copy and Download produce the same JSON as the handoff.
6. No network requests to anything new except opening the War Room tab (check with the headless run).
7. No em or en dashes in the changed file.
8. The app boots with zero JS errors on desktop and at 390px width.

**Deliverables:** the updated app file, the updated service worker, one sample payload file, and a short report listing any contract field the app could not supply.

**After deploying each app:** add its domain to `handoff_allowed_origins` in War Room Settings, or the handoff will be ignored.
