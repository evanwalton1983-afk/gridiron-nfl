# Changelog

Newest first, one dated line per change. The number in brackets is the version shown in the app footer.

- 2026-10-21 [2.4.0, no app change]: Added deploy/_redirects, a 200 rewrite of /deploy/* to the root, so phones that installed the app from /deploy/ keep working and updating after the site is redeployed from the deploy folder. New test/redirects.test.mjs checks the service worker scope, manifest and offline shell at both addresses.
- 2026-10-21 [2.4.0]: Key number engine. New scripts/build_key_numbers.py (one time, uses nflreadpy) builds a table of final margin odds by spread, embedded in the app as KEYNUM with no run time download. Each game now shows the push chance at the current spread, fair prices for alt spreads from -14.5 to +14.5 matched to the main line's vig free price, and the value in cents of buying or selling a half point. New Teasers panel for your 2 team and 3 team 6 point prices, with teaser legs through both 3 and 7 flagged, each leg's win chance and the break-even, per game and as a week summary. The pick model, gates and every older displayed number are unchanged.
- 2026-10-15 [2.3.0, no app change]: README deploy steps now name the gridirionnfl Deploys page and warn against dropping the whole project folder, which had put the app at /deploy/index.html and left the site root returning "Page not found".
- 2026-10-15 [2.3.0]: Fair price methods. New fairPrice module (multiplicative, additive, power, Shin) and a Fair price panel on the Slate tab: Fair price method for the no vig prices shown (default Shin) and EV gate for the no vig gate on every flag, here and in the season log (default Worst case, the highest fair probability of the four for the side being bet). Every fair price and gap is labelled with its method. Multiplicative for both reproduces 2.2.0 exactly. Closing value stays multiplicative.
- 2026-10-15 [2.2.0, no app change]: Added CLAUDE.md with house rules, this changelog, and a dash check in `npm test`.
- 2026-09-23 [2.2.0]: Added Send to War Room export (contract 1.0) on the Slate tab, with Copy JSON and Download JSON fallbacks.
- 2026-09-23 [2.1.0]: Baseline, as deployed.
