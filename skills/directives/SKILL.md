---
name: directives
description: >
  Built-in client directives: client:visible (IntersectionObserver, rootMargin),
  client:media (matchMedia query), client:idle (requestIdleCallback),
  client:defer (setTimeout delay), client:interaction (mouseenter/touchstart/focusin).
  Directives resolve sequentially — visible → media → idle → defer →
  interaction → custom. Per-element value overrides. Empty client:media
  warning. `client:idle` and `client:defer` require strict integer strings;
  invalid values warn and fall back. `client:interaction` validates per-element tokens at runtime:
  whitespace-only values warn and fall back; mixed supported/unsupported values
  warn and ignore the unsupported tokens; fully unsupported values warn and fall
  back to default events. Global `directives.interaction.events` config is
  intentionally narrowed to the curated set `mouseenter`, `touchstart`, and
  `focusin`. Implementation: src/directive-spine.ts (gates), src/directive-waiters.ts
  (built-in waits), src/activation-session.ts (sequencing, custom latch, loader).
type: core
library: vite-plugin-shopify-theme-islands
library_version: "2.0.0"
sources:
  - Rees1993/vite-plugin-shopify-theme-islands:src/directive-spine.ts
  - Rees1993/vite-plugin-shopify-theme-islands:src/directive-waiters.ts
  - Rees1993/vite-plugin-shopify-theme-islands:src/activation-session.ts
  - Rees1993/vite-plugin-shopify-theme-islands:src/runtime.ts
  - Rees1993/vite-plugin-shopify-theme-islands:src/contract.ts
  - Rees1993/vite-plugin-shopify-theme-islands:src/resolved-config.ts
  - Rees1993/vite-plugin-shopify-theme-islands:src/interaction-events.ts
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

<!-- Load on mouseenter, touchstart, or focusin (hover/touch/keyboard intent) -->
<cart-flyout client:interaction></cart-flyout>
```

No JS changes needed — the runtime reads these attributes during DOM walk.

## Core Patterns

### Combining directives — sequential resolution order

Directives resolve in a fixed order: `visible → media → idle → defer → interaction → custom`. Each condition is only evaluated after the previous one has passed.

```html
<!-- Loads when visible AND on interaction — interaction listeners only attach after scroll-in -->
<mega-menu client:visible client:interaction></mega-menu>

<!-- Loads when visible AND the media query matches -->
<product-recommendations client:visible client:media="(min-width: 768px)"></product-recommendations>
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

<!-- Override interaction events for this element only -->
<cart-flyout client:interaction="mouseenter"></cart-flyout>
```

The attribute value overrides the globally configured default for that element. Other elements are unaffected.
In config, `directives.interaction.events` is stricter and only accepts the curated package-owned list: `mouseenter`, `touchstart`, and `focusin`.
At runtime, per-element `client:interaction` values use that same curated set. Unsupported tokens are ignored with a warning; if no supported tokens remain, the runtime warns and falls back to the default interaction events.
For `client:idle` and `client:defer`, values like `"20ms"` are now invalid and fall back to the configured default timeout or delay.

### `client:defer` without a value uses the global default

```html
<!-- Uses global defer.delay (default 3000ms) -->
<chat-widget client:defer></chat-widget>

<!-- Uses 0ms delay — loads on next tick -->
<chat-widget client:defer="0"></chat-widget>
```

An empty `client:defer` attribute is NOT zero — it falls back to the configured `defer.delay` (default 3000ms).

### `client:interaction` with no value uses the default events

```html
<!-- Uses default events: mouseenter, touchstart, focusin -->
<cart-flyout client:interaction></cart-flyout>

<!-- Uses only mouseenter -->
<cart-flyout client:interaction="mouseenter"></cart-flyout>
```

An empty `client:interaction` attribute uses the configured default events with no warning. A whitespace-only value such as `client:interaction="   "` emits a warning and still falls back to the default events.

Source: src/directive-spine.ts and src/activation-session.ts — interaction token parsing and fallback warning

### Mixed supported and unsupported interaction tokens

```html
<!-- "click" is ignored with a warning; "mouseenter" still triggers load -->
<cart-flyout client:interaction="mouseenter click"></cart-flyout>

