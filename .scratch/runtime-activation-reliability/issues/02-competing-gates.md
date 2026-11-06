Status: needs-triage
Category: enhancement

# Deferred: allow any eligible same-Tag occurrence to open shared Activation

## Evidence

The opt-in regression pack reproduces a visibility-waiting first occurrence blocking an immediate sibling. Live Golfballs homepage checks confirmed the matching mobile accordion Gate waits until the footer enters view. The menu's native HTML still opens; JavaScript enhancement is delayed.

## Acceptance

- [ ] The first occurrence whose complete per-element Gate policy succeeds may trigger the shared Tag load.
- [ ] Reversing sibling DOM order does not block an otherwise eligible occurrence.
- [ ] Partial Gates from different occurrences never combine.
- [ ] Built-in sequential ordering and Custom Directive AND semantics are preserved.
- [ ] Simultaneous winners coalesce to one in-flight loader.
- [ ] An active attempt's retry budget is not bypassed by another occurrence's callback.
- [ ] Losing pending work is cleaned up exactly once when no longer needed.
- [ ] Pending ancestors still hold descendants until successful parent loading.
- [ ] Benchmark observer/listener counts for repeated Tags before/after; assess added work proportional to occurrence count.
- [ ] Document earlier Activation timing and assess release compatibility separately from the cancellation bug fix.

## Dependencies

Shared settlement work in issue 01. Keep this behavioral feature separately reviewable so it does not hide a regression in a bug fix.

## Comments

Implemented and reviewed on the restarted TDD workflow. Public revive() regressions, standard checks, and native registration checks pass. See ../WORKFLOW.md for evidence, compatibility assessment, known setup overhead and the separate candidate storefront verification requirement. Ready for human release review; nothing deployed.

## Decision — 2026-11-06

User requested separating this enhancement from the three correctness fixes. Do not ship competition as part of the bug-fix-only change. First verify cancellation transfer, successful recovery and nested-root correctness with first-occurrence Gate ownership preserved. Ideation resumes after that verification, as a separate piece of work.

The first implementation evaluated every same-Tag occurrence and introduced measured setup overhead. Historical 30-sample alternating comparison: 1,000 interaction-gated occurrences, median 0.9 → 2.2 ms at normal CPU; 3.35 → 8.5 ms at 4× CPU throttling. It installed 3,000 interaction listeners versus 3 in the baseline. These are synthetic setup measurements, not deployed Golfballs page timings. See ../evidence/competition-cost-investigation.json.

Future acceptance adds:

- [ ] Keep this enhancement independently reviewable from the bug fixes.
- [ ] Establish a verified bug-fix-only reference before evaluating designs.
- [ ] Demonstrate complete per-occurrence policies without a setup slowdown against that reference under matched repeated measurements.
- [ ] Verify observer/listener lifecycle, event semantics, cancellation, retry budgets and parent ordering.
- [ ] Verify shopper-visible benefit and performance in an identified candidate theme preview before release claims.

The opt-in checks/deferred-gate-competition.check.ts preserves the feature-specific behavior tests. They are intentionally excluded from the standard bug-fix acceptance suite. The earlier completed checklist/comment describes historical commit 64e98c1 and is superseded by this deferral.
