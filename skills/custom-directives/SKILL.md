---
name: custom-directives
description: >
  Custom client directives registered via directives.custom in vite.config.ts.
  ClientDirective function signature (load, options, el). AND-latch: when
  multiple custom directives match the same element, all must call load() before
  the island activates. Error handling — thrown errors, rejected Promises, and
  directiveTimeout expiry fire islands:error. Custom directives run after all
  built-in conditions resolve.
type: core
library: vite-plugin-shopify-theme-islands
library_version: "1.2.0"
sources:
  - Rees1993/vite-plugin-shopify-theme-islands:src/contract.ts
  - Rees1993/vite-plugin-shopify-theme-islands:src/index.ts
  - Rees1993/vite-plugin-shopify-theme-islands:src/runtime.ts
---

## Setup

```ts
// src/directives/hash.ts
import type { ClientDirective } from "vite-plugin-shopify-theme-islands";

const hashDirective: ClientDirective = (load, opts) => {
  const target = opts.value;
  if (location.hash === target) { load(); return; }
  window.addEventListener("hashchange", () => {
    if (location.hash === target) load();
  });
};

export default hashDirective;
```

```ts
// vite.config.ts
import shopifyThemeIslands from "vite-plugin-shopify-theme-islands";

export default defineConfig({
  plugins: [
    shopifyThemeIslands({
      directives: {
        custom: [
          {
            name: "client:hash",
            entrypoint: "./src/directives/hash.ts",
          },
        ],
      },
    }),
  ],
});
```

```html
<product-reviews client:hash="#reviews"></product-reviews>
```

## Core Patterns

### Directive signature

```ts
import type {
  ClientDirective,
  ClientDirectiveLoader,
  ClientDirectiveOptions,
} from "vite-plugin-shopify-theme-islands";

const myDirective: ClientDirective = (
  load: ClientDirectiveLoader,   // call this to trigger the island load
  options: ClientDirectiveOptions, // { name: "client:my-attr", value: "..." }
  el: HTMLElement,               // the island element
) => {
  // Set up your condition, then call load() when ready
  el.addEventListener("click", load, { once: true });
};
```

### Read the attribute value

```ts
const timedDirective: ClientDirective = (load, options, el) => {
  const ms = parseInt(options.value, 10) || 2000;
  setTimeout(load, ms);
};
```

`options.value` is the attribute value, or `""` if the attribute has no value.

### Async directive

```ts
const networkDirective: ClientDirective = async (load, _opts, el) => {
  await fetch("/api/check-feature");
  load();
};
```

The directive function can be async. Unhandled rejections fire the document-level `islands:error` event, so `onIslandError()` observers still see directive failures.

### AND-latch with multiple matching directives

```html
<product-form client:hash="#details" client:auth-check></product-form>
```

If both `client:hash` and `client:auth-check` are registered as custom directives and both match, **both** must call `load()` before the island activates. The runtime tracks a `remaining` counter; it reaches 0 only when every matched directive has called `load()`.

## Common Mistakes

### CRITICAL Directive never calls `load()` — island never activates

Wrong:

```ts
const myDirective: ClientDirective = (load, _opts, el) => {
  el.addEventListener("click", () => {
    console.log("clicked"); // forgot to call load
  });
};
```

Correct:

```ts
const myDirective: ClientDirective = (load, _opts, el) => {
  el.addEventListener("click", load, { once: true });
};
```

By default, no error is thrown and no timeout fires — the island is silently never loaded. If `directiveTimeout` is configured, `islands:error` fires after the configured milliseconds if the AND latch still has not resolved, and the island is abandoned.

Source: src/runtime.ts — `applyCustomDirectives` AND latch; `directiveTimeout` timer in same function

### HIGH Writing a custom directive for mouseenter/touchstart/focusin — use `client:interaction` instead

Wrong:

```ts
// Reimplementing what the built-in already does
const hoverDirective: ClientDirective = (load, _opts, el) => {
  el.addEventListener("mouseenter", load, { once: true });
};
```

Correct:

```html
<!-- Use the built-in client:interaction directive -->
<cart-flyout client:interaction></cart-flyout>

<!-- Or with a specific event -->
<cart-flyout client:interaction="mouseenter"></cart-flyout>
```

`client:interaction` is a built-in directive that handles `mouseenter`, `touchstart`, and `focusin`. Custom directives are for conditions the built-ins cannot express (e.g. URL hash matching, network conditions, feature flags).

Source: src/runtime.ts — `interaction()` built-in handles the hover/touch/focus pattern

### HIGH AND-latch: both matched directives must call `load()`

Wrong assumption:

```html
<product-form client:hash="#details" client:auth-check></product-form>
```

```ts
// Expecting: loads as soon as either hash or auth-check calls load()
```

Correct:

```ts
// Both client:hash AND client:auth-check must call load() before activation.
// remaining starts at 2; island fires when it reaches 0.
```

With two matching custom directives, `remaining = 2`. Each `load()` call decrements it. The island activates only when `remaining === 0`.

Source: src/runtime.ts — `let remaining = matched.length`

### HIGH Duplicate custom directive names or collisions with built-ins fail plugin setup

Wrong:

```ts
shopifyThemeIslands({
  directives: {
    visible: { attribute: "data:visible" },
    custom: [
      { name: "client:hash", entrypoint: "./src/directives/hash.ts" },
      { name: "data:visible", entrypoint: "./src/directives/other.ts" },
      { name: "client:hash", entrypoint: "./src/directives/duplicate.ts" },
    ],
  },
});
```

Correct:

```ts
shopifyThemeIslands({
  directives: {
    visible: { attribute: "data:visible" },
    custom: [{ name: "client:hash", entrypoint: "./src/directives/hash.ts" }],
  },
});
```

Custom directive names must be unique and must not collide with any built-in directive name, including renamed built-ins.

Source: src/index.ts — validateOptions duplicate and built-in conflict checks

### HIGH Entrypoint path missing `./` prefix

Wrong:

```ts
{
  name: "client:hash",
  entrypoint: "src/directives/hash.ts", // ← no ./
}
```

Correct:

```ts
{
  name: "client:hash",
  entrypoint: "./src/directives/hash.ts",
}
```

Custom directive entrypoints are resolved through Vite. Relative local files should usually use `./...`; unresolved entrypoints fail the build.

Source: src/index.ts — `this.resolve(def.entrypoint)` throws on null

### MEDIUM Custom directives run after all built-in directive awaits

Wrong expectation:

```html
<!-- Expecting custom directive to intercept before client:visible -->
<cart-drawer client:visible client:auth></cart-drawer>
```

The runtime awaits built-ins in order (`visible → media → idle → defer → interaction`) first, then passes control to matched custom directives. Custom directives cannot short-circuit or replace built-in awaits.

Source: src/runtime.ts — built-in awaits precede `if (customDirectives?.size)` block

### MEDIUM Calling `load()` multiple times has no effect after the first

Wrong:

```ts
const retryDirective: ClientDirective = (load, _opts, el) => {
  setInterval(load, 1000); // calls load every second
};
```

Correct:

```ts
const retryDirective: ClientDirective = (load, _opts, el) => {
  el.addEventListener("click", load, { once: true }); // fires once
};
```

The `loadOnce` wrapper ignores all calls after the first (`fired` guard). Use `{ once: true }` on event listeners to avoid unnecessary calls.

Source: src/runtime.ts — `if (fired || aborted) return Promise.resolve()`
