# RFC: Unified Directive Error Handling

## Semver impact: **patch**

All changes are bug fixes to existing behaviour — no new options, no new exports, no
changes to event shapes or timing for the happy path.

- **`islands:error` now fires for unexpected built-in directive throws.** Previously these
  were silently swallowed by the bare `catch {}`. This is fixing incorrect behaviour —
  errors that should have been observable weren't. Consumers with `onIslandError` listeners
  will receive events they couldn't see before, but only for genuinely unexpected failures
  (not element removal). That is the correct behaviour and classifies as a bug fix.
- **`DirectiveCancelledError` is internal.** It is never exported from the package.
  Consumers cannot `instanceof`-check it. The sentinel is purely a runtime implementation
  detail.
- **The `queued` cleanup fix** (missing `queued.delete` on built-in cancellation) corrects
  a bug where a re-inserted element could fail to reactivate. Bug fix → patch.

If the `islands:error` change is judged a behaviour-breaking change (i.e. a consumer's
`onIslandError` handler now receives events it was not designed to handle), it could be
argued as **minor**. The counter-argument is that consumers are expected to handle any
`islands:error` — the event contract doesn't promise it only fires for loader failures.

## Problem

`src/runtime.ts` — two directive failure paths produce inconsistent outcomes:

**Stage 1 — built-in directive failure** (element removed from DOM before condition met):
```ts
try {
  await applyBuiltInDirectives(tagName, el, note);
} catch {
  flushLog("aborted (element removed)");
  return; // silent — no islands:error, no queued.delete, no retryCount.delete
}
```

**Stage 3 — custom directive failure** (throws, rejects, or timeout):
```ts
const handleDirectiveError = (attrName: string, err: unknown) => {
  console.error(`[islands] Custom directive ${attrName} failed for <${tagName}>:`, err);
  dispatch("islands:error", { tag: tagName, error: err, attempt: 1 });
  retryCount.delete(tagName);
  queued.delete(tagName);
};
```

Inconsistencies:
1. An unexpected throw from a built-in directive (not a cancellation) silently aborts —
   `islands:error` never fires.
2. The stage-1 bare `catch {}` skips `queued.delete` and `retryCount.delete`. If the
   element is re-inserted, `activate()` finds `queued.has(tagName) === true` and never
   reactivates — **this is a latent bug**.
3. `visible()` and `interaction()` call `reject()` with no argument, making it impossible
   to distinguish expected cancellation from an unexpected error without a `err == null`
   heuristic.

## Recommended Interface

Hybrid of the **common-caller** and **minimal** designs.

### Step 1 — Replace bare `reject()` with a typed sentinel

```ts
/**
 * Thrown by visible() and interaction() cancel functions when the element
 * is removed from the DOM before the directive condition is met.
 * Using a class makes isCancellation() an instanceof check — no null heuristics.
 */
class DirectiveCancelledError extends Error {
  readonly cancelled = true as const;
  constructor() {
    super("[islands] directive cancelled: element removed from DOM");
    this.name = "DirectiveCancelledError";
  }
}

function isCancellation(err: unknown): err is DirectiveCancelledError {
  return err instanceof DirectiveCancelledError;
}
```

`visible()` and `interaction()` change their `pending.set` cancel functions from:
```ts
reject()
```
to:
```ts
reject(new DirectiveCancelledError())
```

### Step 2 — Single outcome handler, two discriminants

```ts
type DirectiveOutcome =
  | { kind: "builtin-catch"; err: unknown }     // stage 1 catch — handler decides silently vs error
  | { kind: "directive-error"; attrName: string; err: unknown }; // stage 3

type HandleDirectiveOutcome = (outcome: DirectiveOutcome) => void;

/**
 * Factory — called once inside loadIsland(), closes over tagName, queued, retryCount.
 * Returns a single callable used at both failure call sites.
 */
function makeDirectiveOutcomeHandler(
  tagName: string,
  queued: Set<string>,
  retryCount: Map<string, number>,
): HandleDirectiveOutcome;
```

### Behaviour matrix

