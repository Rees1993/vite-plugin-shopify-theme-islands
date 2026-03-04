# vite-plugin-shopify-theme-islands

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
  plugins: [
    shopifyThemeIslands(),
  ],
});
```

### 2. Call `islands` in your entrypoint

```ts
import islands from "vite-plugin-shopify-theme-islands/islands";

islands();
```

That's it. The plugin automatically scans your islands directory and wires everything up.

## Writing islands

Each island is a file in your islands directory that defines and registers a custom element. The filename (without extension) must match the custom element tag name used in your Liquid templates.

```
frontend/js/islands/
  product-form.ts        →  <product-form>
  cart-drawer.ts         →  <cart-drawer>
  forms/checkout-form.ts →  <checkout-form>
```

> Filenames must contain a hyphen (`product-form.ts` not `productform.ts`) — this is a Web Components requirement. Filenames must also be lowercase to match the tag name.

Islands are scanned recursively, so subdirectories are supported.

```ts
// frontend/js/islands/product-form.ts
class ProductForm extends HTMLElement {
  connectedCallback() {
    // ...
  }

  disconnectedCallback() {
    // ...
  }
}

customElements.define("product-form", ProductForm);
```

> No need to guard against duplicate registration — the runtime ensures each island is only loaded once.

## Loading directives

Add these attributes to your custom elements in Liquid to control when the JavaScript loads. Without a directive, the island loads immediately.

### `client:visible`

Loads the island when the element scrolls into view.

```html
<product-recommendations client:visible>
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

Loads the island once the browser is idle (uses `requestIdleCallback`, falls back to `setTimeout`).

```html
<recently-viewed client:idle>
  <!-- ... -->
</recently-viewed>
```

Directives can be combined — the element will wait for all conditions to be met before loading:

```html
<heavy-widget client:visible client:idle>
  <!-- ... -->
</heavy-widget>
```

## Options

| Option             | Type                   | Default                       | Description                                                     |
| ------------------ | ---------------------- | ----------------------------- | --------------------------------------------------------------- |
| `directories`      | `string \| string[]`   | `['/frontend/js/islands/']`   | Directories to scan for island files. Accepts Vite aliases.     |
| `directiveVisible` | `string`               | `'client:visible'`            | Attribute name for the visible directive                        |
| `directiveMedia`   | `string`               | `'client:media'`              | Attribute name for the media directive                          |
| `directiveIdle`    | `string`               | `'client:idle'`               | Attribute name for the idle directive                           |

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
