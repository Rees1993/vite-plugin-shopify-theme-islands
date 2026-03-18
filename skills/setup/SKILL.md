---
name: setup
description: >
  Getting-started journey and plugin configuration. Covers the full path from
  install to first working island. shopifyThemeIslands() options: directories
  (string | string[]), debug, directives deep-merge (visible, idle, media,
  defer, interaction, custom), retry (retries, delay with exponential backoff),
  and directiveTimeout (ms before a silent custom directive hang fires
  islands:error). Load when setting up the plugin, configuring island scan
  directories, enabling retry, or enabling directive timeout.
type: core
library: vite-plugin-shopify-theme-islands
library_version: "1.2.0"
sources:
  - Rees1993/vite-plugin-shopify-theme-islands:src/index.ts
  - Rees1993/vite-plugin-shopify-theme-islands:src/contract.ts
---

## Setup

This plugin is framework-agnostic but designed for Shopify themes. Most Shopify
projects also use
[vite-plugin-shopify](https://github.com/barrel/vite-plugin-shopify) to handle
Shopify-specific asset serving — if the project uses it, add this plugin
alongside it in the existing `plugins` array.

### 1. Add the plugin to `vite.config.ts`

```ts
// vite.config.ts
import { defineConfig } from "vite";
import shopifyThemeIslands from "vite-plugin-shopify-theme-islands";

export default defineConfig({
  plugins: [shopifyThemeIslands()],
});
```

All options are optional. The default islands directory is `/frontend/js/islands/`.

### 2. Import the virtual module in the theme JS entry point

```ts
// frontend/js/theme.ts
import "vite-plugin-shopify-theme-islands/revive";
```

This activates the runtime — islands are never loaded without this import.

### 3. Add directives to Liquid templates

```html
<!-- sections/product.liquid -->
<product-form client:visible></product-form>
```

That's a working setup. Islands in `/frontend/js/islands/` matching the tag
name are loaded lazily when the directive condition is met.

## Core Patterns

### Configure multiple island directories

```ts
shopifyThemeIslands({
  directories: ["/frontend/js/islands/", "/frontend/js/components/"],
});
```

### Override built-in directive defaults

```ts
shopifyThemeIslands({
  directives: {
    visible: { rootMargin: "0px", threshold: 0.5 },
    idle: { timeout: 2000 },
    defer: { delay: 5000 },
    interaction: { events: ["mouseenter"] },
  },
});
```

Per-directive options are deep-merged — overriding `visible.rootMargin` preserves `visible.threshold` at its default of `0`.

### Enable automatic retry with exponential backoff

```ts
shopifyThemeIslands({
  retry: { retries: 3, delay: 1000 },
});
```

`retries` is the number of attempts after the first failure. `delay` is the base ms — each subsequent retry doubles it (1000ms → 2000ms → 4000ms).

### Enable custom directive timeout

```ts
shopifyThemeIslands({ directiveTimeout: 5000 });
```

If a custom directive never calls `load()`, the island silently hangs forever by default. Setting `directiveTimeout` starts a timer when entering the AND latch. If the latch hasn't resolved when it fires, `islands:error` is dispatched and the island is abandoned.

Default: `0` (disabled — no timeout, existing behaviour preserved).

### Enable console debug output

```ts
shopifyThemeIslands({ debug: true });
```

Logs discovered islands, active directives per element, and load/error events at startup.

## Common Mistakes

### CRITICAL Virtual module not imported — islands never activate

Wrong:

```ts
// vite.config.ts — plugin configured but virtual module never imported
shopifyThemeIslands({ directories: ["/frontend/js/islands/"] });
```

Correct:

```ts
// frontend/js/theme.ts
import "vite-plugin-shopify-theme-islands/revive";
```

The plugin generates the virtual module but has no effect until it is imported in the browser entry point. Islands are silently never activated.

Source: src/index.ts — VIRTUAL_ID / RESOLVED_ID

### HIGH Agent hardcodes default values — unnecessary noise

Wrong:

```ts
shopifyThemeIslands({
  directories: ["/frontend/js/islands/"],
  debug: false,
  directives: {
    visible: { attribute: "client:visible", rootMargin: "200px", threshold: 0 },
    idle: { attribute: "client:idle", timeout: 500 },
    media: { attribute: "client:media" },
    defer: { attribute: "client:defer", delay: 3000 },
    interaction: { attribute: "client:interaction", events: ["mouseenter", "touchstart", "focusin"] },
  },
});
```

Correct:

```ts
shopifyThemeIslands();
```

All options are optional and default to sensible values. Only include options that differ from the defaults.

### HIGH Agent overwrites existing `vite.config.ts` instead of appending

Before adding the plugin, read the existing `vite.config.ts`. Projects commonly
already have `vite-plugin-shopify` or other plugins — the island plugin must be
added to the existing `plugins` array, not replace it.

Wrong:

```ts
// Replaces existing plugins
export default defineConfig({
  plugins: [shopifyThemeIslands()],
});
```

Correct:

```ts
// Appends to existing plugins
export default defineConfig({
  plugins: [
    shopify(), // pre-existing plugin preserved
    shopifyThemeIslands(),
  ],
});
```

### HIGH `retry` nested inside `directives` — no retries happen

Wrong:

```ts
shopifyThemeIslands({
  directives: {
    retry: { retries: 2 }, // ← wrong nesting
  },
});
```

Correct:

```ts
shopifyThemeIslands({
  retry: { retries: 2 }, // ← top-level option
});
```

`directives` accepts only `visible`, `idle`, `media`, `defer`, `interaction`, and `custom`. `retry` at `directives.retry` is silently ignored.

Source: src/index.ts — ShopifyThemeIslandsOptions

### HIGH Wrong key name for retry count

Wrong:

```ts
shopifyThemeIslands({ retry: { count: 3 } });
shopifyThemeIslands({ retry: { attempts: 3 } });
```

Correct:

```ts
shopifyThemeIslands({ retry: { retries: 3 } });
```

Unknown keys are silently ignored. The correct field is `retries`.

Source: src/contract.ts — RetryConfig

### HIGH `directiveTimeout` nested inside `directives` or `retry` — timeout never applies

Wrong:

```ts
shopifyThemeIslands({
  directives: {
    directiveTimeout: 5000, // ← wrong nesting
  },
});
```

Correct:

```ts
shopifyThemeIslands({
  directiveTimeout: 5000, // ← top-level option
});
```

`directiveTimeout` is a top-level option on `ShopifyThemeIslandsOptions`. Nesting it anywhere else is silently ignored.

Source: src/index.ts — ShopifyThemeIslandsOptions
