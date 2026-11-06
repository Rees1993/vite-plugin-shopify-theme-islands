# Faster Activation runtime: research and recommendation

2026-11-06. Production reference: `77856c7bddfc29aa87b7bcadf089ea08122119cb`. Research only: no production source, package version, or theme deployment changed.

## Recommendation

Implement two small common-path fast paths, in independent reviewable slices:

1. Construct the debug observer only when diagnostics are enabled. Skip diagnostic-only Gate planning when there is no observer; keep RuntimeSurface present for runtime events and logs.
2. Skip root-policy ancestor lookup until the first explicit exclusion. A sticky `hasExclusions` flag starts false, becomes true before exclusion/cancellation, and remains true through reinclusion; after an exclusion the original nearest-policy walk remains authoritative.

The isolated combination is measurably faster than the current verified bug-fix-only implementation in the tested setup fixtures, while preserving existing correctness checks. It changes three source files, adds no dependency or persistent root index, and leaves ownership, retries, exhaustion recovery, Gate execution, and interaction event handling intact. Do not bundle synchronous parking, watcher storage changes, or a whole-session rewrite into the first implementation.

## Three independent designs

### 1. Root-owned deep Activation session

[Independent research](minimal-session.md) proposes three semantic operations: `scan(root)`, `setObserved(root, observed)`, and `disconnect()`. The current public revive verbs would map to those operations. DOM/root policy, traversal, membership, cancellation and settlement would sit behind the same seam. Gate and timer execution would remain private adapters.

Depth and locality improve because callers no longer coordinate discoveries, pending ancestors, cancellation registrations and Activation candidates. The prototype tested only the narrower cancellation seam: batch reconciliation over the session's existing membership instead of a second callback registry.

That experiment did not justify adoption. In the first rotating run at 4× CPU, 1,000-interaction setup changed 3.35 → 3.10 ms, but owner-removal handling changed 0.15 → 0.50 ms. Root snapshots move allocation to mutation time, and Tag-grouped cancellation changes cross-Tag cleanup order. The existing 320-test pass does not settle that compatibility question. Keep the wider interface as an architectural option; reject this prototype as the next speed change. [Evidence](evidence/first-summary.json), [raw samples](evidence/first-samples.csv), [experimental patch](patches/batch-cancellation.patch).

### 2. Explicit Tag transitions and guarded commands

[Independent research](transition-model.md) proposes a private transition seam: logical events produce guarded Gate/load/retry/disposal/event/cascade commands. Tokens identify the session, Tag generation and operation. Public revive remains unchanged.

This offers explicit legal transitions and strong settlement locality. It also introduces event/command objects, acknowledgements and effect interpretation. In particular, Custom Directive `load()` must preserve its current attempt-completion Promise behavior, and an unabortable import must retain its identity while membership changes. No speed improvement was measured for this design. Use its transition table and invariants for reasoning and future regression coverage; do not introduce a reducer framework for the present optimization.

### 3. Common-caller fast paths

[Independent research](common-path.md) keeps the current seam and avoids work most callers cannot use. The broader proposal includes synchronous parking and singleton watcher storage, but only diagnostic laziness and the no-exclusions flag were prototyped and validated here.

The current [diagnostic discovery path](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/activation-session.ts:87) constructs a GatePlan for every discovered occurrence even though the [observer](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/runtime-observability.ts:45) immediately returns when debug is disabled. Owner activation still needs its own current GatePlan; the prototype preserves that read. It does not cache policies, so changes to parked attributes can still be read on promotion.

The current [policy lookup](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/lifecycle.ts:31) ascends ancestors even before any root has been excluded. Includes alone cannot create an excluded element under the current default policy. The conservative flag avoids that unused walk; it is not a cache of individual elements' eligibility and does not need move-by-move invalidation. Connected/stopped checks remain in place.

This has the strongest practical leverage: less work without a new ordering protocol, callback ownership model, or root membership index. The optional observer also makes its diagnostic-only role explicit, consistent with [ADR-0001](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/docs/adr/0001-debug-controls-diagnostics-not-behaviour.md) and [ADR-0002](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/docs/adr/0002-runtime-observability-is-debug-only.md). [Combined patch](patches/combined-common-path.patch).

## Measured evidence

Each comparison used one native Chrome process, alternating variant order, five warm-up rounds and 40 samples per variant/scenario, with normal CPU and 4× CPU throttling. DOM creation and bundle parsing are outside setup timing. Mutation measurements include the DOM operation and two microtask checkpoints. These are repeated warm synthetic measurements, not storefront LCP, cold startup, real mobile-device timings, or field performance.

The first experiment compared current, lazy diagnostics and batch cancellation. The second isolated the two recommended fast paths and their combination. A third repeated the combined comparison with an unchanged-build control. In that confirmation, 1,000-interaction setup at 4× CPU measured 3.30 ms current, 3.30 ms unchanged control and 2.30 ms combined. The deep-DOM figures were 5.25, 5.20 and 3.45 ms respectively. This supports a real directional gain beyond the observed unchanged-build differences in those fixtures; it is not a formal field-performance guarantee.

