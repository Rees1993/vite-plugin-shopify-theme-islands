# Common-caller-first design: synchronous parking, exceptional ownership

Research only, 2026-11-06. Reference: bug-fix-only HEAD `77856c7`. No production source changed and no benchmark run by this research task. Allocation counts below are source-level predictions, not heap measurements or speed claims.

## Recommendation

Keep the present Activation session and its state machine. Make the overwhelmingly frequent operation—retain another same-Tag root while one occurrence owns Gates—a synchronous registration operation. Pay for Gate planning, async execution and multi-subscriber cancellation only when they are actually required. This is an alternative to replacing the whole session: it changes the work done at the existing seams, with independently reversible steps.

First measure two isolated changes: move debug discovery planning behind the debug observer; split synchronous registration from owner-only asynchronous activation. Then evaluate singleton watcher storage and a no-exclusions fast path independently. Do not introduce a persistent root membership index, a new queue, or a generic effect interpreter to recover roughly a fraction of a millisecond before attribution is established.

The parent investigation reports matched 1,000 interaction occurrences at 4× CPU of original 2.85 ms versus bug-fix-only 3.2 ms. This is context supplied to this research task, not independently reproduced evidence. Root callbacks are a hypothesis, not demonstrated attribution. Unconditional diagnostic planning also exists in the original architecture; removing it can improve the total path without explaining the regression.

## What the code actually pays for

Discovery happens before ancestor blocking, deliberately allowing conflict diagnostics to see descendants whose Activation is held by a pending parent: [lifecycle.ts:61](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/lifecycle.ts:61). Every discovery calls `planGates()`, even with debug false: [activation-session.ts:87](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/activation-session.ts:87). Only afterward does the observer return immediately for debug false: [runtime-observability.ts:44](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/runtime-observability.ts:44).

Planning is substantial: one gates array, three plan arrays, one plan object, per-Gate objects, conflict formatting via map/filter/join, plus interaction events and invalid-token arrays. Even absent idle/defer attributes, strict integer parsing returns two small objects: [directive-spine.ts:52](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/directive-spine.ts:52), [directive-spine.ts:100](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/directive-spine.ts:100), [directive-spine.ts:192](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/directive-spine.ts:192), [directive-spine.ts:215](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/directive-spine.ts:215). The owner plans again at [activation-session.ts:196](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/activation-session.ts:196).

For every eligible repeated occurrence, the caller constructs a candidate object: [runtime-ownership.ts:45](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/runtime-ownership.ts:45). `activate()` is async, including its parked early-return path. Before parking, it constructs a PendingElement object, a fresh no-op `unwatch` function, a capturing cancellation callback, and the watcher disposer: [activation-session.ts:92](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/activation-session.ts:92). The watcher also allocates a Set for the first subscriber: [cancellable-watchers.ts:27](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/cancellable-watchers.ts:27). There is just one production registration site for `watchCancellable`, although its interface deliberately supports more than one callback per element.

Parked occurrences already avoid AbortControllers, `isActive`/`run`/`attempt` closures and waiters because those are created after the parked return at line 124. Do not claim savings for moving those allocations: the current code already has that fast path. Only the owner has Gate resources.

Membership currently climbs ancestors repeatedly: filtering, activation eligibility and session registration all query it, while ancestor pending checks do another ascent: [lifecycle.ts:31](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/lifecycle.ts:31), [lifecycle.ts:46](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/lifecycle.ts:46), [lifecycle.ts:56](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/lifecycle.ts:56). Every mutation delivery scans cancellable elements before additions: [lifecycle.ts:88](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/lifecycle.ts:88).

## Concrete interface and hidden implementation

The internal session interface can become:

```ts
interface ActivationSession {
  discover(tag: string, element: HTMLElement): void;
  activate(tag: string, element: HTMLElement, loader: IslandLoader): void;
  isPending(tag: string): boolean;
  clear(): void;
}
```

The lifecycle adapter's activation callback becomes `session.activate(tag, element, loader)`. It no longer needs to build a throwaway candidate or discard a Promise. The implementation of `activate` synchronously validates membership, finds/creates Tag state, registers the root, and returns for parked roots. If it elects the first owner, it invokes a private async `activateOwner(tag, element, loader, current, work)`. That helper owns the existing Gate, retry and settlement path. It remains private; callers do not learn phases, controllers, retry numbers or promotion rules.

