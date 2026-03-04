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
  plugins: [shopifyThemeIslands()],
});
```

### 2. Call `revive` in your entrypoint

```ts
import revive from "vite-plugin-shopify-theme-islands/revive";

revive();
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
// frontend/js/components/pre-footer.ts
import Island from "vite-plugin-shopify-theme-islands/island";

class PreFooter extends Island(HTMLElement) {
  connectedCallback() {
    // ...
  }
}

if (!customElements.get("pre-footer")) {
  customElements.define("pre-footer", PreFooter);
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

| Option             | Type                 | Default                     | Description                                                 |
| ------------------ | -------------------- | --------------------------- | ----------------------------------------------------------- |
| `directories`      | `string \| string[]` | `['/frontend/js/islands/']` | Directories to scan for island files. Accepts Vite aliases. |
| `directiveVisible` | `string`             | `'client:visible'`          | Attribute name for the visible directive                    |
| `directiveMedia`   | `string`             | `'client:media'`            | Attribute name for the media directive                      |
| `directiveIdle`    | `string`             | `'client:idle'`             | Attribute name for the idle directive                       |

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