Confirmation at 4× CPU, milliseconds:

| Scenario | Current median | Prototype median | Current P90 | Prototype P90 |
| --- | ---: | ---: | ---: | ---: |
| 1,000 interaction occurrences | 3.30 | 2.30 | 4.10 | 2.70 |
| 1,000 interaction occurrences, deep DOM | 5.25 | 3.45 | 5.70 | 3.90 |
| Deep scan after first exclusion | 5.60 | 4.80 | 6.20 | 5.30 |
| 1,000 visible occurrences | 3.45 | 2.40 | 4.40 | 3.00 |
| 100 distinct visible Tags | 1.10 | 1.00 | 1.60 | 1.60 |
| Remove the current owner | 0.35 | 0.05 | 0.80 | 0.40 |
| Remove 500 parked occurrences | 0.80 | 0.90 | 1.30 | 1.40 |
| Exclude parent; retain included child | 0.70 | 0.70 | 1.10 | 1.20 |
| Disconnect 1,000 occurrences | 0.90 | 0.75 | 1.30 | 1.00 |

No obvious mutation/teardown regression appeared for the combined fast paths in this confirmation. The small distinct-Tag differences are near the unchanged-control variation and should not be sold as a broad win. After the first exclusion the flag deliberately falls back to existing policy lookup; improvement in that scenario comes mainly from avoiding unused diagnostics. Individual samples, ranges, bundle hashes and CPU/browser metadata are retained:

- [First experiment](evidence/first-summary.json), [all samples](evidence/first-samples.csv).
- [Independent and combined fast paths](evidence/common-fastpaths-summary.json), [all samples](evidence/common-fastpaths-samples.csv).
- [Confirmation with unchanged-build control](evidence/confirmation-summary.json), [all samples](evidence/confirmation-samples.csv).

These comparisons assess alternatives to 77856c7. They do not isolate the historical 2.85 → 3.20 ms difference into exact components. The unused planning/policy work also existed before the correctness fixes; the speed result should not be misrepresented as proof that the callback registry caused the entire historical difference.

## Correctness validation and limits

The lazy-only, no-exclusions-only and combined variants each pass the current 320 tests and typecheck in isolated source trees. The combined variant also passes project lint (zero warnings/errors) and JavaScript/declaration build. It passes eight native registration/root-policy cases with debug off and the same eight with debug on: **16/16 native checks for the prototype**. The reference passes the same 16. Reapplying the saved combined patch to a clean source archive reproduces the native pass. [Native evidence](evidence/native-validation.json), [clean-patch reproduction](evidence/reproduced-native-validation.json), [test summary](evidence/combined-tests.txt).

Passing the current suite is prototype evidence, not permission to merge an unreviewed implementation or deploy a theme. Production src/ remains unchanged. Current first-observed Gate ownership remains intact.

The independent transition reviewer identified additional cases before considering a cancellation/state-machine rewrite: remove/reinsert before one observer delivery; remove owner and parked roots in one batch; cleanup reenters observe/scan/disconnect; cross-Tag cleanup changes later eligibility; error handlers replace work during retry backoff; an in-flight import rejects after replacement joins; load-event handlers interrupt a multi-root cascade; Custom Directive load promises retain their current completion contract. These are validation gaps/risk scenarios, not claimed reproduced defects.

Mutation delivery is queued, while abort cleanup can synchronously reenter runtime controls, so callback ordering is a material constraint. The platform basis is the [WHATWG DOM mutation observer algorithm](https://dom.spec.whatwg.org/#mutation-observers) and [abort steps](https://dom.spec.whatwg.org/#abortsignal-run-abort-steps). This is why fewer per-element allocations alone do not prove a safer or faster cancellation implementation.

## Reproduction

From the repository, this benchmarks the saved patch against the pinned current reference in temporary directories:

```sh
PROTOTYPE_PATCH=.scratch/runtime-activation-reliability/research/patches/combined-common-path.patch \
RESEARCH_ARTIFACT_ROOT=/tmp/islands-common-path-repro \
node .scratch/runtime-activation-reliability/research/compare-prototypes.mjs
```

For native correctness checks with debug off/on, add `NATIVE_ONLY=true`. The runner extracts only src/ from git into temporary folders, applies the patch there, uses the already installed Golfballs Puppeteer/Chrome tooling, writes numeric/local fixture evidence, and removes temporary builds. It does not modify production src/ or the storefront. `PROTOTYPES` can alternatively supply labeled isolated source roots; no extra benchmark dependencies were installed.

## Next implementation

Implement optional diagnostics first, then the no-exclusions fast path, using the agreed public revive/native-browser seams and the existing implementation/TDD/review workflow. Retain only measured changes. Keep the callback registry, retry scheduler, Gate owner/canOwn rules and cleanup ordering unchanged. Re-run the paired benchmarks after the production implementation and identify a candidate preview before any storefront speed claim. Leave synchronous parking, singleton watcher storage, full root-session consolidation and transition machinery as separately measured options.