| Outcome | isCancellation? | `islands:error`? | `queued.delete`? | log? |
|---|---|---|---|---|
| `builtin-catch`, err is `DirectiveCancelledError` | yes | no | no* | no |
| `builtin-catch`, err is anything else | no | yes | yes | yes |
| `directive-error` | n/a | yes | yes | yes |

\* Cancellation deliberately leaves the tag in `queued`. If the element is re-inserted, a
new element instance triggers `activate()` which calls `queued.has(tagName)` → true →
skips. This is correct idempotent behaviour. Clearing `queued` on cancellation would allow
a re-inserted element to register a second `customElements.define` attempt.

### Implementation sketch

```ts
function makeDirectiveOutcomeHandler(
  tagName: string,
  queued: Set<string>,
  retryCount: Map<string, number>,
): HandleDirectiveOutcome {
  return (outcome) => {
    if (outcome.kind === "builtin-catch" && isCancellation(outcome.err)) {
      // Expected DOM removal — silent, queued intentionally preserved
      return;
    }

    const attrName =
      outcome.kind === "directive-error"
        ? outcome.attrName
        : "built-in directives";
    const err =
      outcome.kind === "directive-error" ? outcome.err : outcome.err;

    console.error(`[islands] Directive ${attrName} failed for <${tagName}>:`, err);
    dispatch("islands:error", { tag: tagName, error: err, attempt: 1 });
    retryCount.delete(tagName);
    queued.delete(tagName);
  };
}
```

### Call sites in `loadIsland()`

```ts
// One line to wire up
const handleOutcome = makeDirectiveOutcomeHandler(tagName, queued, retryCount);

// Stage 1 — was a bare catch {}
try {
  await applyBuiltInDirectives(tagName, el, note);
} catch (err) {
  handleOutcome({ kind: "builtin-catch", err });
  flushLog("aborted (element removed)");
  return;
}

// Stage 3 — replaces handleDirectiveError definition
const handleDirectiveError = (attrName: string, err: unknown) =>
  handleOutcome({ kind: "directive-error", attrName, err });
```

Both call sites are a single expression. No conditionals at the call site.

## What This Fixes

| Issue | Before | After |
|---|---|---|
| Unexpected built-in throw silently swallowed | bare `catch {}` drops all errors | `builtin-catch` + non-cancellation path fires `islands:error` |
| Latent bug: `queued` not cleared on built-in cancellation | `queued.has(tagName)` blocks reactivation of re-inserted element | cancellation deliberately preserves `queued` — behaviour unchanged, now documented |
| `reject()` without argument — fragile cancellation detection | `err == null` heuristic | `instanceof DirectiveCancelledError` |
| Cleanup logic (`queued.delete`, `retryCount.delete`) duplicated / missing | scattered across two paths | single location in `makeDirectiveOutcomeHandler` |

## Designs Considered

### Minimal (sentinel + single function with `silent` boolean)
`handleDirectiveFailure(tagName, attrName, err, silent: boolean)`. Introduces
`DirectiveCancelledError` sentinel (adopted into recommendation). The `silent` boolean flag
is slightly surprising at the call site — a reader seeing `handleDirectiveFailure(..., true)`
must know what `true` means. The discriminated `kind` approach from the common-caller design
is more self-documenting.

### Flexible (DirectiveErrorPipeline + categories)
Full extensible pipeline: `DirectiveErrorCategory` discriminated union, ordered middleware
handlers, AND/OR merge semantics for `suppressEvent`/`retry`, async handler support.
Enables Sentry integration, per-directive suppression, future retry-on-directive-failure.
Rejected: the pipeline's merge semantics would be a hard-to-change public commitment, and
none of the extensibility is needed now. Can be added on top of this design later if demand
emerges.

### Common-caller optimised (recommended basis)
`makeDirectiveOutcomeHandler` factory + discriminated `DirectiveOutcome` union. Call sites
pass `{ kind, err }` — zero local conditionals. The `err == null` cancellation check from
this design was replaced with `instanceof DirectiveCancelledError` (from the minimal
design) for robustness.
