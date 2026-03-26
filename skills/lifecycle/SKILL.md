---
name: lifecycle
description: >
  Island lifecycle events, subtree helpers, and teardown. onIslandLoad and onIslandError
  helpers from vite-plugin-shopify-theme-islands/events — prefer these over
  raw document.addEventListener for guaranteed type safety. Raw DOM events
  islands:load and islands:error on document. islands:load detail includes tag,
  duration (ms), and attempt (1-based). islands:error detail includes tag,
  error, and attempt, including custom directive failures and directiveTimeout
  expiry. `./revive` now exports scan(), observe(), unobserve(), and disconnect().
  disconnect() prevents init from ever starting if called early. Startup, DOM walking, mutation observation, and
  parent/child activation gating are now owned by src/lifecycle.ts, while
  runtime observability and event dispatch are now routed through
  src/runtime-observability.ts and src/runtime-surface.ts.
  Shopify section and block lifecycle events are bridged into the shared runtime by default.
type: core
library: vite-plugin-shopify-theme-islands
library_version: "1.3.2"
sources:
  - Rees1993/vite-plugin-shopify-theme-islands:src/events.ts
  - Rees1993/vite-plugin-shopify-theme-islands:src/runtime-observability.ts
  - Rees1993/vite-plugin-shopify-theme-islands:src/runtime-surface.ts
  - Rees1993/vite-plugin-shopify-theme-islands:src/lifecycle.ts
  - Rees1993/vite-plugin-shopify-theme-islands:src/contract.ts
  - Rees1993/vite-plugin-shopify-theme-islands:src/runtime.ts
  - Rees1993/vite-plugin-shopify-theme-islands:src/revive-module.ts
---

## Setup

```ts
import { onIslandLoad, onIslandError } from "vite-plugin-shopify-theme-islands/events";

const offLoad = onIslandLoad(({ tag, duration, attempt }) => {
  console.log("loaded:", tag, `${duration.toFixed(1)}ms`, `attempt ${attempt}`);
});

const offError = onIslandError(({ tag, error, attempt }) => {
  console.error("failed:", tag, `attempt ${attempt}`, error);
});

// Remove listeners when no longer needed
offLoad();
offError();
```

## Core Patterns

### Track island load for analytics

```ts
import { onIslandLoad } from "vite-plugin-shopify-theme-islands/events";

onIslandLoad(({ tag, duration, attempt }) => {
  analytics.track("island_loaded", { component: tag, duration, attempt });
});
```

`tag` is the lowercased custom element tag name (e.g. `"product-form"`). `duration` is the time in milliseconds from when all directives resolved to when the module finished loading. `attempt` is 1 on the first successful load, 2 if it succeeded on the first retry, etc.

### Track load performance

```ts
import { onIslandLoad } from "vite-plugin-shopify-theme-islands/events";

onIslandLoad(({ tag, duration }) => {
  if (duration > 3000) {
    performance.mark(`island-slow:${tag}`);
  }
});
```

`duration` measures only the chunk fetch time — time spent waiting on directives (e.g. `client:visible`) is not included.

### Report errors to a monitoring service

```ts
import { onIslandError } from "vite-plugin-shopify-theme-islands/events";

onIslandError(({ tag, error, attempt }) => {
  Sentry.captureException(error, { extra: { island: tag, attempt } });
});
```

`onIslandError` fires on each retry attempt, on custom directive failures, and when `directiveTimeout` expires. `attempt` tells you which attempt failed — 1 is the initial load, 2 is the first retry, etc.

### Subtree control and teardown

```ts
import { disconnect, observe, scan, unobserve } from "vite-plugin-shopify-theme-islands/revive";

scan(container);
observe(container);
unobserve(container);

// Before navigating away / unmounting the page
disconnect();
```

`disconnect()` stops the shared runtime entirely. `unobserve(root)` is the narrower tool: it pauses one subtree and cancels pending built-in waits, retries, and custom directive cleanup inside it. If the runtime has not initialized yet because the document is still loading, `disconnect()` also unregisters the pending DOMContentLoaded startup listener so init never runs later.

The startup walk itself is now lifecycle-owned. The runtime resolves the root lazily at init time, then the lifecycle coordinator performs the initial walk, begins observing subtree additions, and keeps child islands gated behind queued parents until the parent resolves.

Load/error events and debug-ready groups are dispatched through the runtime surface, but the user-facing lifecycle behavior remains the same: startup is lazy, activation is subtree-aware, and teardown prevents later observation.

### Raw DOM events (when type augmentation is in scope)

```ts
// DocumentEventMap augmentation is exported from the main package
import type {} from "vite-plugin-shopify-theme-islands";

document.addEventListener("islands:load", (e) => {
  console.log(e.detail.tag, e.detail.duration, e.detail.attempt);
});
```

The `DocumentEventMap` augmentation is declared in `contract.ts` and re-exported via the main package entry. It is only in scope when the import is present in the same tsconfig compilation.

## Common Mistakes

### HIGH Raw `addEventListener` without types — `e.detail` is untyped

Wrong:

```ts
// No import from the package — e is Event, detail is unknown
document.addEventListener("islands:load", (e) => {
  console.log(e.detail.tag); // TypeScript error or any
});
```

Correct:

```ts
import { onIslandLoad } from "vite-plugin-shopify-theme-islands/events";

onIslandLoad(({ tag }) => {
  console.log(tag); // string, always typed
});
```

`onIslandLoad` and `onIslandError` are typed unconditionally regardless of tsconfig setup. Use them instead of raw `document.addEventListener` unless the `DocumentEventMap` augmentation is confirmed to be in scope.

Source: src/events.ts

### CRITICAL lifecycle helpers imported from wrong entry point

Wrong:

```ts
import { disconnect } from "vite-plugin-shopify-theme-islands/island";
```

Correct:

```ts
import { disconnect, scan, observe, unobserve } from "vite-plugin-shopify-theme-islands/revive";
```

Only the virtual module (`/revive`) exports the shared helper surface bound to the plugin-managed runtime instance.

Source: src/revive-module.ts — buildReviveModuleSource() emits `export const { disconnect } = _islands(payload)`

### MEDIUM `onIslandError` fires on every retry, not just final failure

Wrong:

```ts
onIslandError(({ tag }) => {
  // Assuming this fires once when the island permanently fails
  markIslandBroken(tag);
});
```

Correct:

```ts
onIslandError(({ tag, error, attempt }) => {
  // attempt === 1 is the first failure; higher values are retries
  if (attempt === 1) {
    reportFirstFailure(tag, error);
  }
});
```

With `retry: { retries: 3 }`, a single island can fire `islands:error` up to 4 times before exhausting retries. Use `attempt` to distinguish the initial failure from retries.

Source: src/runtime.ts — runtimeSurface.dispatchError(...) inside the loader failure path before retry check

### MEDIUM `islands:error` fires for custom directive failures too

Wrong assumption:

```ts
onIslandError(({ tag, error }) => {
  // Assuming this only fires for failed dynamic import()
  reportChunkLoadFailure(tag);
});
```

`islands:error` fires when any custom directive throws, rejects, or times out, not only when the island module's `import()` fails. The `error` value may be a directive error rather than a network or chunk error.

Source: src/runtime.ts — handleDirectiveError dispatches `islands:error`

### LOW Removed elements waiting on `client:visible` / `client:interaction` do not emit `islands:error`

If an element is removed from the DOM before a cancellable built-in directive resolves, the lifecycle coordinator cancels that activation attempt and the runtime treats it as expected teardown. No `islands:error` event is dispatched.

Source: src/lifecycle.ts — cancelDetached() with watchCancellable() ownership
