---
name: vite-plugin-shopify-theme-islands/directives
description: >
  Built-in client directives: client:visible (IntersectionObserver, rootMargin),
  client:media (matchMedia query), client:idle (requestIdleCallback),
  client:defer (setTimeout delay). Combining directives uses AND semantics —
  all must resolve. Per-element value overrides. Empty client:media warning.
type: core
library: vite-plugin-shopify-theme-islands
library_version: "1.0.0"
sources:
  - Rees1993/vite-plugin-shopify-theme-islands:src/runtime.ts
  - Rees1993/vite-plugin-shopify-theme-islands:src/index.ts
---

## Setup

Add one or more directives as HTML attributes on any custom element:

```html
<!-- Load when element scrolls into view (200px pre-load margin by default) -->
<product-form client:visible></product-form>

<!-- Load when CSS media query matches -->
<mobile-nav client:media="(max-width: 768px)"></mobile-nav>

<!-- Load during browser idle time -->
<site-footer client:idle></site-footer>

<!-- Load after a fixed delay (ms) -->
<chat-widget client:defer="5000"></chat-widget>
```

No JS changes needed — the runtime reads these attributes during DOM walk.

## Core Patterns

### Combining directives — all conditions must pass

```html
<!-- Loads only when BOTH visible AND the media query match -->
<product-recommendations
  client:visible
  client:media="(min-width: 768px)"
></product-recommendations>
```

Combined directives are AND-latched. The island loads only after every condition resolves. There is no OR mode.

### Per-element value overrides

```html
<!-- Override global rootMargin for this element only -->
<hero-banner client:visible="0px"></hero-banner>

<!-- Override global idle timeout for this element (ms) -->
<analytics-widget client:idle="2000"></analytics-widget>

<!-- Fixed delay in ms; empty attribute uses the global default (3000ms) -->
<chat-widget client:defer="8000"></chat-widget>
```

The attribute value overrides the globally configured default for that element. Other elements are unaffected.

### `client:defer` without a value uses the global default

```html
<!-- Uses global defer.delay (default 3000ms) -->
<chat-widget client:defer></chat-widget>

<!-- Uses 0ms delay — loads on next tick -->
<chat-widget client:defer="0"></chat-widget>
```

An empty `client:defer` attribute is NOT zero — it falls back to the configured `defer.delay` (default 3000ms).

### Changing built-in directive defaults globally

```ts
// vite.config.ts
shopifyThemeIslands({
  directives: {
    visible: { rootMargin: "0px" },
    defer: { delay: 5000 },
  },
});
```

## Common Mistakes

### HIGH `client:media=""` skips the media check entirely

Wrong:

```html
<mobile-nav client:media=""></mobile-nav>
```

Correct:

```html
<mobile-nav client:media="(max-width: 768px)"></mobile-nav>
```

An empty `client:media` value emits a console warning and skips the media check — the island loads immediately. Provide a valid media query string.

Source: src/runtime.ts — `if (query === "")` branch

### HIGH Multiple directives are AND, not OR

Wrong assumption:

```html
<!-- Expecting: load when visible OR when media matches -->
<product-recs client:visible client:media="(min-width: 768px)"></product-recs>
```

Correct understanding:

```html
<!-- Loads only when BOTH visible AND media match -->
<product-recs client:visible client:media="(min-width: 768px)"></product-recs>
```

The runtime awaits each directive sequentially. There is no way to express OR semantics with built-in directives — use a custom directive for that.

Source: src/runtime.ts — loadIsland sequential awaits

### MEDIUM `client:defer` without value ≠ immediate load

Wrong:

```html
<!-- Expecting 0ms or immediate load -->
<chat-widget client:defer></chat-widget>
```

Correct:

```html
<!-- Explicit 0ms for immediate load after current call stack -->
<chat-widget client:defer="0"></chat-widget>
```

`client:defer` with no value uses the global `defer.delay` default (3000ms). `parseInt("", 10)` produces `NaN`, which the runtime replaces with the configured default.

Source: src/runtime.ts — `const ms = Number.isNaN(raw) ? deferDelay : raw`

### MEDIUM Per-element visible value replaces rootMargin, not adds to it

Wrong:

```html
<!-- Expecting 200px (global) + 100px = 300px effective margin -->
<hero-banner client:visible="100px"></hero-banner>
```

Correct:

```html
<!-- "100px" replaces the global rootMargin entirely -->
<hero-banner client:visible="100px"></hero-banner>
```

The attribute value is passed directly to `IntersectionObserver` as `rootMargin`, fully replacing the global default.

Source: src/runtime.ts — `await visible(el, visibleAttr || rootMargin, threshold, pendingVisible)`