<!-- No supported tokens remain; warns and falls back to default events -->
<cart-flyout client:interaction="click submit"></cart-flyout>
```

Per-element values are no longer treated as an unconstrained event surface. The runtime filters them against the curated package-owned set.

### Changing built-in directive defaults globally

```ts
// vite.config.ts
shopifyThemeIslands({
  directives: {
    visible: { rootMargin: "0px" },
    defer: { delay: 5000 },
    interaction: { events: ["mouseenter"] },
  },
});
```

### Removed elements abort waiting directives silently

```html
<hero-banner client:visible></hero-banner> <cart-flyout client:interaction></cart-flyout>
```

If either element is removed from the DOM before its directive resolves, the runtime cancels that activation attempt and does not dispatch `islands:error`. This is expected teardown behavior, not a load failure.

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

Source: src/directive-spine.ts and src/activation-session.ts — empty media gate handling

### MEDIUM `client:idle` and `client:defer` do not accept suffix junk

Wrong:

```html
<analytics-widget client:idle="2000ms"></analytics-widget>
<chat-widget client:defer="3s"></chat-widget>
```

Correct:

```html
<analytics-widget client:idle="2000"></analytics-widget>
<chat-widget client:defer="3000"></chat-widget>
```

These attributes now require strict integer strings. Invalid values warn and fall back to the configured default timeout or delay.

### MEDIUM Whitespace-only `client:interaction` value warns and falls back

Wrong:

```html
<cart-flyout client:interaction="   "></cart-flyout>
```

Correct:

```html
<!-- Either omit the value entirely for defaults... -->
<cart-flyout client:interaction></cart-flyout>

<!-- ...or provide explicit event names -->
<cart-flyout client:interaction="mouseenter focusin"></cart-flyout>
```

Whitespace-only values are not treated the same as an empty attribute. The runtime warns and falls back to the configured default events.

Source: src/directive-spine.ts — interaction gate parsing and whitespace fallback

### MEDIUM Unsupported per-element interaction tokens are warned and ignored

Wrong:

```html
<cart-flyout client:interaction="mouseenter click"></cart-flyout>
```

Correct:

```html
<!-- Use only the curated supported tokens -->
<cart-flyout client:interaction="mouseenter focusin"></cart-flyout>
```

The runtime no longer attaches arbitrary listeners for unsupported per-element tokens. Supported tokens still work; unsupported ones are ignored with a warning. If no supported tokens remain, the runtime falls back to the configured default events.

Source: src/directive-spine.ts and src/activation-session.ts — supported/unsupported interaction token handling

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

Source: src/activation-session.ts — `runBuiltInDirectives()` runs built-ins before custom directives

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

Source: src/activation-session.ts — defer parsing and fallback to directives.defer.delay

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

Source: src/activation-session.ts — visible attribute value replaces directives.visible.rootMargin

### HIGH Directive attribute typo — island loads without condition

Wrong:

```html
<product-form client:visibled></product-form> <product-form client:Visible></product-form>
```

Correct:

```html
<product-form client:visible></product-form>
```

Directive attributes are case-sensitive. An unrecognised attribute is silently ignored — the island loads immediately as if no directive were set. No warning is emitted. Check for typos if an island activates earlier than expected.

Source: src/directive-spine.ts — built-ins read exact configured attribute names from the spine

### HIGH Unsupported interaction events in config fail plugin setup

Wrong:

```ts
shopifyThemeIslands({
  directives: {
    interaction: { events: ["click"] as never[] },
  },
});
```

Correct:

```ts
shopifyThemeIslands({
  directives: {
    interaction: { events: ["mouseenter", "focusin"] },
  },
});
```

The package now owns a curated interaction-event vocabulary for config. Supported values are `mouseenter`, `touchstart`, and `focusin`; unsupported names and empty arrays are rejected during config resolution.

Source: src/interaction-events.ts — validateInteractionEvents()

### HIGH Agent uses default attribute name when developer has configured a custom one

Wrong:

```html
<!-- developer has set visible.attribute: "data:visible" in vite.config.ts -->
<product-form client:visible></product-form>
```

Correct:

```html
<product-form data:visible></product-form>
```

When `directives.visible.attribute` (or any directive's `attribute` option) is overridden in `vite.config.ts`, all Liquid templates must use the configured name. The default `client:*` names no longer apply. Always read `vite.config.ts` to check for overridden attribute names before writing directives in Liquid.

Source: src/options.ts — `DirectivesConfig` `attribute` field per directive; src/directive-spine.ts reads configured attribute names at runtime
