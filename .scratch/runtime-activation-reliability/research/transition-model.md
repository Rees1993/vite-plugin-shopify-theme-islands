# Explicit transitions and commands for Activation

Research only; production reference `77856c7`; 2026-11-06. No production implementation or new benchmark runs were performed for this proposal.

## Recommendation

An explicit transition model is useful as a correctness specification. A general immutable reducer, actor runtime, event bus, or state-machine dependency is not justified for the current bug-fix-only work. If a later structural change is authorized, use one private per-Tag transition function with narrowly typed commands, mutable retained membership, and token-checked effects inside the Activation session. Keep the consumer `revive()` interface unchanged. First investigate the actual setup allocations before claiming this structure will make it faster.

The current code already has five named phases; the architectural change would move all legal changes and consequences into one place, rather than merely renaming those phases. Its value is settlement and cancellation locality. Its overhead is event/command representation, acknowledgements, and effect validity checks. Those costs can exceed the closures it replaces.

## Evidence and scope

The [scoped PRD](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/.scratch/runtime-activation-reliability/PRD.md:24) requires first-observed Gate ownership, cancellation transfer, retained earlier roots after exhaustion, one shared load, and no free retries. [Current Activation session](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/activation-session.ts:53) stores phase, membership, Gate owner, controllers and eligibility. [Lifecycle](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/lifecycle.ts:56) owns walking and ancestor holds; [Observed root controls](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/runtime-ownership.ts:70) translate the public control verbs.

Measured existing evidence: the [matched setup summary](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/.scratch/runtime-activation-reliability/WORKFLOW.md:128) records 1,000 interaction occurrences at 4× CPU with baseline/candidate medians 2.85/3.20 ms and p90 3.10/3.70 ms. The [raw matched evidence](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/.scratch/runtime-activation-reliability/evidence/runtime-setup-matched-bugfix-only.json) is the source artifact. This is a small synthetic regression, not an isolated watcher measurement or storefront result. No measurement of the proposed design exists. All proposed cost differences below are hypotheses.

## Interface and seam

Keep the Activation session's existing caller interface (`discover`, `activate`, `isPending`, `clear`), with `activate` retaining its Promise behavior. Hide the transition protocol behind that interface. The internal seam separates pure Tag policy from DOM/timer/module-loader effects:

```ts
type Token = { session: number; generation: number; operation: number };
type TagEvent =
  | { type: "discover"; occurrence: OccurrenceId }
  | { type: "removed"; occurrence: OccurrenceId }
  | { type: "rootsChanged"; eligible: readonly OccurrenceId[] }
  | { type: "gatesReady"; token: Token }
  | { type: "gatesRejected"; token: Token; error: unknown; attribute: string | null }
  | { type: "retryDue"; token: Token }
  | { type: "loadResolved"; token: Token; duration: number }
  | { type: "loadRejected"; token: Token; error: unknown }
  | { type: "stop" };

type Command =
  | { type: "startGates"; occurrence: OccurrenceId; token: Token }
  | { type: "disposeGates"; token: Token }
  | { type: "startLoad"; token: Token; attempt: number }
  | { type: "scheduleRetry"; token: Token; delay: number }
  | { type: "cancelRetry"; token: Token }
  | { type: "releaseMembership"; occurrences: readonly OccurrenceId[] }
  | { type: "loadEvent"; token: Token; attempt: number; duration: number }
  | { type: "errorEvent"; token: Token; attempt: number; error: unknown }
  | { type: "cascade"; token: Token; occurrences: readonly OccurrenceId[] };

// Private specification-level seam. Not an exported package contract.
function transition(state: TagState, event: TagEvent): readonly Command[];
```

This is an interface sketch, not compilable production code. `OccurrenceId` denotes one tracked DOM identity; the shell maps it to the actual Island element. `discover` here means admission of a candidate that passed the existing ancestor hold. The current separate `session.discover()` diagnostic call remains a debug observer notification, before that hold, and must not admit a blocked child. Naming that distinction explicitly avoids accidentally starting children through a new event protocol.

For a pure prototype, return `{state, commands}` and feed immutable logical inputs. A production optimization, if measured necessary, can mutate private Tag state and append commands into a reusable local buffer. Do not copy a 1,000-entry membership Map on every admission. Do not expose `dispatch(event)` publicly: it makes callers learn an implementation protocol without adding useful control verbs.

