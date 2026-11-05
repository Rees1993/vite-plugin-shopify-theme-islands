Status: ready-for-human
Category: enhancement

# Allow any eligible same-Tag occurrence to open shared Activation

## Evidence

The opt-in regression pack reproduces a visibility-waiting first occurrence blocking an immediate sibling. Live Golfballs homepage checks confirmed the matching mobile accordion Gate waits until the footer enters view. The menu's native HTML still opens; JavaScript enhancement is delayed.

## Acceptance

- [x] The first occurrence whose complete per-element Gate policy succeeds may trigger the shared Tag load.
- [x] Reversing sibling DOM order does not block an otherwise eligible occurrence.
- [x] Partial Gates from different occurrences never combine.
- [x] Built-in sequential ordering and Custom Directive AND semantics are preserved.
- [x] Simultaneous winners coalesce to one in-flight loader.
- [x] An active attempt's retry budget is not bypassed by another occurrence's callback.
- [x] Losing pending work is cleaned up exactly once when no longer needed.
- [x] Pending ancestors still hold descendants until successful parent loading.
- [x] Benchmark observer/listener counts for repeated Tags before/after; assess added work proportional to occurrence count.
- [x] Document earlier Activation timing and assess release compatibility separately from the cancellation bug fix.

## Dependencies

Shared settlement work in issue 01. Keep this behavioral feature separately reviewable so it does not hide a regression in a bug fix.

## Comments

Implemented and reviewed on the restarted TDD workflow. Public revive() regressions, standard checks, and native registration checks pass. See ../WORKFLOW.md for evidence, compatibility assessment, known setup overhead and the separate candidate storefront verification requirement. Ready for human release review; nothing deployed.
