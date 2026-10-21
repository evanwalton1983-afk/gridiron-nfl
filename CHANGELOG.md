# Changelog

Newest first, one dated line per change. The number in brackets is the version shown in the app footer.

- 2026-10-15 [2.3.0, no app change]: README deploy steps now name the gridirionnfl Deploys page and warn against dropping the whole project folder, which had put the app at /deploy/index.html and left the site root returning "Page not found".
- 2026-10-15 [2.3.0]: Fair price methods. New fairPrice module (multiplicative, additive, power, Shin) and a Fair price panel on the Slate tab: Fair price method for the no vig prices shown (default Shin) and EV gate for the no vig gate on every flag, here and in the season log (default Worst case, the highest fair probability of the four for the side being bet). Every fair price and gap is labelled with its method. Multiplicative for both reproduces 2.2.0 exactly. Closing value stays multiplicative.
- 2026-10-15 [2.2.0, no app change]: Added CLAUDE.md with house rules, this changelog, and a dash check in `npm test`.
- 2026-09-23 [2.2.0]: Added Send to War Room export (contract 1.0) on the Slate tab, with Copy JSON and Download JSON fallbacks.
- 2026-09-23 [2.1.0]: Baseline, as deployed.
