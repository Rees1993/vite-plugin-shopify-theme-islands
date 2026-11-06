Status: ready-for-human
Category: bug

# Recover earlier child Islands after a later successful shared parent load

## Evidence

Native-browser fixture verified twice at af71a36:

| Case | Earlier children A/B | New child C | Expected |
| --- | --- | --- | --- |
| Initial shared parent success | 1 / 1 | 0 | pass |
| Final failure, no new element | 0 / 0 | 0 | pass: no extra retry |
| Successful automatic retry | 1 / 1 | 0 | pass |
| Fresh parent causes later success | 0 / 0 | 1 | fail: A/B should cascade |
| Same later success plus `scan()` | 1 / 1 | 1 | workaround |

`evict()` deletes pending Subtree roots; the initiating root only lives in the abandoned attempt. Later success rewalks its own element and no earlier roots.

## Acceptance

- [x] Final failure still stops automatic attempts at the configured limit.
- [x] A fresh element may start a later attempt as documented.
- [x] Later success releases earlier still-connected, still-observed same-Tag Subtrees without requiring `scan()`.
- [x] Excluded/detached roots are neither retained indefinitely nor reactivated.
- [x] Both fake-loader runtime checks and native-registration fixture pass.

This is a post-success recovery defect, not a request for extra retries and not proof that #54 introduced a regression.

## Comments

Implemented and reviewed on the restarted TDD workflow. Public revive() regressions, standard checks, and native registration checks pass. See ../WORKFLOW.md for evidence, compatibility assessment, known setup overhead and the separate candidate storefront verification requirement. Ready for human release review; nothing deployed.

## Separation verification — 2026-11-06

Gate competition has been separated and deferred in issue 02. Bug-fix-only verification passes: 320 standard tests, typecheck/lint/build, native recovery 5/5 and root-policy/transfer 3/3. Resource counts return to one active Gate policy per Tag. A small measured setup residual is documented in ../WORKFLOW.md and the matched sample artifact; no zero-regression or deployed-storefront claim is made.
