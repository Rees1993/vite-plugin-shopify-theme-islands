# vite-plugin-shopify-theme-islands

[![npm version](https://img.shields.io/npm/v/vite-plugin-shopify-theme-islands)](https://www.npmjs.com/package/vite-plugin-shopify-theme-islands)
[![npm downloads](https://img.shields.io/npm/dm/vite-plugin-shopify-theme-islands)](https://www.npmjs.com/package/vite-plugin-shopify-theme-islands)
[![license](https://img.shields.io/npm/l/vite-plugin-shopify-theme-islands)](./LICENSE)

Island architecture for Shopify themes. Lazily hydrate custom elements using loading directives — only load the JavaScript when it's actually needed.

## Installation

```bash
bun add -d vite-plugin-shopify-theme-islands
npm install -D vite-plugin-shopify-theme-islands
pnpm add -D vite-plugin-shopify-theme-islands
yarn add -D vite-plugin-shopify-theme-islands
```

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

That's it. The plugin automatically scans your islands directory and wires everything up.

## Writing islands

Two approaches — use either or both.

### Directory scanning

Drop files into your islands directory and they're automatically picked up. The filename (without extension) must match the custom element tag name used in your Liquid templates.

```
frontend/js/islands/
  product-form.ts        →  <product-form>
  cart-drawer.ts         →  <cart-drawer>
  forms/checkout-form.ts →  <checkout-form>
```

> Filenames must contain a hyphen (`product-form.ts` not `productform.ts`) — this is a Web Components requirement. Filenames must also be lowercase to match the tag name.

Subdirectories are supported. Any file in the directory becomes an island automatically.

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

### Island mixin

Mark any file as an island with the `Island` mixin, regardless of where it lives. Import it and extend from `Island(HTMLElement)` instead of `HTMLElement` — everything else stays identical.

```ts
// frontend/js/components/site-footer.ts
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

The plugin detects the mixin import at build time and includes the file as a lazy island chunk — no directory config needed.

### Which to use

|                   | Directory scanning                 | Island mixin                   |
| ----------------- | ---------------------------------- | ------------------------------ |
| File organisation | Dedicated islands directory        | Co-located anywhere            |
| Opt-in style      | Convention (everything in the dir) | Explicit (per file)            |
| Auditability      | One directory to check             | Search for `/island` import    |
| Build overhead    | None                               | Filesystem scan at build start |

Both can be used together — directory scanning for new islands, the mixin for existing components you want to adopt without moving.

## Loading directives

Add these attributes to your custom elements in Liquid to control when the JavaScript loads. Without a directive, the island loads immediately.

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

Directives can be combined — the element will wait for all conditions to be met before loading:

```html
<heavy-widget client:visible client:idle>
  <!-- ... -->
</heavy-widget>
```

## Custom directives

Register your own loading conditions with the `clientDirectives` plugin option. A custom directive is a function that receives a `load` callback and decides when to call it.

### 1. Write the directive

```ts
// src/directives/on-click.ts
import type { ClientDirective } from "vite-plugin-shopify-theme-islands";

const onClickDirective: ClientDirective = (load, { value }, el) => {
  el.addEventListener("click", load, { once: true });
};

export default onClickDirective;
```

The function signature is `(load, options, el) => void | Promise<void>`:

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| `load` | `() => Promise<unknown>` | Call this to trigger the island module load |
| `options.name` | `string` | The matched attribute name, e.g. `'client:on-click'` |
| `options.value` | `string` | The attribute value; empty string if no value was set |
| `el` | `Element` | The island element |

### 2. Register it in the plugin config

```ts
// vite.config.ts
import shopifyThemeIslands from "vite-plugin-shopify-theme-islands";

export default defineConfig({
  plugins: [
    shopifyThemeIslands({
      clientDirectives: [
        { name: "client:on-click", entrypoint: "./src/directives/on-click.ts" },
      ],
    }),
  ],
});
```

### 3. Use it in Liquid

```html
<quick-add client:on-click>
  <!-- ... -->
</quick-add>
```

### Ordering

Built-in directives always run first. A custom directive is only invoked after all built-in conditions on the element have been met. This means you can gate a custom directive behind `client:visible` to avoid wiring event listeners for off-screen elements:

```html
<!-- element must enter the viewport before the click handler is registered -->
<quick-add client:visible client:on-click>
  <!-- ... -->
</quick-add>
```

The custom directive owns the `load()` call — the built-in chain never calls it directly when a custom directive is matched.

## Options

| Option             | Type                          | Default                     | Description                                                                            |
| ------------------ | ----------------------------- | --------------------------- | -------------------------------------------------------------------------------------- |
| `directories`      | `string \| string[]`          | `['/frontend/js/islands/']` | Directories to scan for island files. Accepts Vite aliases.                            |
| `directives`       | `object`                      | see below                   | Per-directive configuration. Each directive has an `attribute` name and extra options. |
| `clientDirectives` | `ClientDirectiveDefinition[]` | `[]`                        | Custom client directives to register. See [Custom directives](#custom-directives).     |
| `debug`            | `boolean`                     | `false`                     | Log discovered islands at build time and directive events in the browser console.      |

### Directive defaults

```ts
shopifyThemeIslands({
  directives: {
    visible: {
      attribute: "client:visible", // HTML attribute name
      rootMargin: "200px",         // passed to IntersectionObserver — pre-loads before scrolling into view
      threshold: 0,                // passed to IntersectionObserver — ratio of element that must be visible
    },
    idle: {
      attribute: "client:idle",    // HTML attribute name
      timeout: 500,                // deadline (ms) for requestIdleCallback; also the setTimeout fallback delay
    },
    media: {
      attribute: "client:media",   // HTML attribute name
    },
    defer: {
      attribute: "client:defer",   // HTML attribute name
      delay: 3000,                 // fallback delay (ms) when the attribute has no value
    },
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

## License

MIT
