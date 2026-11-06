# Runtime reliability workflow

Scope: cancellation transfer, successful recovery of earlier parent Subtrees, and
consistent nested-root membership and Teardown. First-observed occurrence Gate
ownership is preserved. The later included-child cascade fix also covers a child
held behind an excluded ancestor's in-flight import.

## Test-driven implementation

User-approved seams: public `revive()` controls, DOM changes, loader outcomes and
runtime events; deterministic browser/time adapters; real Chromium custom-element
registration and MutationObserver fixtures. Internal collaborators are not mocked.

Use one failing behavior test followed by the smallest implementation, targeted
checks and regular typechecking. Run the full suite at completion and independent
Standards/Spec reviews. Commit on the fix branch. No release or publishing.

The shared Activation session owns Tag state, retry budgets, module loading,
settlement and recovery. Element execution evaluates Gates. Lifecycle owns scans,
current membership and cancellation. Debug observability remains separate from
runtime events (ADRs 0001/0002). Obsolete internal collaborator-mocking suites were
replaced with public behavior coverage.

## Accepted behavior

- The first observed occurrence owns one pending Gate policy per Tag. Later
  occurrences retain root membership without additional Gate controllers.
- Cancelling that owner transfers pending work to the next observed occurrence.
- Shared imports/retries remain single-flight, with no automatic retry granted to
  exhausted parked roots. A fresh element may begin a later attempt.
- Successful recovery releases earlier observed parent Subtrees and their children.
- Nearest explicit inclusion/exclusion governs cancellation and activation.
- Explicitly included children survive parent exclusion, including when blocked
  behind its in-flight import; later excluded/detached children remain inactive.
- Disconnect suppresses late success/rejection, events and further activation.
- Built-ins remain sequential before Custom Directives. Repeated callbacks cannot
  bypass AND semantics. Consumer cleanup and event reentrancy preserve ownership.

## Verification

Latest standard suite: 344 passing tests. Typecheck, lint, formatting and build pass.
Native Chrome: five recovery cases, four policy cases and 25 resource samples pass.
Independent Standards and Spec reviews have no remaining actionable findings.
See `../included-child-cascade/results.md` for final evidence and review details.

The local Golfballs development preview uses this repo's rebuilt plugin through
Vite. Home, collection, product and search pass all 17 interaction checks with
verified runtime response hashes. Four targeted included-child registration cases
also pass in that development page. Earlier intermittent pre-script Shopify HTTP
500s remain recorded; the final runs passed without navigation retries.
See `../golfballs-validation/` for earlier paired production-mode browser overrides
and actual local development checks. Neither is a published-release verification
or a field performance claim.

## Historical correctness setup baseline

Reproduce with:

```sh
RUNTIME_ARTIFACT_ROOT=/tmp/islands-runtime-comparison node .scratch/runtime-activation-reliability/scripts/compare-runtime-setup.mjs
```

The script builds the pinned original baseline from git and the current candidate source, then alternates them in one native Chrome process. Five warm-up rounds precede 30 samples per variant/fixture at normal CPU and 4× CPU throttling. These are repeated warm setup measurements, not cold page startup, storefront LCP or real mobile hardware. All samples and source hashes are preserved in evidence/runtime-setup-matched-bugfix-only.json. Native counts and complete cleanup are separately recorded in runtime-setup-bugfix-only.json.

| CPU rate | Fixture | Baseline median / P90, ms | Bug-fix-only median / P90, ms |
| --- | --- | --- | --- |
| 1× | 100 interaction | 0.40 / 0.60 | 0.45 / 0.80 |
| 1× | 1,000 interaction | 1.15 / 1.50 | 1.40 / 1.70 |
| 1× | 1,000 visible | 1.20 / 1.40 | 1.45 / 1.70 |
| 4× | 100 interaction | 0.10 / 0.50 | 0.40 / 0.70 |
| 4× | 1,000 interaction | 2.85 / 3.10 | 3.20 / 3.70 |
| 4× | 1,000 visible | 2.40 / 2.70 | 2.80 / 3.20 |


The correctness changes retained a small measured setup cost in those historical
stress fixtures, including root cancellation bookkeeping. At 4× CPU, 1,000
interaction elements measured 2.85 → 3.20 ms. Do not treat these measurements as a
zero-regression result. The subsequent diagnostic/no-exclusion fast paths and
matched Golfballs measurements are recorded in `../runtime-common-path/` and
`../golfballs-validation/`; final included-child setup/settlement checks are in
`../included-child-cascade/`. Timings remain informational rather than CI thresholds.
