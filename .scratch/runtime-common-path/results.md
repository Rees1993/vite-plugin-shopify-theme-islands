# Implemented common-path fast paths

Baseline: 50331f0 (runtime identical to 77856c7).
Commits: 3b2e860 optional diagnostic observer; 6267a69 no-exclusions fast path.
No Shopify theme deployment or package release.

## TDD

Public revive/DOM resource seam, approved earlier in this session:

1. Parked Island diagnostic attribute reads: test failed with 5 reads against
   baseline, passed with 0 after the optional observer change. The same test
   confirms the pending owner still waits and loads once after visibility.
2. Unrelated descendant policy ancestor reads before exclusion: test failed with
   1 read, passed with 0 after the sticky flag. It also verifies ancestor lookup
   resumes after unobserve. Existing nearest-policy, reinclusion, cleanup and
   reentrant behavior tests remain unchanged.

No internal collaborator was mocked; DOM instrumentation measures deterministic
work budgets. Wall-clock measurements are informational.

## Verification

335 tests passed; typecheck, lint, formatting and build passed. Real Chrome:
8 functional cases and 25 resource samples passed. Baseline and implementation
each also pass 8 functional cases with debug off and the same 8 with debug on.
Reports include runtime hashes and browser metadata in evidence/.

## Standards

Fresh-context review: no actionable Standards findings. Optional diagnostics
follow ADR-0002, and unconditional activation planning preserves ADR-0001.
DOM resource budgets use the approved public boundary. No material code smells.

## Spec

Fresh-context review: no findings. Both slices match the recommendation; owner
Gate planning, first-owner policy, retries/exhaustion, events and cleanup ordering
remain unchanged. Exclusion is marked before cancellation and the original
nearest-policy walk remains authoritative afterward.

Standards: 0 findings. Spec: 0 findings.

## Timing

Paired native Chromium setup benchmark at normal and 4× CPU, rotating order,
5 warm-up rounds and 40 samples per variant/scenario. DOM creation and bundle
parsing are outside measured setup. These repeated warm synthetic timings do not
establish cold storefront LCP or actual device performance. The final confirmation
runs after unit/native verification has finished; the first run overlapped some
verification and is retained for transparency.

4× CPU confirmation, milliseconds:

| Scenario | Baseline median | Implemented median | Baseline P90 | Implemented P90 |
| --- | ---: | ---: | ---: | ---: |
| setup-interaction-1000 | 3.30 | 2.20 | 3.70 | 2.50 |
| setup-nested-interaction-1000 | 5.05 | 3.30 | 5.60 | 3.70 |
| scan-nested-after-exclusion-1000 | 5.80 | 4.90 | 6.20 | 5.40 |
| setup-visible-1000 | 3.10 | 2.30 | 3.60 | 2.60 |
| setup-visible-unique-100 | 1.30 | 1.05 | 1.70 | 1.40 |
| owner-removal-1000 | 0.25 | 0.10 | 0.80 | 0.60 |
| parked-removal-1000 | 0.90 | 0.85 | 1.30 | 1.10 |
| exclude-parent-1000 | 0.70 | 0.50 | 1.00 | 1.00 |
| disconnect-1000 | 1.10 | 0.90 | 1.60 | 1.30 |
