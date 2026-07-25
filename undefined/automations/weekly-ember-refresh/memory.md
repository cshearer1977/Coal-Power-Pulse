2026-06-10 run
- Tried node ./scripts/fetch-ember-monthly.mjs
- Fetch failed in this workspace before any file rewrite
- Current dataset still shows marketCount 98 and latest month 2026-05
2026-06-11 run
- Tried node ./scripts/fetch-ember-monthly.mjs again
- Failure is network-side: api.ember-energy.org does not resolve in this workspace (ENOTFOUND)
- Current dataset files still show marketCount 98 and latest month 2026-05
