# Minimal Activation session: three operations over roots

Research only, pinned to `77856c7` on 2026-11-06. No production changes or benchmarks were performed. An isolated source prototype passed the existing suite and static checks; its limitations are recorded below. This is an implementation experiment, not a speed result.

## Recommendation

Put DOM membership, root policy, traversal, Tag ownership and cancellation inside one deep Activation session. Give its caller three operations: `scan`, `setObserved`, and `disconnect`. Remove the per-Island-element cancellation callback registry; reconcile the session's existing Tag membership directly once per delivered mutation batch or synchronous root-policy change. Keep Gate execution and retry scheduling as private implementation modules initially.

This is materially different from renaming or flattening today's coordinators: the caller never submits Activation candidates, asks whether a Tag is pending, wires discovery callbacks, or registers cancellation callbacks. It submits root intent. The module owns the whole decision from root policy through parent-before-child Activation and late settlement. Its deletion would force all those ordering rules back into the caller, which passes the deep-module deletion test.

The strongest practical first step is narrower than the final shape: move cancellation into the session using its existing membership Map, replacing `watchCancellable` with one private invalidation call per batch. Then internalize root policy/walk if the interface becomes simpler in practice. This staged implementation preserves useful existing logic and should be faster to review than rewriting Gate execution or introducing a general event reducer. Both implementation-time and runtime improvements remain hypotheses.

## Existing evidence and seams

- The session already stores every pending or exhausted recovery occurrence, then separately allocates a cancellation callback and disposer for each: [activation-session.ts:53](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/activation-session.ts:53), [activation-session.ts:101](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/activation-session.ts:101).
- That registry adds a second Map, a Set per watched element, and a callback/disposer pair: [cancellable-watchers.ts:23](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/cancellable-watchers.ts:23). Parked occurrences allocate no Gate controller, but still allocate this ownership tracking.
- Mutation delivery already performs one cancellation sweep before additions. Batch invalidation does not invent a new scheduling opportunity: [lifecycle.ts:80](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/lifecycle.ts:80).
- Root policy, traversal, ancestor blocking, initial-walk timing and cancellation are currently coupled through a broad lifecycle interface: [lifecycle.ts:14](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/lifecycle.ts:14), [lifecycle.ts:31](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/lifecycle.ts:31), [lifecycle.ts:56](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/lifecycle.ts:56). The ownership wrapper forwards discovery, pending state and Activation: [runtime-ownership.ts:34](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/runtime-ownership.ts:34).
- Domain terminology already makes the Activation session responsible for one document's orchestration: [GLOSSARY.md:48](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/GLOSSARY.md:48). Preserve current bug-fix-only first-occurrence policy: [PRD.md:5](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/.scratch/runtime-activation-reliability/PRD.md:5).

## Proposed interface

```ts
interface RootActivationSession {
  scan(root?: HTMLElement | null): void;
  setObserved(root: HTMLElement | null, observed: boolean): void;
  disconnect(): void;
}

const session = createRootActivationSession({
  islandMap, spine, retry, directiveTimeout,
  surface,       // outward events/logs
  observability // debug-only diagnostics; separate dependency
});

// Existing public revive() interface remains compatible.
const runtime = {
  scan: (root = document.body) => session.scan(root),
  observe: (root = document.body) => session.setObserved(root, true),
  unobserve: (root = document.body) => session.setObserved(root, false),
  disconnect: () => session.disconnect(),
};
const disconnectShopify = connectShopifyLifecycle(runtime);
// Actual wrapper disconnect also disposes this Lifecycle bridge.
```

There are three post-construction entry points. Construction validates configuration and starts document readiness/initial scanning. Counting construction as an entry point gives four; a hard three-including-construction target could combine `scan` and root policy into `visit(root, policy = "preserve")`, but that increases the facts a caller must learn. Prefer the honest three-operation interface to a command-union method that merely hides four verbs under one name.

### Full caller contract

