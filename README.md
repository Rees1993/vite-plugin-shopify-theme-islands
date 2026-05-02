# vite-plugin-shopify-theme-islands

[![npm version](https://img.shields.io/npm/v/vite-plugin-shopify-theme-islands)](https://www.npmjs.com/package/vite-plugin-shopify-theme-islands)
[![npm downloads](https://img.shields.io/npm/dm/vite-plugin-shopify-theme-islands)](https://www.npmjs.com/package/vite-plugin-shopify-theme-islands)
[![license](https://img.shields.io/npm/l/vite-plugin-shopify-theme-islands)](./LICENSE)

Shopify-first island architecture for web components in Liquid themes. Lazily load custom element JavaScript only when it is actually needed.

## Installation

```bash
bun add -d vite-plugin-shopify-theme-islands
npm install -D vite-plugin-shopify-theme-islands
pnpm add -D vite-plugin-shopify-theme-islands
yarn add -D vite-plugin-shopify-theme-islands
```

## Quick start

Minimal end-to-end setup:

1. Add the plugin in `vite.config.ts`
2. Import `vite-plugin-shopify-theme-islands/revive` in your client entrypoint
3. Create a web component file and call `customElements.define("your-tag", ...)` inside it
4. Use that tag in Liquid, with a directive if you want lazy loading

```ts
// vite.config.ts
import { defineConfig } from "vite";
import shopifyThemeIslands from "vite-plugin-shopify-theme-islands";

export default defineConfig({
  plugins: [shopifyThemeIslands()],
});
```

```ts
// frontend/entrypoints/theme.ts
import "vite-plugin-shopify-theme-islands/revive";
```

```ts
// frontend/js/islands/product-form.ts
class ProductForm extends HTMLElement {
  connectedCallback() {
    // ...
  }
}

if (!customElements.get("product-form")) {
  customElements.define("product-form", ProductForm);
}
```

```liquid
<product-form client:visible></product-form>
```

That is enough to get a lazily loaded island working.

## Setup

### 1. Add the plugin to `vite.config.ts`

```ts
import { defineConfig } from "vite";
import shopifyThemeIslands from "vite-plugin-shopify-theme-islands";

export default defineConfig({
  plugins: [shopifyThemeIslands()],
});
```

### 2. Import the runtime in your entrypoint

```ts
import "vite-plugin-shopify-theme-islands/revive";
```

That's it. The plugin automatically scans your configured island directories, includes mixin-marked island files, and wires everything up.

The shared runtime also handles:

- dynamic DOM additions via `MutationObserver`
- Shopify Theme Editor section and block lifecycle events
- subtree teardown and reactivation through helpers exported from the same module

`./revive` is a shared page-level singleton. Importing it in multiple files does not create multiple runtimes; later named imports reuse the same runtime instance and helper surface.

If you need explicit control for partial swaps, drawers, or teardown, import the helpers from that same entrypoint:

```ts
import {
  disconnect,
  scan,
  observe,
  unobserve,
} from "vite-plugin-shopify-theme-islands/revive";

// Re-scan a subtree immediately
scan(container);

// Re-enable a subtree that was previously unobserved
observe(container);

// Pause a subtree and cancel pending work inside it
unobserve(container);

// Stop the shared runtime entirely
disconnect();
```

If `disconnect()` is called before `DOMContentLoaded`, the runtime also cancels its pending startup listener so islands never initialize later against stale DOM.

## Writing islands

Two approaches — use either or both.

Tag ownership is determined at build time:

- by default (`registeredTag` mode), from the `customElements.define("your-tag", ...)` call inside the file
- or with `tagSource: "filename"` (compatibility mode), from the filename — the v1.x behaviour
- `resolveTag()` is the final override layer in both modes

In `registeredTag` mode (the default), the plugin reads each Island file for a single static `customElements.define("...", ...)` call and uses that string as the Tag. This means filenames can use any casing — `CartDrawer.ts` can own `<cart-drawer>`. The plugin fails at compile time if an Island file has no readable Registered Tag, or more than one.

The resolved Tag must be unique across all discovered files. If two files resolve to the same Tag the plugin throws during the revive-module compile step so the ambiguity never reaches runtime.

### Directory scanning

Drop files into your islands directory and they're automatically picked up. The Tag is read from the static `customElements.define("your-tag", ...)` call inside the file, so the filename can use any casing.

```
frontend/js/islands/
  ProductForm.ts         →  <product-form>   (from define call)
  CartDrawer.ts          →  <cart-drawer>    (from define call)
  forms/CheckoutForm.ts  →  <checkout-form>  (from define call)
```

Subdirectories are supported. Any file in the directory becomes an island automatically.

```ts
// frontend/js/islands/CartDrawer.ts
class CartDrawer extends HTMLElement {
  connectedCallback() {
    // ...
  }
}

if (!customElements.get("cart-drawer")) {
  customElements.define("cart-drawer", CartDrawer);
}
```

### Island mixin

Mark any file as an island with the `Island` mixin, regardless of where it lives. Import it and extend from `Island(HTMLElement)` instead of `HTMLElement` — everything else stays identical.

```ts
// frontend/js/components/SiteFooter.ts
import Island from "vite-plugin-shopify-theme-islands/island";

class SiteFooter extends Island(HTMLElement) {
  connectedCallback() {
    // ...
  }
}

if (!customElements.get("site-footer")) {
  customElements.define("site-footer", SiteFooter);
}
```

The plugin detects the mixin import at build time and includes the file as a lazy island chunk — no directory config needed. The Tag is read from the static `customElements.define(...)` call, the same as for directory-scanned files.

### Which to use

|                   | Directory scanning                 | Island mixin                   |
| ----------------- | ---------------------------------- | ------------------------------ |
| File organisation | Dedicated islands directory        | Co-located anywhere            |
| Opt-in style      | Convention (everything in the dir) | Explicit (per file)            |
| Auditability      | One directory to check             | Search for `/island` import    |
| Build overhead    | None                               | Filesystem scan at build start |

Both can be used together — directory scanning for new islands, the mixin for existing components you want to adopt without moving.

### Child island cascade

Child islands nested inside a parent island are automatically held until the parent's module has loaded. The runtime re-walks the parent's subtree on success, so child islands activate with their normal directives intact — no extra configuration needed.

```html
<product-form client:visible>
  <!-- tab-switcher will not load until product-form has loaded -->
  <tab-switcher client:idle></tab-switcher>
</product-form>
```

## Directives

Add these attributes to your custom elements in Liquid to control when the JavaScript loads. Without a directive, the island loads immediately.

### Directive semantics

Directives gate **code loading at the tag level**.

- directives are authored on individual elements
- once a tag's module loads, matching elements upgrade normally through the Custom Elements registry
- if the same tag appears with conflicting gates, the first-resolved instance wins for that tag
- in `debug: true`, the runtime logs a warning once per tag when it sees conflicting same-tag gates

### `client:visible`

Loads the island when the element scrolls into view.

```html
<product-recommendations client:visible>
  <!-- ... -->
</product-recommendations>
```

The attribute value overrides the global `rootMargin` for that element only:

```html
<!-- load only once fully visible (no pre-load margin) -->
<product-recommendations client:visible="0px">
  <!-- ... -->
</product-recommendations>
```

### `client:media`

Loads the island when a CSS media query matches.

```html
<mobile-menu client:media="(max-width: 768px)">
  <!-- ... -->
</mobile-menu>
```

An empty attribute (`client:media=""`) logs a console warning and skips the media check — the island still loads.

### `client:idle`

Loads the island once the browser is idle (uses `requestIdleCallback` with a 500ms deadline, falls back to `setTimeout`).

```html
<recently-viewed client:idle>
  <!-- ... -->
</recently-viewed>
```

The attribute value overrides the global `timeout` for that element only:

```html
<!-- wait up to 2 seconds for idle time before loading -->
<recently-viewed client:idle="2000">
  <!-- ... -->
</recently-viewed>
```

If the attribute value is not a strict integer, the runtime logs a warning and falls back to the configured default timeout.

### `client:defer`

Loads the island after a fixed delay. The delay in milliseconds is read from the attribute value. If no value is given, the configured default (3000ms) is used.

```html
<chat-widget client:defer="3000">
  <!-- ... -->
</chat-widget>

<!-- uses the default 3000ms delay -->
<analytics-widget client:defer>
  <!-- ... -->
</analytics-widget>
```

Unlike `client:idle`, which waits for genuine browser idle time, `client:defer` always waits exactly the specified number of milliseconds.

If the attribute value is not a strict integer, the runtime logs a warning and falls back to the configured default delay.

### `client:interaction`

Loads the island when the user interacts with the element. Listens for `mouseenter`, `touchstart`, and `focusin` by default — the module starts downloading the moment the user moves their cursor toward or focuses the element.

```html
<cart-flyout client:interaction>
  <!-- ... -->
</cart-flyout>
```

The attribute value overrides the events for that element only:

```html
<!-- only mouseenter — touchstart and focusin are excluded -->
<cart-flyout client:interaction="mouseenter">
  <!-- ... -->
</cart-flyout>
```

In plugin config, `directives.interaction.events` is intentionally narrower than the raw HTML attribute surface. The typed config only accepts the curated package-owned set `mouseenter`, `touchstart`, and `focusin`, and rejects empty arrays.

Per-element `client:interaction="..."` values are also validated at runtime against that same curated set. Unsupported tokens log a warning and are ignored. If no supported tokens remain, the runtime logs a warning and falls back to the configured default interaction events instead of attaching unsupported listeners.

Combine with `client:visible` to avoid attaching listeners to off-screen elements. Because directives resolve sequentially, interaction listeners are only registered once the element has entered the viewport:

```html
<mega-menu client:visible client:interaction>
  <!-- loads when visible, then waits for hover/touch/focus -->
</mega-menu>
```

### Combining directives

Directives can be combined — the element works through each condition in sequence before loading. The resolution order is: `visible` → `media` → `idle` → `defer` → `interaction` → custom directives.

```html
<!-- must scroll into view, then wait for user interaction -->
<product-recommendations client:visible client:interaction>
  <!-- ... -->
</product-recommendations>

<!-- must scroll into view, then wait for idle time -->
<heavy-widget client:visible client:idle>
  <!-- ... -->
</heavy-widget>
```

Because conditions resolve sequentially, each directive is only evaluated after the previous one has passed. Interaction listeners, for example, are never attached to an element that isn't yet visible.

### Custom directives

Register your own loading conditions via `directives.custom`. A custom directive receives a `load` callback, the matched attribute metadata, the element, and a cleanup-aware runtime context.

#### 1. Write the directive

```ts
// src/directives/hash.ts
import type { ClientDirective } from "vite-plugin-shopify-theme-islands";

const hashDirective: ClientDirective = (load, opts, _el, ctx) => {
  const target = opts.value;
  if (location.hash === target) {
    void load();
    return;
  }

  const onHashChange = () => {
    if (location.hash === target) load();
  };

  window.addEventListener("hashchange", onHashChange);
  ctx.onCleanup(() => window.removeEventListener("hashchange", onHashChange));
};

export default hashDirective;
```

Useful for anchor-linked sections — `<product-reviews client:hash="#reviews">` loads only when the URL fragment matches, so deep-links like `/products/shirt#reviews` activate the island immediately while other visitors never load it.

The function signature is `(load, options, el, ctx) => void | Promise<void>`:

| Parameter       | Type                   | Description                                           |
| --------------- | ---------------------- | ----------------------------------------------------- |
| `load`          | `() => Promise<void>`  | Call this to trigger the island module load           |
| `options.name`  | `string`               | The matched attribute name, e.g. `'client:hash'`      |
| `options.value` | `string`               | The attribute value; empty string if no value was set |
| `el`            | `HTMLElement`          | The island element                                    |
| `ctx.signal`    | `AbortSignal`          | Aborted when the directive should stop waiting        |
| `ctx.onCleanup` | `(fn: () => void) => void` | Register cleanup work for abort or successful resolution |

Use `ctx.signal` with APIs that accept `AbortSignal`; otherwise register explicit teardown with `ctx.onCleanup()`.

#### 2. Register it in the plugin config

```ts
// vite.config.ts
import { defineConfig } from "vite";
import shopifyThemeIslands from "vite-plugin-shopify-theme-islands";

export default defineConfig({
  plugins: [
    shopifyThemeIslands({
      directives: {
        custom: [{ name: "client:hash", entrypoint: "./src/directives/hash.ts" }],
      },
    }),
  ],
});
```

The `entrypoint` supports Vite aliases.

#### 3. Use it in Liquid

```html
<product-reviews client:hash="#reviews">
  <!-- ... -->
</product-reviews>
```

#### Ordering

Built-in directives always run first. A custom directive is only invoked after all built-in conditions on the element have been met. This means you can gate a custom directive behind `client:visible` to avoid wiring event listeners for off-screen elements:

```html
<!-- element must enter the viewport before the hash handler is registered -->
<product-reviews client:visible client:hash="#reviews">
  <!-- ... -->
</product-reviews>
```

The custom directive owns the `load()` call — the built-in chain never calls it directly when a custom directive is matched.
If a custom directive throws or returns a rejected promise, the runtime dispatches `islands:error` and abandons that island activation attempt.
When a subtree is unobserved, removed, or the shared runtime disconnects, pending custom directives receive `ctx.signal.abort()` and registered cleanup functions are run once.

Multiple custom directives on the same element use AND semantics — the island loads only once all matched directives have called `load()`. For example, given two registered custom directives `client:hash` and `client:network`:

```html
<!-- client:visible runs first (built-in); then both client:hash and client:network must fire -->
<product-reviews client:visible client:hash="#reviews" client:network="4g">
  <!-- ... -->
</product-reviews>
```

#### Timeout guard

By default, a custom directive that never calls `load()` silently keeps the island unloaded forever. Set `directiveTimeout` to fire `islands:error` and abandon the island if the directive hasn't resolved within the given window:

```ts
shopifyThemeIslands({
  directiveTimeout: 5000, // abandon after 5 seconds
});
```

This is useful during development to surface directives that hang due to bugs, or in production to ensure broken directives don't silently degrade the experience.

## Configuration reference

### Top-level options

| Option             | Type                 | Default                     | Description                                                                        |
| ------------------ | -------------------- | --------------------------- | ---------------------------------------------------------------------------------- |
| `directories`      | `string \| string[]` | `['/frontend/js/islands/']` | Directories to scan for island files. Accepts Vite aliases.                        |
| `tagSource`        | `"registeredTag" \| "filename"` | `"registeredTag"` | Where each Island's Tag is derived from. `"registeredTag"` (default) reads the static `customElements.define("...", ...)` call. `"filename"` uses the filename — the v1.x compatibility mode. |
| `resolveTag`       | `({ filePath, defaultTag }) => string \| false` | —          | Override Tag derivation for specific files. `defaultTag` is the Registered Tag in `registeredTag` mode, or the filename-derived tag in `filename` mode. Return a string to override, `false` to exclude, or `defaultTag` to keep the default. Final Tag must be unique across all files. |
| `directives`       | `object`             | see below                   | Per-directive configuration — attribute names, timing options, and custom entries. |
| `retry`            | `object`             | `{ retries: 0, delay: 1000 }` | Automatic retry behaviour for failed island loads. See [Retries](#retries).      |
| `debug`            | `boolean`            | `false`                     | Log discovered islands at build time and directive events in the browser console.  |
| `directiveTimeout` | `number`             | `0` (disabled)              | Milliseconds before a custom directive that never calls `load()` is considered timed out. Fires `islands:error` and abandons the island. |

### Directive defaults

```ts
shopifyThemeIslands({
  directives: {
    visible: {
      attribute: "client:visible", // HTML attribute name
      rootMargin: "200px", // passed to IntersectionObserver — pre-loads before scrolling into view
      threshold: 0, // passed to IntersectionObserver — ratio of element that must be visible
    },
    idle: {
      attribute: "client:idle", // HTML attribute name
      timeout: 500, // deadline (ms) for requestIdleCallback; also the setTimeout fallback delay
    },
    media: {
      attribute: "client:media", // HTML attribute name
    },
    defer: {
      attribute: "client:defer", // HTML attribute name
      delay: 3000, // fallback delay (ms) when the attribute has no value
    },
    interaction: {
      attribute: "client:interaction", // HTML attribute name
      events: ["mouseenter", "touchstart", "focusin"], // curated config events that trigger load
    },
    custom: [], // custom directives — see Custom directives above
  },
});
```

All options are optional — only override what you need. Partial overrides preserve the other defaults:

```ts
// Only change rootMargin — attribute and threshold keep their defaults
shopifyThemeIslands({
  directives: {
    visible: { rootMargin: "400px" },
  },
});
```

For `directives.interaction.events`, supported config values are currently limited to `mouseenter`, `touchstart`, and `focusin`. Passing `[]` or unsupported names causes config resolution to fail.

### Multiple island directories

```ts
shopifyThemeIslands({
  directories: ["/frontend/js/islands/", "/frontend/js/components/"],
});
```

### Using Vite aliases

```ts
export default defineConfig({
  resolve: {
    alias: { "@islands": "/frontend/js/islands" },
  },
  plugins: [
    shopifyThemeIslands({
      directories: ["@islands/"],
    }),
  ],
});
```

### Overriding tag resolution

By default, the plugin reads the Tag from the static `customElements.define("your-tag", ...)` call in each Island file. Use `resolveTag()` when you need to override that for specific files — for example to rename a Tag without touching the source file, or to exclude a file entirely.

`resolveTag()` receives `{ filePath, defaultTag }` where `defaultTag` is the Registered Tag read from the file (in `registeredTag` mode) or the filename-derived tag (in `filename` mode). Return a string to override, `false` to exclude, or `defaultTag` to keep the default.

```ts
shopifyThemeIslands({
  resolveTag({ filePath, defaultTag }) {
    if (filePath.endsWith("LegacyWidget.ts")) return false;
    return defaultTag;
  },
});
```

Important:

- returning `false` excludes the file from the island map entirely
- the final resolved Tag must be unique across all discovered files; collisions are compile-time errors
- `resolveTag()` overrides the Tag derivation only; it does not affect `customElements.define(...)` in the source file

## Retries

Automatically retry failed island loads with exponential backoff:

```ts
shopifyThemeIslands({
  retry: {
    retries: 2,   // number of retries after the initial failure. Default: 0 (no retry)
    delay: 1000,  // base delay in ms; doubles each attempt (1s, 2s, 4s…). Default: 1000
  },
});
```

Once retries are exhausted the island is dequeued — a fresh activation requires a new element instance.

## Lifecycle events

The runtime dispatches DOM events on `document` for observability use cases such as analytics and error reporting.

### Typed helpers

The `/events` entry point provides typed helpers that unwrap `e.detail` for you and return a cleanup function:

```ts
import { onIslandLoad, onIslandError } from "vite-plugin-shopify-theme-islands/events";

const offLoad = onIslandLoad(({ tag, duration, attempt }) => {
  analytics.track("island_loaded", { tag, duration, attempt });
});

const offError = onIslandError(({ tag, error, attempt }) => {
  errorReporter.capture(error, { context: tag, attempt });
});

// Remove listeners when no longer needed (e.g. SPA teardown)
offLoad();
offError();
```

For SPA teardown, the virtual `/revive` module also exports `disconnect()`, which stops further lifecycle observation and cancels pending startup before init has run.
The same module also exports `scan()`, `observe()`, and `unobserve()` for subtree control.

### Raw DOM events

The events are also available via the standard `document.addEventListener` API. The package augments `DocumentEventMap`, but your app-side TypeScript program needs to see the package types for that augmentation to apply.

If your browser/client TS config does not already include the package types, add a small `.d.ts` file in your app code:

```ts
// app/types/vite-plugin-shopify-theme-islands.d.ts
import "vite-plugin-shopify-theme-islands";
```

After that, `document.addEventListener("islands:load", ...)` and `document.addEventListener("islands:error", ...)` will be typed in client-side code.

```ts
document.addEventListener("islands:load", (e) => {
  analytics.track("island_loaded", { tag: e.detail.tag });
});
```

| Event           | Detail properties              | When it fires                                              |
| --------------- | ------------------------------ | ---------------------------------------------------------- |
| `islands:load`  | `tag`, `duration`, `attempt`   | Island module resolves successfully                        |
| `islands:error` | `tag`, `error`, `attempt`      | Load fails, custom directive throws or rejects, or `directiveTimeout` expires (alongside `console.error`) |

`islands:error` fires on each retry attempt, not just the final failure. Multiple independent listeners are supported — each receives its own event.

## AI Agents

If you use an AI coding agent (Claude Code, Cursor, Copilot, etc.), run once after installing:

```bash
npx @tanstack/intent@latest install
```

This maps the bundled skills to your agent config so your agent gets accurate current API guidance. Skills update automatically with npm updates — no re-run needed.

## Migrating from v1.x

### Tag ownership now defaults to `registeredTag`

In v1.x, the Tag was always derived from the filename (`product-form.ts` → `<product-form>`). In v2.0 the default is `registeredTag`: the plugin reads the static `customElements.define("your-tag", ...)` call inside each Island file.

If your filenames and `customElements.define(...)` tags already agree (the common case), nothing breaks.

If they disagree — for example a file named `product-form.ts` that calls `customElements.define("x-product-form", ...)` — the Tag ownership changes on upgrade. The plugin will fail at compile time if no static define is found, or emit a different Tag than before.

To preserve v1.x behaviour explicitly, set `tagSource: "filename"`:

```ts
shopifyThemeIslands({
  tagSource: "filename", // use filename-derived tags, same as v1.x
});
```

New projects should use the default `registeredTag` mode — it keeps the plugin's ownership model in sync with the browser's own source of truth.

## License

MIT
