# Included-child cascade verification — 2026-11-06

Fixed on `fix/runtime-reliability-and-performance`, based on `9219586`.
Main remains `af71a36`. No push, PR, publication or release performed here.

## Behavior and TDD

The public regression first failed with expected child loader count 1, actual 0.
The fix retains only explicitly included descendants blocked below a pending
ancestor Tag. Ordinary descendants still use the existing parent subtree walk.
When that Tag is released or successfully loaded, retained children are
reconsidered against their current membership and ancestor Gates. Exclusion and
mutation prune detached/excluded references; full disconnect clears them.
No new per-element controller or event subscription is introduced.

The native fixture also proved red on the unchanged `9219586` reference: three
old cases pass, the new included-child cascade case fails. The final runtime
passes all four policy cases, all five recovery cases and 25 resource samples.
The required native report case list now rejects reports omitting this regression.
Public tests also cover subsequent child exclusion, detachment and disconnect.

Final checks: 344 tests pass; typecheck, lint, formatting and build pass. See
`evidence/tests.txt`, `native-red.json`, `native-green.json`, `native-recovery.json`
and `native-scale.json`. Native report commit attribution identifies the unchanged
parent HEAD because testing preceded commit; bundle hashes identify actual tested
bytes. Final native and paired timing bundle hashes match:
`1b51b01ee7ca570a1d5288bb14392409f5442bebe05dfada91afd6c0d1cebda7`.

## Performance

Review identified duplicate work in the first implementation, which tracked all
blocked children then reconsidered them after the ordinary subtree walk. The
first 40-sample paired comparison with 1,000 child Islands behind an unresolved
Island import measured median settlement 3.1 → 4.2 ms at 4× CPU.
That implementation was narrowed to explicit inclusion before acceptance.

Final paired measurements of the same ordinary blocked-child scenario:

| Metric | Normal CPU, reference → fix | 4× CPU, reference → fix |
| --- | --- | --- |
| Synchronous setup | 0.5 → 0.5 ms | 1.70 → 1.55 ms |
| Settlement | 1.1 → 1.1 ms | 3.1 → 3.1 ms |

Five warmups, 40 samples per variant/CPU, alternating order, actual pending Island
ancestry, no DOM construction inside setup timing. Raw samples and outliers are
preserved in first/final-blocked-timing.json. These synthetic measurements exclude
debug diagnostics, custom-element registration and explicit-root bookkeeping;
they are not field performance or proof of equal cost for every case. The fix
adds necessary bookkeeping when explicit roots exist. No timing threshold in CI.

The final existing nine-scenario benchmark also completed: 40 samples per variant
at normal and 4× CPU. At 4× CPU, interaction setup is 2.3 → 2.2 ms, nested ordinary
container setup 3.15 → 3.2 ms, visible setup 2.25 → 2.35 ms, and disconnect
0.8 → 0.8 ms. These small mixed differences do not establish a general speedup or
zero overhead. See common-path-timing.json and common-path-samples.csv. Its
candidate bundle hash matches the final native fixture and blocked-child timing.

To rerun measure-blocked.mjs, first create its isolated reference checkout with
`git worktree add --detach /tmp/islands-parent-reference 9219586`. It uses the
current checkout for the candidate, local Puppeteer and installed Google Chrome.

## Golfballs development validation

Built the plugin before running the isolated copy at
`/tmp/golfballs-validation/local-dev`. Its Vite config imports this repo's
`dist/index.js`; Vite serves localhost:5175 and Shopify CLI serves 127.0.0.1:9293.
The actual browser reports theme role `development`, ID `193189904701`.
Shopify CLI synchronizes that development theme; no live-theme publishing occurs.
The original Golfballs checkout remains clean.

Final home, collection, product and search runs all return HTTP 200, all 17 flow
checks pass and browser error arrays are empty. Covered mobile menu/search/cart,
PDP quantity, collection/search filter drawers, desktop sorting and replacement
results. Each page's actual runtime response is verified against local Vite's
preflight bytes, with no response interception. See dev-flows-final.json.

The separate browser probe imports that exact runtime within the real development
page and temporarily adds isolated fixture markup. Actual custom-element
registration verifies retained child success and exclusion/detachment/disconnect
suppression; excluded siblings remain unloaded. All four pass. This is a targeted
plugin regression in the real dev environment, not a claim that Golfballs' normal
markup naturally exercises this root-policy edge. The fixture DOM and its session
are removed after each case. See dev-regression-final.json and validate-dev.mjs.

Final transformed Vite runtime response hash:
`16c9de19122c2df2d50a1ae477d7fdd10a0448c9210ceb8dbbe1982c2643019d`.
This differs from the raw native bundle because Vite transforms and maps it.

Initial requests intermittently returned Shopify HTTP 500 before scripts loaded;
these are preserved in initial/retest evidence and their cause remains unresolved.
Final full-page flows and final regression probe passed without navigation retries.
Rebuilding the plugin restarted Vite, requiring its virtual module to resolve
before an external `/@fs/` preflight was allowed. An initial probe also attempted
to finish its controlled import before it started; review caught this runner race.
The probe now explicitly waits for import start with a timeout. Its failed report
is retained as dev-probe-harness-error.json; it was not a runtime pass.

## Standards

Independent fresh-context Standards review against main plus this fix found no
actionable findings. Supplemental review of explicit-include retention and the
new measurement/development scripts also found none. No prototype source adopted.

## Spec

Independent fresh-context Spec review found the dev probe's missing import-start
wait; corrected before the successful final run. No remaining actionable findings.
Additional public probes passed for rejected excluded-ancestor imports, explicitly
included Island roots, moves beneath another pending ancestor, and disconnect
during an ancestor Gate wait. These were supplementary review probes rather than
new committed acceptance tests. Native/dev final evidence completes the reviewers'
previous validation limitation. Hosted Linux CI and an uploaded release candidate
remain outside this local validation; the reviewed fixes have not been published.