## Hidden implementation

Each Tag record retains an insertion-ordered Map of occurrences with `canOwn` and a membership handle. Logical state contains phase, Gate owner, retry budget and attempt, a generation identity, and a distinct operation identity for the currently pending Gate/load/timer. The shell owns controllers, timers, actual DOM references, loader functions, logger handles and disposal functions. A single reducer should own retry eligibility and attempt numbering; retaining an independent scheduler counter as a second authority creates reconciliation work. The existing scheduler could instead become a timer adapter if this proposal were pursued.

Ordinary parked occurrences allocate membership only. They do not allocate Gates, controllers, plans, event subscriptions, or retry work. The first admitted occurrence starts the complete existing Gate sequence. Membership is needed even for `canOwn=false` occurrences: success after a fresh occurrence must cascade their still-observed Subtrees.

| Event and state | Committed logical change | Commands |
| --- | --- | --- |
| First discovery, no record | waiting; admit owner, canOwn=true | start owner's Gates |
| Later discovery, waiting/loading/retrying | retain root; never compete | membership bookkeeping only |
| Owner removed, waiting | remove owner; choose earliest observed canOwn occurrence | dispose old Gates; start replacement's entire Gate policy |
| Root removed, loading | drop that membership; retain in-flight load identity | dispose any Gate resources; no second load |
| Gates ready, current token, observed owner | loading; reserve attempt before invoking loader | start one load |
| Load rejection with observed membership and budget | retrying; advance recorded failure count | error event; timer with unchanged exponential backoff |
| Retry due, current token and live membership | loading; reserve next attempt | start one load |
| Final failure or Gate error | exhausted; clear owner; set all retained canOwn=false | dispose Gates/timer; appropriate error event |
| Fresh discovery after exhaustion | waiting; new generation; only fresh occurrence canOwn=true | start fresh occurrence's Gates |
| Load success, current token with live membership | loaded; detach retained membership snapshot | unwatch/dispose; load event; guarded cascade |
| Stop, any state | session stopped synchronously; invalidate all tokens | dispose all resources; no cascade |

The table abbreviates eligibility checks and event payload distinctions; it does not authorize changing current event timing. A rejected custom Gate keeps its attribute-specific log and error behavior; cancellation emits no loader error. Initial attempt is 1; only loader rejection consumes the configured loader retry budget. Gate transfer starts the replacement's full sequence, with no borrowed partially-open Gates.

Retain a loading tombstone when the last root disappears. An import cannot be aborted through this interface, so removing its Tag record would permit a newly found occurrence to start an overlapping import. A new occurrence arriving before settlement joins the existing in-flight generation; a stale completion can never affect another generation. If no eligible occurrence remains at settlement, suppress user events/cascade and release the record. This preserves the current distinction between cancellation while waiting and unabortable loading. A retry timer with no remaining membership is cancelled; a later fresh occurrence may start a new generation once no load is in flight.

## Example: exhaustion and later recovery

1. A is discovered: waiting(A); only A runs Gates. B is discovered and retained without Gates.
2. A opens its Gates: loading attempt 1. A and B remain retained for cascade, even if A's Gate cleanup has completed.
3. The configured loader attempts exhaust: exhausted(A=false, B=false). A rescan of A/B does nothing.
4. Fresh C is discovered: waiting(C) in a new generation. A/B stay retained and ineligible to own.
5. If C is removed while waiting, neither A nor B gets a free retry. If a later eligible fresh D already joined, D may own; otherwise remain exhausted.
6. If C's load succeeds, commit loaded and remove membership handles before running cleanup. Recheck stop/token and observed eligibility before dispatch and before each walk of A/B/C. Descendant discovery resumes only through the existing ancestor-hold logic.

This concentrates the recovery rule in one transition instead of making a new loader callback rediscover old closure state.

## Effect ordering and reentrancy

Commit logical state before invoking any command that can call consumer code. The DOM Standard's [abort steps](https://dom.spec.whatwg.org/#abortsignal-run-abort-steps) run abort algorithms and fire the abort event; [event dispatch](https://dom.spec.whatwg.org/#concept-event-dispatch) invokes listeners within dispatch. Therefore `abort()`, Custom Directive cleanup, and `islands:load` listeners can call runtime controls before the current operation returns. This is a reason to validate commands after external calls, not only when accepting an asynchronous event.

