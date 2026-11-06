Status: ready-for-human
Category: bug

# Apply Observed root inclusion consistently to Gate Teardown

## Evidence

The opt-in regression pack observes a parent root and explicitly includes a child root, then unobserves the parent. The child's pending defer Gate is cancelled even though nearest-root inclusion still considers it observed. Loader calls remain zero.

## Acceptance

- [x] Explicit child inclusion governs membership and cancellation consistently when the parent is excluded.
- [x] Excluded siblings' Gate work is cancelled.
- [x] Moved Island elements are evaluated against current membership, not stale snapshots alone.
- [x] Overlapping roots and shared Tags preserve retained work correctly.
- [x] Full disconnect cancels all pending work regardless of nested inclusion.
- [x] Runtime control verbs and Lifecycle bridge remain unchanged.

Do not bundle debug observability with runtime surface; preserve ADR-0002.

## Comments

Implemented and reviewed on the restarted TDD workflow. Public revive() regressions, standard checks, and native registration checks pass. See ../WORKFLOW.md for evidence, compatibility assessment, known setup overhead and the separate candidate storefront verification requirement. Ready for human release review; nothing deployed.

## Separation verification — 2026-11-06

Gate competition has been separated and deferred in issue 02. Bug-fix-only verification passes: 320 standard tests, typecheck/lint/build, native recovery 5/5 and root-policy/transfer 3/3. Resource counts return to one active Gate policy per Tag. A small measured setup residual is documented in ../WORKFLOW.md and the matched sample artifact; no zero-regression or deployed-storefront claim is made.
