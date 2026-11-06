# Quality gates and prototype review — 2026-11-06

Baseline: 77856c7. Main implementation: a9992ef (approved glossary/workflow
migration and durable research), 3920db3 (quality gates). Isolated prototype:
edbfac0 on codex/prototype-common-path-performance. Main runtime source unchanged.

## Verification

- Public CLI regression tests written red → green, one behavior at a time: bad
  scanner exit, malformed/empty/schema-invalid/version-incomplete scanner reports;
  valid clean/stale reports; failed/incomplete functional cases; resource budgets,
  cleanup leaks and browser errors. 13 new tests.
- Real pinned Intent scanner completed with a valid clean report; no workflow or
  PR creation was invoked.
- Main full suite: 333 passed; typecheck, lint, formatting and build passed.
- Main and prototype: each 8 functional cases and 25 resource samples passed in
  native Chrome. Historical af71a36 fails fresh-registration recovery and exits 1,
  preserving its report: the command detects a real regression.
- Prototype full suite: 320 tests and typecheck. Diagnostics-on/off native
  reproduction repeated for both baseline and prototype.
- A fresh paired timing run supports the earlier directional gain. At 4× CPU:
  interaction-1000 median 3.65 → 2.40 ms; nested interaction 5.60 → 3.60;
  visible-1000 3.45 → 2.80. Parent exclusion 0.60 → 0.70 ms is a small noisy
  difference; P90 improves 1.00 → 0.90. No universal performance claim follows.
  Raw samples, browser metadata and bundle hashes are in evidence/prototype-benchmark.json.
- Local Chrome was used. Hosted Ubuntu CI was configured, not remotely executed.
  No live Shopify storefront performance claim or deployment validation.

## Independent review

Standards: no blocking documented-standard or heuristic findings in main or
prototype. ADRs 0001/0002 remain satisfied. Optional hardening: compare Intent's
reported skill inventory/uniqueness against shipped skill files; present validation
checks the expected project and nonempty typed results, not complete inventory.

Spec: prototype had no findings. Main had one P2: the historical research-native
runner could accept incomplete results. Replaced its verdict loop with the same
strict report validator and browser-error collection used by the canonical runner.

## Other retro suggestions

1. Add a reviewer judgement standard for scope and performance acceptance in a
   future focused docs change. Existing CONTRIBUTING already requires one concern
   per PR; repeating it in AGENTS would not fix enforcement. A useful addition is
   to ask whether the behavior/performance trade-off was accepted and whether
   measurement supports the stated user impact. Keep competition separate.
2. Native/resource checks and fail-closed skills workflow are implemented. Avoid
   adding noisy timing thresholds to CI; timing comparisons belong in experiments.
3. A single local verify alias is optional convenience: check/test/lint/build
   already exist and CI invokes them. Native tooling now has one supported command
   and the historical runner delegates to it. Further orchestration offers less
   value than making the checks reliable, now done.
4. Research, raw measurements and source patches are now committed. The prototype
   has its own reproducible commit. The glossary migration and new spec convention
   are committed separately. Future skill updates should be checked against local
   workflow/docs; this package's Intent workflow does not manage global skills.
5. Defer batch cancellation and transition-framework rewrites. Neither offers
   evidence comparable to the two common-path fast paths; the batching prototype
   changes cleanup ordering and measured slower owner-removal handling.

Recommendation: implement the two fast paths next through the agreed TDD workflow,
in separately reviewable slices. This review does not merge the prototype.