Use a synchronous transition entry and a guarded command drain. A reentrant `disconnect()` must commit stopped immediately, even if another command batch is draining. Queueing the stop event behind a batch and continuing cascade first would break the contract. Pending command batches are immutable descriptions; before each start/load/event/walk command, revalidate the token and current stopped/ownership state. Disposal commands use resource identities and are idempotent, so they can still retire obsolete resources after tokens are invalidated. A start command skipped after invalidation must settle its caller acknowledgement too.

On success, snapshot and detach membership before cleanup. Unwatch all old handles, dispose Gate resources exactly once, check validity, dispatch the load event, then check again before each cascade root. On exhaustion, flip eligibility and clear owner before abort cleanup can reenter. On stop, set the session flag before any callback. Cleanup errors retain current reporting and cannot prevent other resources from being disposed.

Mutation records are evidence to inspect, not authoritative removal commands: the DOM Standard [queues observer notification as a microtask](https://dom.spec.whatwg.org/#queue-a-mutation-observer-microtask). A remove/reinsert can be complete when delivery occurs. Preserve the current `isConnected` and nearest-root-policy sampling rather than interpreting every removed-node record as cancellation. Root policy changes can occur synchronously without a mutation, so `rootsChanged` must also run from include/exclude controls. Always recheck live DOM eligibility immediately before Gate start, loader invocation, and cascade.

An additional hidden complication is the Custom Directive `load()` Promise. [Current execution](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/island-element-activation.ts:145) returns `ctx.run()` from the last Gate. The shell cannot replace this with a void event dispatch without changing observable behavior. It needs a per-operation acknowledgement preserving the existing Promise timing (first loader attempt completion, not eventual retry-series success), while duplicate/obsolete notifications resolve harmlessly. Avoid creating deferred Promises for ordinary parked discovery; only operations whose existing callers await completion need them.

## Dependencies and adapters

| Dependency | Category and seam treatment |
| --- | --- |
| Tag phase, eligibility, attempt count, ordering, tokens | In-process; deepen into one implementation; no injected adapter |
| DOM walking, closest include/exclude policy, MutationObserver, controllers | Local-substitutable; actual browser DOM plus deterministic observer stand-ins already used by runtime tests; internal seam |
| Timers and monotonic clock | Local-substitutable; existing fake timer platform plus native timers; internal seam |
| Module loader | True external behavior from consumer code; injected existing IslandLoader; controlled resolve/reject adapter in tests |
| RuntimeSurface | Retain outward event/log interface, separately injected |
| RuntimeObservability | Retain debug-only observer, separately injected |

The [nearest policy implementation](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/lifecycle.ts:31) remains authoritative: the first policy encountered walking ancestors wins. `unobserve(parent)` preserves an explicitly included child; stop cancels everything. Do not cache `isObserved` indefinitely in reducer state. Keep [ADR-0001](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/docs/adr/0001-debug-controls-diagnostics-not-behaviour.md) and [ADR-0002](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/docs/adr/0002-runtime-observability-is-debug-only.md): diagnostics cannot choose transitions and surface does not become part of debug observability.

## Depth, locality and leverage

Depth improves only if callers continue learning the small Activation session interface while the implementation owns transfer, retry, token validation and settlement. A public event algebra with ten events and ten commands would be shallow for existing callers. A private transition seam gives maintainers locality: every eligibility/phase rule can be reviewed together, and effect execution follows one ordering discipline. Its leverage is strongest for future changes involving more than one phase; it offers little direct leverage for DOM scanning itself.

The deletion test favors keeping the session: removing it redistributes shared Tag policy to the lifecycle walker, Gate execution and retry callbacks. It does not favor extracting a generic reducer package: deleting that package would mostly remove protocol machinery. Keep the real Gate module, walker, runtime surface and observer adapters unless a concrete dependency needs to move. File-count reduction is not depth.

## Expected cost model and falsifiable claims

Let N be retained occurrences, T pending Tags, H average ancestor depth, M observer deliveries, and C roots receiving cascade. Current code gives each occurrence a PendingElement, a cancellation closure, a membership Map entry and watcher registration. [Watcher registration](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/cancellable-watchers.ts:24) adds a Set and unwatch closure per distinct Island element. Each Tag owner additionally creates Gate controller and asynchronous closures; parked occurrences do not run Gates.

| Work | Current cost | Proposed cost and uncertainty |
| --- | --- | --- |
| Initial repeated-Tag discovery | O(N) membership/watchers plus walker/ancestor policy checks; O(T) active Gates | Still O(N), same DOM reads unless separately optimized; event objects/commands may add cost |
| Owner transfer | array materialization and O(N) eligibility search | Ordered Map iteration can avoid temporary key array; still worst-case O(NH); measurable only in cancellation workload |
| Mutation cancellation | scans retained watcher entries, tests connectivity/policy: roughly O(NH) per delivery | Same if watcher adapter retained; reducer provides no asymptotic reduction |
| Root exclusion | scans watcher registry and root containment/policy | Same unless a separately justified membership index is introduced |
| Loader settlement | scans live membership, snapshots roots and handles, cleanup and cascade | Same O(N + cascade traversal); possible fewer duplicate arrays, extra command guards |
| Teardown | O(N + T) resource retirement | Same order, plus command dispatch overhead; idempotent retirement improves reliability |

Do not promise startup savings from transition purity. The [current active check](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/activation-session.ts:129) materializes a roots array before `some`; replacing it with a short-circuit Map loop is a concrete independent allocation hypothesis. Sharing one cancellation callback through a keyed membership registry could remove per-occurrence closures/Sets, but that is a different storage design requiring its own tests and timings. An explicit event model alone removes neither.

Falsifiable hypotheses for a separately authorized prototype:

- A mutable Tag transition with no command for parked admission can keep repeated-Tag Gate resources at O(T), with the same interaction-listener counts as current scope. Any per-occurrence Gate/controller growth falsifies the design.
- An immutable reducer that copies membership for each discovery will grow total copied entries quadratically for a single Tag; allocation measurements and N=100/1,000/10,000 setup scaling should expose this. Reject that implementation without needing storefront claims.
- Removing closure/Set membership allocation, if separately prototyped, should reduce allocated bytes/objects during setup. It may not reduce wall time at these small durations; failure to improve repeated paired timings rejects a speed claim.
- Token-checked commands should prevent stale loads, timers and cleanup from affecting newer attempts. A single stale-settlement counterexample rejects correctness regardless of timing.
- The state machine by itself should not improve mutation complexity when the watcher adapter remains unchanged. Claims otherwise require a changed algorithm and delivery workload measurements.

## Validation before any adoption

Start with a disposable model, no production replacement. Encode event sequences for transfer, exhaustion then fresh recovery, nested include/exclude, removal/reinsertion before observer delivery, old timer delivery after cancellation, and in-flight roots reaching zero then gaining a new occurrence. Add adversarial cleanup and event callbacks that call scan/unobserve/disconnect or introduce fresh same-Tag elements. Assert externally observed load count, event payloads/attempts, cleanup once, child cascade and stop behavior.

Then implement a disposable adapter using the current `revive()` entry and controlled real DOM/timer adapters. Test through that same interface; reducer transition tests can supplement invariant exploration but do not replace browser behavior. Keep native custom-element recovery verification because DOM emulators can replace element identities. If adopted later, replace shallow policy tests with seam-level coverage where equivalent, rather than preserving two complete representations of every transition.

Only after correctness, compare the exact matched baseline/current/prototype setup fixtures with alternating samples, normal and 4× CPU, counts and allocation traces, startup/mutation/teardown reported separately. Use isolated traces for attribution, then clean timing runs without instrumentation. Include one-Tag-many-occurrence and many-Tag-one-occurrence workloads. Investigate outside-range regressions rather than declaring an arbitrary percentage acceptable. No benchmark was run by this research task.

## Deferred competition

[Issue 02](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/.scratch/runtime-activation-reliability/issues/02-competing-gates.md) is separate. This model intentionally has one Gate owner and no winner election. A future competition design would change eligibility and controller resource cardinality, not simply add one event. Do not add competitor records, priority queues, delegated listeners or replay machinery now in anticipation of it.

Decision: retain the bug-fix-only implementation while identifying measured costs. Use explicit transition/command discipline selectively if a future change makes current callback ordering hard to maintain. Reject a general reducer/framework rewrite as the next performance action; it has no demonstrated speed advantage and adds Promise/effect-ordering obligations precisely where correctness is hardest.