This is an internal interface change; consumer `revive()/observe()/unobserve()/scan()/disconnect()` remain unchanged. The current production caller already discards the Promise. Preserve rejection handling: all reachable Gate/loader errors must still take the existing reporting path, and unexpected rejected owner work needs an explicit treatment rather than silently creating an unhandled rejection. Do not add a broad catch that converts programmer errors into ordinary loader failures. Inspect the existing activation helper's error handling before extracting.

The `discover` implementation should delegate to a debug observer which owns the diagnostic read dependency:

```ts
const observability = createRuntimeObservability({ debug, spine, isObserved, console });
// Internally:
discover: debug ? inspectCurrentGates : ignoreDiscovery
```

`inspectCurrentGates` can use `spine.describe(element)` to obtain just the canonical conflict signature; the owner still uses `planGates()` for warnings, custom Gates and initial wait messages. The debug observer retains its maps and conflict-warning rules. Runtime surface stays separate, per [ADR-0002](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/docs/adr/0002-runtime-observability-is-debug-only.md). No debug-dependent change to ownership, Gate order, events or retries is allowed, per [ADR-0001](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/docs/adr/0001-debug-controls-diagnostics-not-behaviour.md).

This dependency is a read-only internal seam with existing concrete production and test spine adapters, not a new configurable public port. Alternatively wire optional `onDiscover` only in debug at runtime composition; that has less observer interface churn but puts the diagnostic branching into composition. Prefer observer-owned discovery for locality. Do not pass `() => spine.planGates(element)` per occurrence: that replaces avoidable work with an avoidable closure. Do not cache a plan across scans or the parked lifetime: attributes can change before cancellation transfer. A promoted owner must read current attributes, as it does today.

## Cancellation without singleton Sets

Keep the current watcher interface; change its private value to `(() => void) | Set<() => void>`. Store the first callback directly, promote to a Set on a second distinct subscription, and retain Set identity after promotion. This avoids adding a new port purely for one implementation.

Unwatch must inspect current map contents, as today. Cancellation must delete the element's entry before invoking callbacks, as today. Never delete an entry after invoking callbacks: cleanup may reentrantly install a new registration for the same element. Preserve Set deduplication, disposal ordering, idempotence and cancel-during-cancel behavior. For multiple callbacks, consider whether snapshotting is necessary only after observing the current semantics and tests; do not accidentally change behavior by using a live Set differently. Existing map iteration also permits a callback to add new work: termination under cleanup reentrancy must be verified, especially `cancelAll` during disconnect.

Share a module-level no-op disposer rather than creating a new no-op per PendingElement. A more radical token registration interface could eliminate both per-element callback/disposer closures by storing `{ element, state, work }` and using one session callback. Reject it for the first implementation: it couples lifecycle cancellation to activation records or introduces a generic context mechanism. Measure the simpler changes first. Retaining a real watcher per parked root is justified: recovery roots need prompt detachment cleanup even when they own no Gates.

## Membership indexes and mutation fast paths

Prefer a sticky `hasExclusions` boolean, initially false, set true on the first `excludeRoot`, reset with the policy map on disconnect. `isExcluded` returns false before walking ancestors when it is false. Includes alone cannot exclude an element; once an exclusion has occurred, always use the current nearest-policy ascent. Do not attempt to decrement the boolean using WeakMap contents. A pessimistic true value after reinclusion is safe and simply loses the fast path. Keep `stopped` and `isConnected` checks outside this optimization.

Do not cache nearest roots per element across mutation deliveries. A move, reparent, include or exclude can change the nearest policy while connectivity stays true. An epoch cache still needs mutation invalidation and may be stale during synchronous custom cleanup before the observer runs. An iterable root index also changes retention from the present WeakMap. The simple boolean improves default setup without introducing those invalidation facts into the interface.

Likewise, defer removed-subtree indexes and pure-addition cancellation shortcuts. A watched occurrence can move into an excluded subtree, and cancellation callbacks can change the DOM reentrantly. `MutationRecord.addedNodes` alone is insufficient evidence that existing registrations remain valid under all current control verbs and supported scan roots. A delivery-local cache is possible, but only useful if measured ancestor ascents dominate; it requires explicit invalidation on include/exclude and after user callbacks. These are mutation-heavy complexity costs for an unproven setup attribution.

For owner liveness and promotion, replace `[...keys()].some/find` with short-circuit Map iteration only as a tiny local follow-up. These allocations happen on owner events, not each parked setup. Success still needs snapshots before clearing state and running user cleanup; deleting those snapshots is not a valid common-path optimization.

