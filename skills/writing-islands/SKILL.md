---
name: writing-islands
description: >
  Writing island files. Two discovery modes: directory scanning (files in
  configured directories auto-discovered by tag name = filename) and Island
  mixin (import Island from vite-plugin-shopify-theme-islands/island to mark
  files anywhere in the project). Covers customElements.define, the Island
  base class, and child island cascade behaviour.
type: core
library: vite-plugin-shopify-theme-islands
library_version: "1.1.1"
sources:
  - Rees1993/vite-plugin-shopify-theme-islands:src/island.ts
  - Rees1993/vite-plugin-shopify-theme-islands:src/discovery.ts
  - Rees1993/vite-plugin-shopify-theme-islands:src/contract.ts
  - Rees1993/vite-plugin-shopify-theme-islands:src/runtime.ts
---

## Setup

### Directory-based island (simplest)

Place the file in a configured island directory. The filename (minus extension) becomes the tag name.

```ts
// frontend/js/islands/product-form.ts
class ProductForm extends HTMLElement {
  connectedCallback() {
    this.innerHTML = "<p>Loaded</p>";
  }
}

if (!customElements.get("product-form")) {
  customElements.define("product-form", ProductForm);
}
```

```html
<!-- In Shopify theme template -->
<product-form client:visible></product-form>
```

### Island mixin (file outside islands directory)

Use the `Island` mixin to mark a component for auto-discovery without moving it.

```ts
// frontend/js/components/cart-drawer.ts
import Island from "vite-plugin-shopify-theme-islands/island";

class CartDrawer extends Island(HTMLElement) {
  connectedCallback() {
    this.innerHTML = "<p>Cart loaded</p>";
  }
}

if (!customElements.get("cart-drawer")) {
  customElements.define("cart-drawer", CartDrawer);
}
```

The plugin scans all TS/JS files for the `Island` import at build time and includes matches as lazy chunks.

## Core Patterns

### Guard against duplicate registration

```ts
if (!customElements.get("product-form")) {
  customElements.define("product-form", ProductForm);
}
```

Required when multiple entry points might import the same island file.

### Child islands activate after their parent

```html
<cart-drawer client:visible>
  <cart-line-item client:idle></cart-line-item>
</cart-drawer>
```

`cart-line-item` is not activated until `cart-drawer`'s module has resolved. The runtime's TreeWalker rejects subtrees of unloaded parent islands and re-walks them after the parent loads.

### Vite alias in directories

```ts
// vite.config.ts
export default defineConfig({
  resolve: { alias: { "@islands": "/frontend/js/islands" } },
  plugins: [
    shopifyThemeIslands({ directories: ["@islands/"] }),
  ],
});
```

The plugin resolves Vite aliases in `directories` during `configResolved`.

## Common Mistakes

### HIGH Island file outside directories without Island mixin

Wrong:

```ts
// frontend/js/components/search-bar.ts — not in islands directory
class SearchBar extends HTMLElement {}
customElements.define("search-bar", SearchBar);
```

Correct:

```ts
// frontend/js/components/search-bar.ts
import Island from "vite-plugin-shopify-theme-islands/island";

class SearchBar extends Island(HTMLElement) {}
customElements.define("search-bar", SearchBar);
```

Without the `Island` import the plugin cannot detect the file. The element appears in the DOM but the module is never lazy-loaded.

Source: src/discovery.ts — ISLAND_IMPORT_RE, discoverIslandFiles

### HIGH Missing `customElements.define` call

Wrong:

```ts
// frontend/js/islands/mini-cart.ts
export class MiniCart extends HTMLElement {
  connectedCallback() {}
}
```

Correct:

```ts
export class MiniCart extends HTMLElement {
  connectedCallback() {}
}

if (!customElements.get("mini-cart")) {
  customElements.define("mini-cart", MiniCart);
}
```

The plugin loads the module but the custom element never upgrades without `customElements.define`.

Source: src/runtime.ts — loader() is called but registration is the file's responsibility

### HIGH Filename without a hyphen is skipped as an invalid custom element tag

Wrong:

```ts
// frontend/js/islands/cartdrawer.ts
class CartDrawer extends HTMLElement {}
customElements.define("cartdrawer", CartDrawer);
```

Correct:

```ts
// frontend/js/islands/cart-drawer.ts
class CartDrawer extends HTMLElement {}

if (!customElements.get("cart-drawer")) {
  customElements.define("cart-drawer", CartDrawer);
}
```

The runtime derives the tag name from the filename and skips non-hyphenated names with a warning. Use valid custom element tag names in filenames.

Source: src/contract.ts — defaultKeyToTag()

### MEDIUM Child island activates before parent is ready

Wrong assumption:

```html
<!-- Expecting cart-line-item to start its own directive wait immediately -->
<cart-drawer client:visible>
  <cart-line-item client:idle></cart-line-item>
</cart-drawer>
```

`cart-line-item`'s `client:idle` wait does **not** begin until `cart-drawer` has finished loading. The cascade is sequential, not parallel.

Source: src/runtime.ts — customElementFilter NodeFilter.FILTER_REJECT, walk() after parent loads
