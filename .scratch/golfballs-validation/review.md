# Code review — 2026-11-06

Fixed point: 77856c7. Reviewed commits a9992ef, 3920db3, 50331f0,
3b2e860, 6267a69, 670055f and 72ffe94, plus the follow-up tooling fixes.
Standards and Spec ran in independent fresh-context reviewers. No runtime source
changed during this review.

## Standards

No actionable documented-rule breaches or material smell findings. Follow-up
review of provenance validation, prepared metadata and public CLI regression tests
also found no actionable issues.

## Spec

Two P2 findings, both resolved and re-reviewed:

1. Golfballs flow success collected but did not enforce runtime provenance. It now
   requires the exact local runtime URL/status/body hash, or the prepared bootstrap
   filename/hash. Missing or mismatched provenance fails the CLI. Local response
   body reads are awaited before asserting the result.
2. Measurement reports hardcoded baseline attribution and consulted current HEAD
   instead of build inputs. Build preparation now records resolved source commits,
   source snapshots, dirty flags and bootstrap hashes. Validation consumes that
   metadata and fails if prepared bootstrap bytes changed. An alternate 77856c7
   build was checked to verify it reports that reference rather than 50331f0.

Historical reports remain unchanged: they contain the expected local runtime URLs
and hashes, and used the documented default baseline. The defects could invalidate
future runs, not the evidence that the recorded historical runs loaded local code.

Parent review also hardened empty flow selections and invalid measurement counts;
they now fail before browser launch. Tests were added red → green through the
already agreed CLI/report seam. The changes add no runtime behavior or deployment.

## Verification and next assessment

340 tests passed; typecheck, lint and formatting passed. Five new CLI cases cover
positive/negative provenance, changed prepared bytes, empty route filters and zero
rounds. Actual local homepage menu/search/cart and production-mode overridden cart
checks pass with provenance assertions enabled. Isolated theme builds succeed and
prepared reference checks pass. Evidence is in evidence/review/.

The next candidate remains issue 02, same-Tag Gate competition. Its current local
Golfballs manifestation was rechecked; see
../runtime-gate-competition-revisit/assessment.md. Registration waits for FAQ
visibility even while another occurrence is eligible. This affects optional
accordion enhancement; native details/menu operation already works. The next step
is a separate cost-bounded design/prototype or a narrower theme loading-policy
change, not restoring the former 3,000-listener implementation.

Standards: 0 findings. Spec: 2 P2 findings resolved, 0 outstanding.
