---
name: vite-plugin-shopify-theme-islands/custom-directives
description: >
  Custom client directives registered via directives.custom in vite.config.ts.
  ClientDirective function signature (load, options, el). AND-latch: when
  multiple custom directives match the same element, all must call load() before
  the island activates. Error handling — thrown errors fire islands:error.
type: core
library: vite-plugin-shopify-theme-islands
library_version: "1.0.0"
sources:
  - Rees1993/vite-plugin-shopify-theme-islands:src/index.ts
  - Rees1993/vite-plugin-shopify-theme-islands:src/runtime.ts
---

## Setup

```ts
// src/directives/hover.ts
import type { ClientDirective } from "vite-plugin-shopify-theme-islands";

const hoverDirective: ClientDirective = (load, _opts, el) => {
  el.addEventListener("mouseenter", load, { once: true });
};

export default hoverDirective;
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
            name: "client:hover",
            entrypoint: "./src/directives/hover.ts",
          },
        ],
      },
    }),
  ],
});
```

```html
<quick-add client:hover></quick-add>
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

The directive function can be async. Unhandled rejections fire `islands:error` on the element.

### AND-latch with multiple matching directives

```html
<product-form client:hover client:visible></product-form>
```

If both `client:hover` and `client:visible` are registered as custom directives and both match, **both** must call `load()` before the island activates. The runtime tracks a `remaining` counter; it reaches 0 only when every matched directive has called `load()`.

## Common Mistakes

### CRITICAL Directive never calls `load()` — island never activates

Wrong:

```ts
const hoverDirective: ClientDirective = (load, _opts, el) => {
  el.addEventListener("mouseenter", () => {
    console.log("hovered"); // forgot to call load
  });
};
```

Correct:

```ts
const hoverDirective: ClientDirective = (load, _opts, el) => {
  el.addEventListener("mouseenter", load, { once: true });
};
```

No error is thrown and no timeout fires — the island is silently never loaded.

Source: src/runtime.ts — directive owns the `run()` call path

### HIGH AND-latch: both matched directives must call `load()`

Wrong assumption:

```html
<product-form client:hover client:auth-check></product-form>
```

```ts
// Expecting: loads as soon as either hover or auth-check calls load()
```

Correct:

```ts
// Both client:hover AND client:auth-check must call load() before activation.
// remaining starts at 2; island fires when it reaches 0.
```

With two matching custom directives, `remaining = 2`. Each `load()` call decrements it. The island activates only when `remaining === 0`.

Source: src/runtime.ts — `let remaining = matched.length`

### HIGH Entrypoint path missing `./` prefix

Wrong:

```ts
{
  name: "client:hover",
  entrypoint: "src/directives/hover.ts", // ← no ./
}
```

Correct:

```ts
{
  name: "client:hover",
  entrypoint: "./src/directives/hover.ts",
}
```

Vite's resolver may fail to locate the file without the `./` relative prefix. The plugin throws a build error if the entrypoint cannot be resolved.

Source: src/index.ts — `this.resolve(def.entrypoint)` throws on null

### MEDIUM Custom directives run after built-in directive awaits

Wrong expectation:

```html
<!-- Expecting custom directive to intercept before client:visible -->
<cart-drawer client:visible client:auth></cart-drawer>
```

The runtime awaits `client:visible` first, then passes control to the `client:auth` custom directive. Custom directives cannot short-circuit or replace built-in awaits.

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
