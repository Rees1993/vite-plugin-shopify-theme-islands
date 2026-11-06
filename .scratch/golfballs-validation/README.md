# Real Golfballs validation

Paired baseline (50331f0) and updated runtime, integrated through the actual
Golfballs Vite build. Both builds use the same clean theme checkout and dependencies.
Original theme checkout and deployed theme are not modified.

`node .scratch/golfballs-validation/build.mjs` prepares isolated builds under
/tmp/golfballs-validation. It instruments only the synchronous public revive()
boundary in both variants. `validate.mjs` loads real Shopify HTML/data and overrides
the theme bootstrap and matching generated chunks inside the measurement browser.
Each served replacement is fingerprinted. No upload or publish is performed.

`validate.mjs` uses the previously authenticated measurement profile, visible Chrome,
mobile viewport, cold HTTP cache, 4× CPU and unthrottled network. It alternates
baseline/candidate and visits home, collection, product and search three times.
Reports remain under /tmp/golfballs-live-validation until reviewed/sanitized.
`flows.mjs` adds repeated cart, PDP quantity and mobile filters/desktop sorting,
and an unmodified deployed homepage as a diagnostic control. No order is placed
and no cart contents are changed by these checks.

Timing is local lab evidence on real storefront pages. It is not deployed rollout
verification or field Core Web Vitals. LCP/CLS are collected over a fixed five-second
post-DCL window and cannot establish a durable page-speed improvement. Theme
commit, bootstrap hashes, consent, source reference and actual override requests
are retained in the report. Screenshots and error stacks stay in temporary output
until checked for session-sensitive content.

## Actual local development check

An isolated copy at /tmp/golfballs-validation/local-dev explicitly imports
/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/dist/index.js in
vite.config.js. `bun run build` ran in the plugin repo before starting the servers.
Vite serves on localhost:5175; Shopify CLI serves on 127.0.0.1:9293 with
`theme dev --environment development --port 9293 --nodelete`. The browser reports
role `development`, theme 193189904701, and requests this repo's dist/runtime.js
through Vite's /@fs/ route. These local checks use no response interception.

`GOLFBALLS_LOCAL_URL=http://127.0.0.1:9293` makes flows.mjs test that preview.
`GOLFBALLS_FLOW_REPORT_ROOT` chooses output; `GOLFBALLS_FLOW_ROUTE` accepts a
comma-separated subset. `hmr.mjs` edits a comment in the isolated copy only,
verifies the accepted virtual module updates and checks controls before/after,
then restores the file. No original Golfballs source is edited.

A separate /tmp/golfballs-validation/local-production build uses the same local
dist plugin without timing instrumentation. The production build succeeds. Dev
uses debug:true, so it is used for integration and HMR correctness rather than
representing the diagnostic-off production performance benefit.

Shopify CLI's local preview synchronizes a development theme; it is not entirely
offline. See [the official command reference](https://shopify.dev/docs/api/shopify-cli/theme/theme-dev).
No live-theme development flag, publishing, checkout or cart-content mutation is used.

## Review hardening

Build preparation now writes validation-build.json per variant, including resolved
source references, copied-source hashes and the actual bootstrap fingerprint.
Rebuild older temporary checkouts before using the hardened runners. Validation
uses those prepared references, not the repo's HEAD at measurement time.
`validate.mjs --check-builds` verifies assets and prints prepared attribution
without launching a browser. Missing/changed bootstrap files fail.

Flow success requires the prepared bootstrap fingerprint, or (for local dev) the
exact local Vite runtime URL, successful HTTP response and matching preflight body
hash. Empty selections and invalid measurement-round counts fail before browser
launch. `check-provenance.mjs <request.json>` can validate a captured provenance
request independently; CLI regression tests cover positive and negative cases.
