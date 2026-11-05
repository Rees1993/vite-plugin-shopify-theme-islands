Status: ready-for-human
Category: validation

# Compare candidate behavior and performance against a matched baseline

## Prerequisites

Before-change evidence is collected with `scripts/measure.mjs`; its result and validation status are recorded in `evidence/BASELINE.md`. Do not interpret a failed audit or password-page result as a performance baseline.

## Acceptance

- [x] All standard tests/typecheck/lint pass, and all intended regressions turn green.
- [x] Native recovery matrix is all green, including actual registration and MutationObserver behavior.
- [ ] Golfballs functional checks in PRD pass at mobile and desktop breakpoints.
- [ ] A preview serving the candidate package is identified; record theme ID, emitted asset identifiers and local revisions.
- [ ] Repeat the exact four routes, settings, consent and sample count of the valid baseline.
- [ ] Compare every sample plus median/range of LCP, CLS, TBT, JS transfer and control readiness.
- [x] Explain measurement failures, missing values and environmental variance explicitly.
- [x] Investigate regressions outside observed baseline ranges and repeat measurements when needed.
- [x] Do not claim field INP, a statistically established improvement from three samples, or a storefront speed gain from the Discovery microbenchmark.

No candidate deployment or package publishing is part of prerequisite work.

## Comments

Implementation validation passes (324 tests; native recovery 5/5). Candidate runtime setup evidence and investigated allocation costs are attached. Remaining storefront checks require an identified candidate preview; deployment/publishing was not authorized. Preserve the baseline and its product capture warnings. See ../WORKFLOW.md.
