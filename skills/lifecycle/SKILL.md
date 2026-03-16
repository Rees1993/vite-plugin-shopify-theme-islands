---
name: lifecycle
description: >
  Island lifecycle events and SPA teardown. onIslandLoad and onIslandError
  helpers from vite-plugin-shopify-theme-islands/events — prefer these over
  raw document.addEventListener for guaranteed type safety. Raw DOM events
  islands:load and islands:error on document. disconnect() from the virtual
  module revive for SPA navigation teardown.
type: core
library: vite-plugin-shopify-theme-islands
library_version: "1.0.2"
sources:
  - Rees1993/vite-plugin-shopify-theme-islands:src/events.ts
  - Rees1993/vite-plugin-shopify-theme-islands:src/index.ts
  - Rees1993/vite-plugin-shopify-theme-islands:src/runtime.ts
---

## Setup

```ts
import { onIslandLoad, onIslandError } from "vite-plugin-shopify-theme-islands/events";

const offLoad = onIslandLoad(({ tag }) => {
  console.log("loaded:", tag);
});

const offError = onIslandError(({ tag, error }) => {
  console.error("failed:", tag, error);
});

// Remove listeners when no longer needed
offLoad();
offError();
```

## Core Patterns

### Track island load for analytics

```ts
import { onIslandLoad } from "vite-plugin-shopify-theme-islands/events";

onIslandLoad(({ tag }) => {
  analytics.track("island_loaded", { component: tag });
});
```

`tag` is the lowercased custom element tag name (e.g. `"product-form"`).

### Report errors to a monitoring service

```ts
import { onIslandError } from "vite-plugin-shopify-theme-islands/events";

onIslandError(({ tag, error }) => {
  Sentry.captureException(error, { extra: { island: tag } });
});
```

`onIslandError` fires on each retry attempt and on custom directive failures. If retry is enabled, a single island may produce multiple error events before succeeding or exhausting retries.

### Teardown for SPA navigation

```ts
import { disconnect } from "vite-plugin-shopify-theme-islands/revive";

// Before navigating away / unmounting the page
disconnect();
```

`disconnect()` stops the MutationObserver and prevents new islands from activating. Call it before SPA page transitions to avoid activating islands from the previous page's DOM.

### Raw DOM events (when type augmentation is in scope)

```ts
// DocumentEventMap augmentation is exported from the main package
import type {} from "vite-plugin-shopify-theme-islands";

document.addEventListener("islands:load", (e) => {
  console.log(e.detail.tag); // typed as string
});
```

The `DocumentEventMap` augmentation is declared in the main package's `index.ts`. It is only in scope when the import is present in the same tsconfig compilation.

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

### CRITICAL `disconnect` imported from wrong entry point

Wrong:

```ts
import { disconnect } from "vite-plugin-shopify-theme-islands/runtime";
import { disconnect } from "vite-plugin-shopify-theme-islands/island";
```

Correct:

```ts
import { disconnect } from "vite-plugin-shopify-theme-islands/revive";
```

Only the virtual module (`/revive`) exports the `disconnect` bound to the plugin-managed `revive()` instance. Importing from other entry points references a different or nonexistent instance.

Source: src/index.ts — virtual module `export const { disconnect } = _islands(...)`

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
const seen = new Set<string>();
onIslandError(({ tag, error }) => {
  if (!seen.has(tag)) {
    seen.add(tag);
    reportFirstFailure(tag, error);
  }
});
```

With `retry: { retries: 3 }`, a single island can fire `islands:error` up to 4 times before exhausting retries. Deduplicate by `tag` if only the first failure matters.

Source: src/runtime.ts — `dispatch("islands:error", ...)` inside `.catch()` before retry check

### MEDIUM `islands:error` fires for custom directive failures too

Wrong assumption:

```ts
onIslandError(({ tag, error }) => {
  // Assuming this only fires for failed dynamic import()
  reportChunkLoadFailure(tag);
});
```

`islands:error` fires when any custom directive throws or rejects, not only when the island module's `import()` fails. The `error` value may be a directive error rather than a network or chunk error.

Source: src/runtime.ts — handleDirectiveError dispatches `islands:error`