## Predicted counts for 1,000 one-Tag pending interaction occurrences

These count source constructions in one initial walk, with debug false and no registration completion. Engines may optimize some allocations away.

| Construction | Current source | Proposed staged result |
| --- | ---: | ---: |
| Full Gate plans | 1,001 | 1 |
| Candidate objects | 1,000 | 0 with positional interface |
| Calls to async session entry / result Promises | 1,000 | owner only; exact helper Promise count depends extraction |
| PendingElement records | 1,000 | 1,000 |
| Per-element watcher Sets | 1,000 | 0 when each element has one subscriber |
| PendingElement initial no-op functions | 1,000 | 1 shared function per module |
| Capturing cancellation callbacks | 1,000 | 1,000 |
| Watcher disposer closures | 1,000 | 1,000 |
| AbortControllers / active Gate policies | 1 / 1 | 1 / 1 |
| Default interaction listeners | 3 | 3 |

The first plan row implies eliminating the associated parsing arrays/objects for 1,000 diagnostic-only plans; it does not mean removing the only owner's diagnostic facts or invalid-directive warnings. With debug true, discovery remains per occurrence and the owner is still planned separately; conflict detection presently scans prior same-Tag diagnostic records and can be quadratic. Optimize that debug-only algorithm separately if warranted, while preserving stale-element pruning and warning reset behavior.

## Depth, locality and tradeoffs

Depth improves because callers stop participating in asynchronous parking and candidate assembly; the session still hides the actual difficult behavior: first-owner election, cancellation transfer, one in-flight import, attempt identity, budget exhaustion, retained recovery roots and success cascade. This does not claim depth merely from moving lines into a helper. The deletion test still holds: removing the session would force all this coordination into lifecycle callers.

Locality improves for diagnostic costs (owned by the debug observer) and watcher storage (hidden behind its existing interface). Leverage is concentrated in every lifecycle discovery and every parked root. In-process Map state needs no adapter. Real DOM, MutationObserver, timers, waiter and loader dependencies continue through their existing production/test adapters; public revive tests remain the important seam. No synthetic production abstraction should be introduced just to mock Map behavior.

Startup should construct fewer objects and perform fewer attribute reads; it may still be dominated by DOM walking and parent pending checks. Mutation delivery remains O(number of retained roots) for cancellation and walks all additions; this proposal does not promise mutation scaling improvements. Teardown retains per-root callbacks and snapshots because cleanup ordering and recovery root retention are correctness requirements. Singleton watcher storage adds a branch to registration/disposal/cancellation; many-subscriber workloads may become neutral or slower. Sticky exclusion optimization degrades back to current ancestor walking once a page uses exclusions. These costs are bounded and independently measurable.

## Invariants and validation/falsification plan

The acceptance contract is [PRD](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/.scratch/runtime-activation-reliability/PRD.md), [issue 01](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/.scratch/runtime-activation-reliability/issues/01-tag-cancellation-and-settlement.md), [issue 03](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/.scratch/runtime-activation-reliability/issues/03-cascade-recovery.md) and [issue 04](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/.scratch/runtime-activation-reliability/issues/04-observed-root-teardown.md). Preserve current phase/identity guards and the `canOwn=false` exhaustion marker. Reusing an existing parked element cannot grant a free attempt. Fresh discovery may start a later attempt; only later success cascades all retained, still-observed roots. During loading, owner detachment does not permit a second loader while another root remains observed.

