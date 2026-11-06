Status: ready-for-human
Category: bug

# Release stranded Tag work when an Island element is removed

## Evidence

`checks/runtime-regressions.check.ts` reproduces zero loader calls for an immediate same-Tag replacement after a visibility-waiting Island element is removed. An explicit `scan()` does not recover it. The different-Tag control passes.

`handleDirectiveError` returns on built-in cancellation without releasing the queued Tag; later occurrences remain parked without a completing attempt.

## Acceptance

- [x] Same-Tag replacement activates without a page reload or manual state reset.
- [x] Another still-observed occurrence is not stranded when the initiating occurrence leaves.
- [x] No overlapping loaders or duplicate success/error events for a shared Tag attempt.
- [x] Cancellation is not reported as a module-load failure.
- [x] Existing retry limits and child cascade remain intact.
- [x] Late completion after disconnect/unobserve cannot revive excluded work.
- [x] A stale cancellation, rejection, or success from an earlier attempt cannot evict or settle a newer attempt for the same Tag.
- [x] Meaningful regression tests live in the standard runtime suites after implementation.

## Scope

Concentrate shared Tag settlement policy behind the Activation session's implementation. Do not solve this solely by blindly evicting every cancellation: that can erase waiting Subtrees or interfere with a shared in-flight attempt.

See `../PRD.md` for shared invariants and validation.

## Comments

Implemented and reviewed on the restarted TDD workflow. Public revive() regressions, standard checks, and native registration checks pass. See ../WORKFLOW.md for evidence, compatibility assessment, known setup overhead and the separate candidate storefront verification requirement. Ready for human release review; nothing deployed.

## Verification — 2026-11-06

Historical correctness verification passes: 320 standard tests, typecheck/lint/build, native recovery 5/5 and root-policy/transfer 3/3. Resource counts return to one active Gate policy per Tag. A small measured setup residual is documented in ../WORKFLOW.md and the matched sample artifact; no zero-regression or deployed-storefront claim is made.