- `scan` rewalks without changing observation policy. `setObserved(root, true)` applies the include override, then scans. `setObserved(root, false)` applies the exclude override and synchronously cancels newly ineligible membership. Null is a no-op. Disabling `document.body` disconnects the session, matching today's public behavior; observing the body scans rather than installing a new explicit body override.
- The nearest explicit include/exclude policy wins. An included descendant survives exclusion of its ancestor. Traversal must skip an excluded element while still traversing descendants for included overrides; pruning the whole excluded Subtree would change behavior.
- Construction observes the same document/body area as today; this proposal does not silently expand support to shadow roots, independent documents, or detached roots. Preserve current connected/nonexcluded eligibility rather than tightening it to a new containment model.
- `disconnect` is terminal and idempotent. It marks the session stopped before any user cleanup, cancels all retry/Gate resources including included descendants, disconnects DOM observation/readiness listeners, and clears root policies and diagnostics. Later commands do nothing.
- Commands return before eventual loader settlement. No completion promise is offered: current `activate()` completion does not consistently represent Custom Directive completion either. Consumers observe existing load/error events.
- Cancellation emits no load error. Built-in/Custom Directive failures retain existing classification, timeout behavior, and attempt-one error details. Loader failures retain per-attempt details, exact configured retry count and exponential delay. Cleanup exceptions remain logged and do not stop other cleanup.
- Event and cleanup callbacks may reenter these operations synchronously. Every continuation after user callbacks validates session/Tag/attempt identity and current membership. Debug settings change diagnostics only.
- Performance is linear in scanned DOM and, initially, in tracked pending/recovery membership per invalidation. No constant-time mutation-cost promise is part of the interface.

Keep surface and observability independent per [ADR-0002:3](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/docs/adr/0002-runtime-observability-is-debug-only.md:3); keep debug behavior invariant per [ADR-0001:3](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/docs/adr/0001-debug-controls-diagnostics-not-behaviour.md:3).

## Hidden implementation and invariants

Keep one ordered membership Map per Tag. A membership record needs `canOwn`; it does not need a cancellation function, a disposer, or its own callback Set. Gate state/controller can live on the Tag's current owner because only one occurrence runs Gates. Preserve per-Tag phases `waiting`, `loading`, `retrying`, `exhausted`, `loaded`, plus state identity and current attempt identity where asynchronous closures need it.

1. **One owner.** The first eligible discovered occurrence owns the complete sequential Gate policy. Later occurrences only retain membership for cascade. Never merge partial Gate progress. Transfer starts the replacement's complete policy from the beginning.
2. **No free attempts.** Exhaustion sets existing membership `canOwn=false`. Those records survive only to receive child cascade after a fresh occurrence later succeeds. Cancelling that fresh pending owner cannot transfer back to exhausted records. This guard is essential, not bookkeeping that consolidation can remove: [activation-session.ts:163](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/activation-session.ts:163), [reliability test:469](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/__tests__/runtime-activation-reliability.test.ts:469).
3. **One import.** Removing the last root during `loading` retains the in-flight Tag state until the unabortable promise settles. A replacement joins it. Never delete that record and launch another loader merely because all Gate resources were aborted. Current acceptance explicitly exercises this: [reliability test:201](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/__tests__/runtime-activation-reliability.test.ts:201).
4. **Retries are Tag work.** Removing the initiating owner while other eligible membership remains does not reset the shared retry schedule or budget. If all membership becomes ineligible during retry delay, cancel queued work; do not spend an attempt without a live root. Retain existing scheduler semantics from [retry-scheduler.ts:40](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/retry-scheduler.ts:40).
5. **Success commits before callbacks.** Mark loaded and detach the successful membership snapshot before aborting resource owners or dispatching events. Leave a loaded record so event-listener unobserve/reobserve cannot reload the Tag: [activation-session.ts:173](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/activation-session.ts:173), [reliability test:441](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/__tests__/runtime-activation-reliability.test.ts:441). Recheck root connection/policy before each child walk.
6. **Parent cascade stays internal.** A pending ancestor Tag blocks child Activation; after success, walk every still-observed retained occurrence including earlier exhausted parents. Removing public `isPending` does not remove this rule.

