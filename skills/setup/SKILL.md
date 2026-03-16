---
name: setup
description: >
  Plugin install and vite.config.ts configuration. Covers shopifyThemeIslands()
  options: directories (string | string[]), debug, directives deep-merge, and
  retry (retries, delay with exponential backoff). Load when configuring the
  plugin, setting island scan directories, or enabling retry.
type: core
library: vite-plugin-shopify-theme-islands
library_version: "1.0.0"
sources:
  - Rees1993/vite-plugin-shopify-theme-islands:src/index.ts
---

## Setup

```ts
// vite.config.ts
import { defineConfig } from "vite";
import shopifyThemeIslands from "vite-plugin-shopify-theme-islands";

export default defineConfig({
  plugins: [
    shopifyThemeIslands({
      directories: ["/frontend/js/islands/"],
      debug: false,
      retry: { retries: 2, delay: 500 },
    }),
  ],
});
```

Import the virtual module in the theme JS entry point to activate islands:

```ts
// frontend/js/theme.ts
import "vite-plugin-shopify-theme-islands/revive";
```

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

`directives` accepts only `visible`, `idle`, `media`, `defer`, and `custom`. `retry` at `directives.retry` is silently ignored.

Source: src/index.ts:ShopifyThemeIslandsOptions

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

Source: src/index.ts:RetryConfig
