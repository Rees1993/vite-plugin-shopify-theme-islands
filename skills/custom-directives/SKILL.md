---
name: custom-directives
description: >
  Custom client directives registered via directives.custom in vite.config.ts.
  ClientDirective function signature (load, options, el, ctx). AND-latch: when
  multiple custom directives match the same element, all must call load() before
  the island activates. Error handling — thrown errors, rejected promises, and
  directiveTimeout expiry fire islands:error. Custom directives run after all
  built-in conditions resolve. Matched directives now receive teardown-aware
  cleanup via ctx.signal and ctx.onCleanup(). Matching is resolved by
  src/directive-spine.ts; cleanup, AND-latch, and timeout policy are owned by
  src/activation-session.ts.
type: core
library: vite-plugin-shopify-theme-islands
library_version: "2.0.0"
sources:
  - Rees1993/vite-plugin-shopify-theme-islands:src/contract.ts
  - Rees1993/vite-plugin-shopify-theme-islands:src/directive-spine.ts
  - Rees1993/vite-plugin-shopify-theme-islands:src/activation-session.ts
  - Rees1993/vite-plugin-shopify-theme-islands:src/config-policy.ts
  - Rees1993/vite-plugin-shopify-theme-islands:src/index.ts
  - Rees1993/vite-plugin-shopify-theme-islands:src/runtime.ts
---

## Setup

```ts
// src/directives/hash.ts
import type { ClientDirective } from "vite-plugin-shopify-theme-islands";

const hashDirective: ClientDirective = (load, opts, _el, ctx) => {
  const target = opts.value;
  if (location.hash === target) { load(); return; }
  const onHashChange = () => {
    if (location.hash === target) load();
  };
  window.addEventListener("hashchange", onHashChange);
  ctx.onCleanup(() => window.removeEventListener("hashchange", onHashChange));
};

export default hashDirective;
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
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
  ClientDirectiveContext,
  ClientDirectiveLoader,
  ClientDirectiveOptions,
} from "vite-plugin-shopify-theme-islands";

const myDirective: ClientDirective = (
  load: ClientDirectiveLoader,   // call this to trigger the island load
  options: ClientDirectiveOptions, // { name: "client:my-attr", value: "..." }
  el: HTMLElement,               // the island element
  ctx: ClientDirectiveContext,   // teardown-aware cleanup + cancellation
) => {
  // Set up your condition, then call load() when ready
  const onClick = () => void load();
  el.addEventListener("click", onClick, { once: true });
  ctx.onCleanup(() => el.removeEventListener("click", onClick));
};
```

### Read the attribute value

```ts
const timedDirective: ClientDirective = (load, options, _el, ctx) => {
  const ms = parseInt(options.value, 10) || 2000;
  const timer = setTimeout(() => void load(), ms);
  ctx.onCleanup(() => clearTimeout(timer));
};
```

`options.value` is the attribute value, or `""` if the attribute has no value.

### Async directive

```ts
const networkDirective: ClientDirective = async (load, _opts, _el, ctx) => {
  if (ctx.signal.aborted) return;
  await fetch("/api/check-feature", { signal: ctx.signal });
  await load();
};
```

The directive function can be async. Unhandled rejections fire the document-level `islands:error` event, so `onIslandError()` observers still see directive failures.

### Timeout guard for hung directives

```ts
shopifyThemeIslands({
  directiveTimeout: 5000,
});
```

If a matched custom directive never calls `load()`, the runtime normally waits forever. Setting `directiveTimeout` turns that hang into an `islands:error` event and abandons the activation attempt after the configured delay.

### Cleanup-aware directives

```ts
const mediaDirective: ClientDirective = (load, _opts, el, ctx) => {
  const onFocus = () => void load();
  el.addEventListener("focusin", onFocus, { once: true });
  ctx.onCleanup(() => el.removeEventListener("focusin", onFocus));
};
```

Use `ctx.onCleanup()` for any listener, timer, observer, or subscription the directive creates. The runtime calls those cleanups when the directive resolves, the subtree is `unobserve()`d, the shared runtime `disconnect()`s, or the element is removed before the directive resolves.

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

No immediate error is thrown by default, so the island is silently never loaded unless you configure `directiveTimeout`.

Source: src/directive-spine.ts and src/activation-session.ts — matched custom directives own the `run()` call path

### HIGH Directive creates side effects without cleanup

Wrong:

```ts
const myDirective: ClientDirective = (load) => {
  window.addEventListener("resize", () => {
    if (window.innerWidth > 1200) load();
  });
};
```

Correct:

```ts
const myDirective: ClientDirective = (load, _opts, _el, ctx) => {
  const onResize = () => {
    if (window.innerWidth > 1200) void load();
  };
  window.addEventListener("resize", onResize);
  ctx.onCleanup(() => window.removeEventListener("resize", onResize));
};
```

Without cleanup, the directive can keep listeners or timers alive after subtree teardown.

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

Source: src/activation-session.ts — built-in interaction handling covers the hover/touch/focus pattern

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

Source: src/activation-session.ts — `let remaining = matched.length`

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

Source: src/config-policy.ts — validateOptions() duplicate and built-in conflict checks

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

Source: src/index.ts — `this.resolve(entrypoint)` throws on null during revive bootstrap planning

### MEDIUM Custom directives run after all built-in directive awaits

Wrong expectation:

```html
<!-- Expecting custom directive to intercept before client:visible -->
<cart-drawer client:visible client:auth></cart-drawer>
```

The runtime awaits built-ins in order (`visible → media → idle → defer → interaction`) first, then passes control to matched custom directives. Custom directives cannot short-circuit or replace built-in awaits.

Source: src/activation-session.ts — `runBuiltInDirectives()` completes before `runCustomDirectives()`

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

Source: src/activation-session.ts — `loadOnce` guard (`if (fired || aborted) return Promise.resolve()`)