1. Prepare isolated temporary candidates for diagnostic-only, sync-entry-only, singleton-watcher-only, exclusion-boolean-only, then combined. Do not concurrently run browsers. Record full baseline SHA, source diff and built bundle hash.
2. Use [compare-runtime-setup.mjs:12](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/.scratch/runtime-activation-reliability/scripts/compare-runtime-setup.mjs:12) with `BASELINE_REF=77856c7` (resolve full SHA) and a fresh `RUNTIME_ARTIFACT_ROOT`. Its candidate path is hardcoded to the repository at line 19; for /tmp source candidates copy the harness and explicitly change candidate/repo paths. Never inadvertently compare against af71a36's default when testing marginal improvements over the bug fix.
3. Retain rotating order, five warmups, 30 samples, same browser, 1×/4× CPU, 100/1,000 interaction and 1,000 visible. Repeat an independent batch with reversed initial order. Report medians, p90 and all samples; 0.1 ms timing granularity and GC make isolated small differences uncertain. No speed claim if the effect changes sign or is dominated by batch/order noise.
4. Run structural instrumentation separately from timing: plan calls, owner elections, watcher singleton/Set promotions, listener additions/removals, cancellation invocation counts, then teardown retained registrations. Instrumentation itself can alter timings. A failing predicted count falsifies the static cost account even if wall-clock time improves.
5. Run the existing 320 tests, typecheck/lint/build and eight native checks. Do not add mirrored tests asserting private helper arrangement. Add meaningful public regressions only for a newly exposed risk: attribute changes before promotion; observe/unobserve during cleanup; cleanup that rescans the same Tag; successful load whose cleanup disconnects; multiple watcher subscribers with reentrant replacement; nested included roots preserved after parent exclusion; moving a parked root between policies; exhausted parked occurrences unable to restart; fresh occurrence success recovering earlier roots; stale completion unable to settle a replacement attempt. Verify debug true/false produce identical loader/event/cleanup outcomes while expected diagnostics differ.
6. Extend the separate cost fixture with deep DOM/no policies, deep DOM/one exclusion, many distinct Tags, mutation-only additions, moving roots into exclusions and teardown timing. Reject a favorable repeated-Tag setup result that materially worsens ordinary distinct-Tag activation or cleanup correctness. Heap allocation measurements are optional evidence; static construction reductions alone do not prove reduced live memory or elapsed time.


## Isolated prototype handed to the parent

At the parent's request, prepared `/tmp/islands-common-path-lazy-discovery-CcEycs`, copied from full reference `77856c7bddfc29aa87b7bcadf089ea08122119cb`. It contains source/tests, package.json and tsconfig.json. `activation-session.diff` and `runtime.diff` describe its only experiment. No checks or benchmarks were run by this research task.

For maximum isolation, this prototype uses the smaller alternative: make the existing diagnostic observer dependency optional, construct it only when `opts.debug` is true, skip `discover` before planning when absent, and optional-chain diagnostic notifications/clears. RuntimeSurface remains present. It does not implement observer-owned reads, `describe()` substitution, synchronous parking, watcher changes or root-policy changes. Therefore debug=true takes exactly the original diagnostic path. This is a cleaner first measurement than simultaneously changing diagnostic content and ownership; the optional dependency expresses absence of diagnostics directly without a second behavior flag in the session. If retained, it is also a reasonable final design—moving reads into the observer should earn its additional interface churn through improved locality, rather than be required for this cost reduction.

Additional isolated source candidates prepared at the parent's request:

- `/tmp/islands-common-path-no-exclusions-eaxbmK`: archived directly from the full reference; only `src/lifecycle.ts` differs. `lifecycle.diff` records four additions: initialize sticky flag, early return, mark flag before exclusion/cancellation, reset it alongside WeakMap reset after full cancellation.
- `/tmp/islands-common-path-lazy-and-no-exclusions-VQXfuI`: previous lazy-diagnostics candidate plus that exact lifecycle change. Three diff files describe the combination.

Both retain connected/stopped checks, WeakMap policies and nearest-root ascent once any exclusion has occurred. Neither clears the sticky flag on include. No tests or benchmarks run by this research task; the parent owns empirical validation and its reported results.

## Parent empirical validation

The parent verified the lazy-only, no-exclusions-only and combined temporary variants: each passed the existing 320 tests and typecheck. The combined variant also passed project lint, JavaScript/declaration build, and 16 native checks (eight cases with debug off, repeated with debug on). Saved patches reproduce the combined native pass from a clean source archive. Production source was not modified.

Two rotating comparisons favored the combined diagnostics/no-exclusions subset; the second included an unchanged-build control. At 4× CPU, 1,000-interaction setup medians were 3.30 ms current, 3.30 ms same-build control, 2.30 ms combined; deep setup 5.25, 5.20 and 3.45 ms; visibility setup 3.45, 3.30 and 2.40 ms. Full startup/mutation/teardown summaries and sample CSVs are in [evidence](evidence/confirmation-summary.json). These are repeated warm synthetic results, not storefront speed or cold-start guarantees.

The recommended first implementation is therefore the measured optional diagnostic observer plus sticky no-exclusion fast path. Synchronous parking, singleton watcher storage and richer interfaces remain unmeasured alternatives and should not be bundled into that change. See [parent recommendation](RECOMMENDATION.md) for the decision and reproducibility commands.
