---
name: writing-islands
description: >
  Writing island files. Two discovery modes: directory scanning (files in
  configured directories auto-discovered; Tag derived from static
  customElements.define("...", ...) call by default) and Island mixin (import
  Island from vite-plugin-shopify-theme-islands/island to mark files anywhere
  in the project). Mixin islands added or removed during dev invalidate the
  virtual revive module (reloadModule when available, otherwise a full page
  reload) — no manual Vite restart. In registeredTag mode (default) Tag
  ownership comes from the static customElements.define call; filename mode
  (tagSource: "filename") restores v1.x filename-based ownership. resolveTag
  overrides run after tag source derivation in both modes. Duplicate final tags
  fail at compile time. Ordinary implementation edits do not invalidate /revive;
  only Tag ownership changes do.
type: core
library: vite-plugin-shopify-theme-islands
library_version: "2.0.0"
sources:
  - Rees1993/vite-plugin-shopify-theme-islands:src/island.ts
  - Rees1993/vite-plugin-shopify-theme-islands:src/discovery.ts
  - Rees1993/vite-plugin-shopify-theme-islands:src/revive-compile.ts
  - Rees1993/vite-plugin-shopify-theme-islands:src/contract.ts
  - Rees1993/vite-plugin-shopify-theme-islands:src/lifecycle.ts
  - Rees1993/vite-plugin-shopify-theme-islands:src/runtime.ts
---

## Setup

### Directory-based island (simplest)

Place the file in a configured island directory. The Tag is read from the static `customElements.define("your-tag", ...)` call inside the file — the filename can use any casing.

```ts
// frontend/js/islands/CartDrawer.ts
class CartDrawer extends HTMLElement {
  connectedCallback() {
    this.innerHTML = "<p>Loaded</p>";
  }
}

if (!customElements.get("cart-drawer")) {
  customElements.define("cart-drawer", CartDrawer);
}
```

```html
<!-- In Shopify theme template -->
<cart-drawer client:visible></cart-drawer>
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

The plugin scans all TS/JS files for the `Island` import at build time and includes matches as lazy chunks. During dev, adding or removing a mixin island invalidates the virtual `vite-plugin-shopify-theme-islands/revive` module so the recompile picks up the new island set; Vite reloads that module when `reloadModule` exists, otherwise it falls back to a full reload. You do not need to restart the Vite process manually.

For both directory-scanned files and mixin-marked files, the default Tag comes
from the file's static `customElements.define("your-tag", ...)` call
(`registeredTag` mode). `resolveTag()` runs after that default is derived and
can override it or return `false` to exclude the file. Set
`tagSource: "filename"` to restore v1.x filename-based ownership.

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
That parent/child gating now lives in the lifecycle coordinator, but the user-facing behavior is the same: nested islands wait for the queued parent to settle before their own activation starts.

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

### Override the derived Tag for specific files

```ts
shopifyThemeIslands({
  resolveTag({ filePath, defaultTag }) {
    if (filePath.endsWith("/frontend/js/legacy/widget.ts")) return "legacy-widget";
    return defaultTag;
  },
});
```

Use `resolveTag()` to override the default Tag derivation or exclude a file entirely by returning `false`. In `registeredTag` mode (the default), `defaultTag` is the Tag read from the file's static `customElements.define(...)` call. Returning `defaultTag` keeps that value unchanged.

When more than one discovered file resolves to the same Tag, plugin compilation fails. Use `resolveTag` to disambiguate or return `false` to exclude one file.

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

### HIGH No static `customElements.define(...)` call in the Island file

Wrong:

```ts
// frontend/js/islands/CartDrawer.ts
export class CartDrawer extends HTMLElement {}
// missing customElements.define — compile will fail
```

Correct:

```ts
// frontend/js/islands/CartDrawer.ts
export class CartDrawer extends HTMLElement {}

if (!customElements.get("cart-drawer")) {
  customElements.define("cart-drawer", CartDrawer);
}
```

In `registeredTag` mode (the default), the plugin reads a static
`customElements.define("...", ...)` call from each Island file at compile time.
If no call is found, or more than one is found, compilation fails with an error.
This is a plugin constraint for keeping one Island file as one lazy-loaded module
boundary, not a Web Components platform restriction.

Source: src/revive-compile.ts — registeredTag mode tag derivation

### HIGH Multiple `customElements.define(...)` calls in one Island file

Wrong:

```ts
// frontend/js/islands/CartDrawer.ts
customElements.define("cart-drawer", CartDrawer);
customElements.define("cart-drawer-legacy", CartDrawerLegacy); // second define
```

Correct — split into separate Island files, one define each:

```ts
// frontend/js/islands/CartDrawer.ts
customElements.define("cart-drawer", CartDrawer);
```

In `registeredTag` mode this plugin requires each Island file to have exactly one
static `customElements.define(...)` so Tag ownership and lazy-load boundaries stay
unambiguous. If you need to define two custom elements, put them in separate files.

This applies to inheritance chains too — if a base class and its subclass are both
custom elements, they must live in separate Island files:

```ts
// frontend/js/islands/CartItems.ts
export class CartItems extends HTMLElement {}
customElements.define("cart-items", CartItems); // one define per file
```

```ts
// frontend/js/islands/CartDrawerItems.ts
import { CartItems } from "./CartItems";
class CartDrawerItems extends CartItems {}
customElements.define("cart-drawer-items", CartDrawerItems); // separate file
```

The browser does allow multiple `customElements.define(...)` calls in one source
file; this one-per-Island-file rule is specific to the plugin's performance model.

Source: src/revive-compile.ts — registeredTag mode tag derivation

### MEDIUM Filename without a hyphen in `filename` mode

Wrong (when `tagSource: "filename"` is configured):

```ts
// frontend/js/islands/cartdrawer.ts
class CartDrawer extends HTMLElement {}
customElements.define("cartdrawer", CartDrawer);
```

Correct:

```ts
// frontend/js/islands/cart-drawer.ts
class CartDrawer extends HTMLElement {}
customElements.define("cart-drawer", CartDrawer);
```

In `tagSource: "filename"` mode the Tag is derived from the filename. Custom
element tag names must contain a hyphen — a non-hyphenated filename is skipped
with a warning. In the default `registeredTag` mode the filename is irrelevant
and may use any casing; only the `customElements.define(...)` tag matters.

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

Source: src/lifecycle.ts — customElementFilter NodeFilter.FILTER_REJECT, walk() after parent loads
