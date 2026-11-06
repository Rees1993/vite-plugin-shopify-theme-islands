# Common-path runtime performance

Reference: 50331f0. Implement the reviewed two fast paths in separate commits:
optional debug-only observer/discovery planning, then a sticky no-exclusions
policy fast path. Preserve activation, first-owner Gates, retries, public events,
root include/exclude precedence and debug diagnostics. No competition rewrite.

Use the agreed public revive/DOM seam and native fixture reports. Deterministic
DOM-operation budgets cover avoidable diagnostic attribute reads on parked
occurrences and ancestor reads on unrelated descendants before any exclusion.
These are performance regression tests, not timing thresholds or internal mocks.
Existing behavior tests and real Chromium fixtures cover correctness, diagnostics
on/off and resources. Repeat paired timings against 50331f0; report limitations.
Run targeted tests and typecheck per slice, full suite at end, independent
Standards/Spec review, then commit to current branch. No theme deployment.