### Batch invalidation ordering

On a delivered mutation batch, reconcile existing membership first, then process added Subtrees in the existing record/DOM order. On explicit root exclusion, reconcile synchronously before returning. Do not add a debounce, timer, or extra microtask.

For each affected Tag, first detach invalid membership and clear invalid owner identity; then abort its owner controller; then, if state identity is still current and phase is still `waiting`, select the first still-observed `canOwn=true` membership. This prevents cleanup from seeing a logically cancelled owner as live. Never transfer during `loading` or `retrying`. Before starting a replacement, recompute eligibility because abort cleanup can change policy, rescan, or disconnect. Snapshot membership being removed so newly added records from reentry are not accidentally removed by an old iteration. For a whole-session disconnect, invalidate all state before any callbacks.

A global two-pass detach-then-cleanup sweep might appear cleaner but can alter cross-Tag cleanup visibility compared with today's insertion-order callbacks. Start with per-Tag transitions and preserve existing observable ordering; prove stronger batching with tests before adopting it. No new cross-Tag ordering guarantee is proposed.

Native mutation notifications are queued microtasks, while `AbortController.abort()` runs abort steps and fires the abort event directly. Therefore a batch sees the current DOM rather than a sequence of historical membership snapshots, and cleanup can reenter cancellation. Those are platform constraints, not framework preferences. See the primary [DOM mutation observer algorithm](https://dom.spec.whatwg.org/#mutation-observers), [abort steps](https://dom.spec.whatwg.org/#abortsignal-run-abort-steps), and [isConnected definition](https://dom.spec.whatwg.org/#dom-node-isconnected). In particular, a remove-and-reinsert before notification must be judged by final eligibility; a moved element still connected inside an excluded Subtree must be cancelled.

## Dependencies and adapters

| Dependency | Category | Treatment |
| --- | --- | --- |
| Tag phase, owner selection, canOwn, attempt identity | In-process | Session-private state; exercise through root commands and observable outcomes. No injected state-machine adapter. |
| DOM traversal, root policy, MutationObserver, event listeners | Local-substitutable | Native browser adapter and happy-dom plus existing deterministic mutation/visibility drivers. Keep native element identity coverage. Do not expose `watch`, `isObserved`, or `walk` for tests. |
| Timers and built-in waiters | Local-substitutable | Reuse current native implementation and deterministic test timer/waiter adapters. Keep substitution private to module implementation/test assembly. |
| Island module loading | True external to orchestration | Continue injecting `IslandLoader` via islandMap. Production dynamic imports; tests controlled resolve/reject promises and call counters. Cancellation is logical; it does not assert import abortion. |
| RuntimeSurface / RuntimeObservability | Existing distinct modules | Remain separate dependencies. Tests inspect events and debug output independently. |

Two real DOM/timer adapters justify those seams. A new generic `Platform` with twenty DOM forwarding methods would increase interface burden and delay implementation. Prefer existing DOM globals under happy-dom and native browser execution, with only already-needed clock/waiter substitution.

Replace old callback-registry implementation tests only once equivalent behavior is covered through root operations. Keep Gate/retry tests that specify independent reusable behavior. Do not layer a new set of state-inspection tests over obsolete lifecycle/watch tests.

## Cost model, leverage, and independent challenge

Let N be pending/recovery occurrences, T their Tags, H DOM ancestor depth, A scanned additions, and C cancellations.

| Stage | Current | Proposed first implementation |
| --- | --- | --- |
| Startup | DOM walk + Tag membership + per-occurrence watch callback/disposer/Set; one active Gate per Tag | Same DOM walk/membership and active Gates; no duplicate registry or parked callback/disposer/Set |
| Delivered mutation batch | Registry sweep roughly O(N × H), then addition walk | Session membership sweep roughly O(T + N × H), then same addition walk; fewer indirections, same asymptotic work |
| Explicit exclusion | Registry sweep plus contains/policy checks | Membership sweep plus equivalent policy checks; avoid a new containment index initially |
| Teardown | Remove watches and abort Gates, with callbacks mutating Tag membership | Clear membership and abort active owner per Tag; cancellation work proportional to actual resources |
| Retention | Membership plus registry | Membership remains necessary for recovery; no claim of eliminating O(N) memory |

Depth improves because root intent gets policy, Gate sequencing, retry ownership, recovery and cascade. Locality improves because membership eligibility and ownership transfer change in one module. Leverage applies across initial scan, Theme Editor events, mutation additions/removals, explicit controls, retries and all their tests. Removing a callback registry is a concrete allocation reduction visible from source, but the elapsed-time effect is unmeasured.

Challenges to the idea:

- The supplied matched 1,000-interaction/4×CPU medians are 2.85 ms baseline versus 3.2 ms bugfix. This report has not independently reproduced them. They do not prove cancellation registration is the cause. Parsing Gates, traversal, ancestor policy checks, diagnostics, promise allocation, JIT and run noise remain plausible contributors.
- The sweep already exists. Calling it batching does not itself improve asymptotics. A session loop over every Tag may even add overhead on pages with many Tags or exhausted recovery records. Measure mutation-heavy and distinct-Tag cases, not startup alone.
- Cancelling only records named in `removedNodes` is insufficient: moves under an excluded root and nested overrides require current-policy evaluation. An index or incremental eligibility cache adds invalidation complexity; defer it until measurements justify it.
- A callback registry is extensible to independent users; deleting it is justified only while all current registrations represent this session's membership. Search all consumers before implementation. If a new independent lifecycle user appears, reassess rather than rebuilding the registry under a different name.
- Three methods do not automatically make this a deep module. A giant config or exposed command union can hide the same burden. Keep root commands semantic, diagnostics separate, and internal seams private.
- Moving five files at once can slow correctness review. The first useful experiment removes duplicate cancellation ownership without changing Gate execution, discovery optimizations or retry scheduling. Full consolidation is optional if that seam already earns its keep.

## Exact validation plan for a later implementation

1. Preserve a clean pinned comparison and record implementation time/review scope separately from runtime measurements. Search `watchCancellable` and registry consumers; confirm the registry has no unrelated responsibilities. No production experiment was made in this research task.
2. Reuse root-interface cases in `runtime-activation-reliability.test.ts`: first-owner policy, cancellation transfer, all sequential built-ins then Custom Directive AND behavior, exhaustion/no free retry, fresh-parent recovery, included-child exclusion override, late success/rejection, shared import and shared retry, loaded-event reentry. Keep issue 02 competition tests excluded from acceptance.
3. Add meaningful missing transitions: simultaneous owner+parked removal in one batch; owner moves under excluded root; remove/reinsert before delivery; custom cleanup reenters scan/observe/unobserve/disconnect; error-event callback starts new work; old async callback cannot clear replacement state; cancellation of fresh owner leaves only exhausted `canOwn=false` records. Assert loader/event/cleanup counts and child Activation, not internal Map contents.
4. Run `bun test`, `bun run check`, `bun run lint`. Native recovery via `sh .scratch/runtime-activation-reliability/scripts/serve-recovery.sh`; verify actual custom-element registration identities, not only happy-dom loaders. Run native policy cases for nested include/exclude and disconnect.
5. With exclusive browser/benchmark access, run the existing runtime setup fixture sequentially against pinned baseline, current bugfix and candidate. Match browser/CPU/build settings, interleave revision order, retain individual samples/median/range. Include repeated visible 1/100/1,000, 100 distinct Tags, 1,000 interaction occurrences; add separate mutation/exclusion/teardown workloads. Record IO/listener counts and actual cleanup alongside time. Do not run this concurrently with other agents' benchmarks.
6. Attribute only after controlled comparisons: candidate retaining registry versus candidate removing it, same remaining implementation. Record allocation evidence if tooling permits. If gain is inside sample noise, claim simpler ownership/allocation structure only. Report any mutation/teardown regression separately from startup.
7. Existing storefront functional matrix remains required before shipping; this research grants no deployment authorization. No speed claim is supportable from the design alone.

## Deferred work

Independent same-Tag Gate competition remains issue 02. This proposal deliberately retains exactly one Gate owner and a controller only for that owner. Per-occurrence Gate controllers, racing Gate promises, delegated interaction infrastructure and general competition policy would require a separate design/performance comparison. They are not prerequisites for this experiment.

## Isolated prototype delivered after design

Parent requested a narrow source experiment. It lives at [/tmp/islands-batch-session-lm2vgwf2](/tmp/islands-batch-session-lm2vgwf2/PROTOTYPE.md), with a portable [patch against 77856c7](/tmp/islands-batch-session-lm2vgwf2/batch-reconciliation.patch). Only `activation-session.ts`, `lifecycle.ts`, and `runtime-ownership.ts` differ. Production source remains untouched. The full root-interface redesign above is deliberately not implemented.

The prototype replaces watch/disposer registration with a session `reconcile(shouldCancel?)` internal operation. Mutation delivery calls it before additions. Explicit exclusion supplies one predicate equivalent to the previous `cancelInRoot` selection: membership inside that root whose nearest root policy excludes it. This avoids prematurely cancelling unrelated detached membership. The predicate is allocated per exclusion, never per Island element. Default reconciliation allocates one eligibility predicate per call. Membership retains `canOwn`, existing Tag identity checks, retry phases and in-flight loading retention; no new attempt-identity mechanism was introduced.

Validation completed before the parent began shared performance work: **320 tests passed, 0 failed, 631 assertions; typecheck passed; lint reported 0 warnings and 0 errors**. The initial isolated test invocation omitted the copied `bunfig.toml` preload and failed with undefined `document`; copying the existing configuration fixed that packaging error before the successful run. There were no native-browser or timing runs.

**Unresolved semantic gap:** the prototype snapshots membership grouped by Tag. The old callback registry iterates global element insertion order, so `A1,B1,A2` can become `A1,A2,B1`. Every record's cancellation predicate is reevaluated when reached, and stale records are identity-checked after cleanup, but this does not restore old cross-Tag cleanup order. For example, B1 cleanup can relocate or reobserve A2 before its old-order cancellation; the grouped version can cancel A2 first. Existing passing tests do not prove equivalence for this case. Treat this prototype as allocation-isolation evidence only until that ordering is fixed or explicitly accepted. No behavior change is accepted by this report.

One possible exact-order implementation adds a monotonic insertion ordinal to each membership, gathers membership snapshots and sorts by ordinal during reconciliation. Transfer-created membership gets a fresh ordinal, matching watch re-registration. This removes per-element callbacks/Sets while shifting sorting/allocation cost to invalidation. Reentrant additions and deletion must still be tested against old live-Map iteration behavior. A private global linked membership list can avoid sorting but adds pointer-maintenance complexity; it is a poor default for an experiment intended to speed implementation. These options are unimplemented and unmeasured.

## Parent empirical comparison after research

The parent benchmarked this narrow prototype against pinned current code and a lazy-diagnostics candidate. In the first 40-sample rotating run at 4× CPU, 1,000-interaction setup was 3.35 ms current / 3.10 ms batch cancellation; 1,000-visible setup 3.00 / 2.80 ms. Owner-removal handling was 0.15 / 0.50 ms, parked removal 0.85 / 1.00 ms, parent exclusion 0.60 / 0.70 ms, and disconnect 0.70 / 0.80 ms. These are local synthetic medians. See [metadata and summary](evidence/first-summary.json) and [all samples](evidence/first-samples.csv).

This experiment does not support adopting the rewrite for speed now: the startup gain is small, mutation handling gets slower in this fixture, and cleanup-order compatibility remains unresolved. The possible wider three-operation root interface remains a design proposal rather than a validated performance recommendation.
