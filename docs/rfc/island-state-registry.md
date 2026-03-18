# RFC: Island Loading State Registry

## Problem

`src/runtime.ts` — `revive()` closure contains five mutable collections tracking island
loading state:

- `queued: Set<string>` — tag names that have started loading
- `loaded: Set<string>` — tag names that finished loading successfully
- `retryCount: Map<string, number>` — per-tag retry attempt count
- `pendingCancellable: Map<Element, () => void>` — elements awaiting cancellable directives
- `initDone: boolean` — whether the initial DOM walk has completed

These are accessed from `activate()`, `loadIsland()` (and its inner `run()` closure),
`customElementFilter`, and `handleRemovals()`. They carry implicit invariants (e.g.
`retryCount` keys ⊆ `queued`; `loaded` entries were once `queued`) that are only
enforced by call-site discipline, not structure.

## Recommended Interface

Hybrid of the **minimal** and **common-caller** designs. Factory function, closure-based,
no class.

```ts
interface IslandRegistry {
  /**
   * Attempt to claim a tag name for loading.
   * Returns false if already queued or loaded — lets activate() bail early without
   * a separate read.
   */
  queue(tag: string): boolean;

  /**
   * Notify the registry of a load outcome.
   * "success" → clears retry state, marks loaded. Returns the attempt number for
   *   inclusion in the islands:load event detail.
   * "failure" → increments retry count. Returns next retry delay in ms, or null
   *   if retries are exhausted (tag evicted from queued — becomes claimable again).
   */
  settle(tag: string, outcome: "success"): number;
  settle(tag: string, outcome: "failure"): number | null;

  /**
   * Returns true if the tag is queued but not yet loaded.
   * Used by customElementFilter (NodeFilter.FILTER_REJECT) and the ancestor walk
   * in activate() to defer child islands until the parent resolves.
   */
  isBlockedBy(tag: string): boolean;

  /** True once the initial DOM walk has completed (suppresses "waiting · ..." logs). */
  readonly initDone: boolean;

  /** Called exactly once at the end of init(). */
  markInitDone(): void;

  /** Register a cancel callback for an element awaiting a cancellable directive. */
  watchCancellable(el: Element, cancel: () => void): void;

  /**
   * Remove and invoke cancel callbacks for every element no longer connected to the DOM.
   * Called by handleRemovals() — owns the isConnected scan internally.
   */
  cancelDetached(): void;
}

function createIslandRegistry(opts: {
  retries: number;
  retryDelay: number;
}): IslandRegistry;
```

## Usage at Each Call Site

### `activate()`
```ts
function activate(el: HTMLElement): void {
  const tagName = el.tagName.toLowerCase();
  if (!registry.queue(tagName)) return;        // false = already queued or loaded
  const loader = islandMap.get(tagName);
  if (!loader) return;

  let ancestor = el.parentElement;
  while (ancestor) {
    if (registry.isBlockedBy(ancestor.tagName.toLowerCase())) return;
    ancestor = ancestor.parentElement;
  }

  loadIsland(tagName, el, loader);
}
```

Note: `queue()` must be called before the loader lookup and ancestry walk so the tag is
claimed atomically. If `islandMap.get` fails, the tag remains in `queued` — same behaviour
as today where `queued.add` precedes the ancestor check.

### `run()` inside `loadIsland()`
```ts
const run = (): Promise<void> => {
  if (disconnected) return Promise.resolve();
  const t0 = performance.now();
  return loader()
    .then(() => {
      const attempt = registry.settle(tagName, "success");
      dispatch("islands:load", { tag: tagName, duration: performance.now() - t0, attempt });
      if (el.children.length) walk(el);
    })
    .catch((err) => {
      console.error(`[islands] Failed to load <${tagName}>:`, err);
      const retryDelayMs = registry.settle(tagName, "failure");
      const attempt = registry.getAttempt(tagName); // see open question below
      dispatch("islands:error", { tag: tagName, error: err, attempt });
      if (retryDelayMs !== null) {
        setTimeout(run, retryDelayMs);
      }
    });
};
```

### `customElementFilter`
```ts
const customElementFilter: NodeFilter = {
  acceptNode(node) {
    const tag = (node as Element).tagName;
    if (!tag.includes("-")) return NodeFilter.FILTER_SKIP;
    if (registry.isBlockedBy(tag.toLowerCase())) return NodeFilter.FILTER_REJECT;
    return NodeFilter.FILTER_ACCEPT;
  },
};
```

### `handleRemovals()`
```ts
function handleRemovals(_mutations: MutationRecord[]): void {
  registry.cancelDetached();
}
```

The `mutations` parameter is no longer needed — `cancelDetached()` owns the `isConnected`
scan and the `pendingCancellable.size === 0` fast-path guard.

### `visible()` / `interaction()` — arming cancellables
```ts
// Inside visible():
io.observe(element);
registry.watchCancellable(element, () => { io.disconnect(); reject(); });

// On resolve — no explicit delete needed. cancelDetached() only fires on
// !isConnected elements, so resolved elements are never cancelled.
```

## Open Question

`settle("failure")` returns the next retry delay but not the current attempt number.
The `islands:error` dispatch needs the attempt number. Two options:

1. Add `settle(tag, "failure"): { retryDelayMs: number | null; attempt: number }` — richer
   return type, no separate getter.
2. Add `getAttempt(tag): number` getter — one extra entry point.

Option 1 is preferred — the return value already communicates "here is what to do next",
and bundling `attempt` in is natural. Resolve before implementing.

## What This Fixes

| Bug / invariant | Before | After |
|---|---|---|
| `retryCount` keys ⊆ `queued` | enforced by call-site discipline | enforced structurally — `settle()` is the only mutation path |
| `queued.delete` on retry exhaustion | must be remembered at every call site | falls out of `settle("failure") → null` |
| `loaded.add` + `retryCount.delete` on success | two separate calls | atomic in `settle("success")` |
| `isConnected` scan in `handleRemovals` | duplicated in caller | owned by `cancelDetached()` |
| `pending.delete` on resolve | required in both resolve and cancel paths | cancel path only; resolved elements are never cancelled |

## Designs Considered

### Minimal (recommended basis)
Seven methods grouped by concern: tag lifecycle (`queue`, `settle`, `isBlockedBy`),
init sequencing (`initDone`, `markInitDone`), cancellable elements (`watchCancellable`,
`cancelDetached`). `settle` is overloaded to return different types per outcome.

### Flexible (IslandStateManager + hooks)
Full hook system: `on("island:queued", handler)`, `on("island:loaded", handler)`, etc.
Exposes `_mutate` as a private-by-convention mutation handle alongside the public query
surface. Snapshot emitted on every hook call. Enables devtools/telemetry without touching
runtime internals. Rejected as over-engineered for current needs — hook system adds
meaningful complexity no current consumer requires.

### Common-caller optimised
`has(tag)` collapses the `queued || loaded` check into one call — both `activate()` and
`customElementFilter` reduce to `if (!registry.has(tag))`. `queue()` returning `false` on
conflict (borrowed into recommendation). `cancelPendingAll(iterable)` for bulk teardown.
The `has()` naming was less precise than `queue()` returning a boolean; otherwise the
designs converge.
