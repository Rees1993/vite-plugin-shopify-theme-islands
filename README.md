# vite-plugin-shopify-theme-islands

Island architecture for Shopify themes. Lazily hydrate custom elements using loading directives — only load the JavaScript when it's actually needed.

## Installation

```bash
npm install -D vite-plugin-shopify-theme-islands
```

## Setup

### 1. Add the plugin to `vite.config.ts`

```ts
import { defineConfig } from 'vite';
import shopifyThemeIslands from 'vite-plugin-shopify-theme-islands';

export default defineConfig({
  plugins: [
    shopifyThemeIslands({
      pathPrefix: '/frontend/js/islands/',
    }),
  ],
});
```

### 2. Call `revive` in your entrypoint

```js
import { revive, getReviveOptions } from 'virtual:shopify-theme-islands/revive';

const islands = import.meta.glob('/frontend/js/islands/*.{ts,js}');
revive(islands, getReviveOptions());
```

The glob pattern must match the `pathPrefix` option. Each file in that directory corresponds to a custom element — the filename (without extension) is the tag name.

### 3. TypeScript: reference the virtual module types

Add the following to your `tsconfig.json` so TypeScript knows about the `virtual:shopify-theme-islands/revive` module:

```json
{
  "compilerOptions": {
    "types": ["vite-plugin-shopify-theme-islands/client"]
  }
}
```

Or add a triple-slash reference in your entrypoint file:

```ts
/// <reference types="vite-plugin-shopify-theme-islands/client" />
```

## Writing islands

Each island is a file in your islands directory that defines and registers a custom element. The filename must match the custom element tag name used in your Liquid templates.

```
frontend/js/islands/
  product-form.ts   →  <product-form>
  cart-drawer.ts    →  <cart-drawer>
```

```ts
// frontend/js/islands/product-form.ts
class ProductForm extends HTMLElement {
  connectedCallback() {
    // ...
  }
}

customElements.define('product-form', ProductForm);
```

## Loading directives

Add these attributes to your custom elements in Liquid to control when the JavaScript loads.

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

| Option | Type | Default | Description |
|---|---|---|---|
| `pathPrefix` | `string` | `'/frontend/js/islands/'` | Path prefix used to match `import.meta.glob` keys to tag names |
| `directiveVisible` | `string` | `'client:visible'` | Attribute name for the visible directive |
| `directiveMedia` | `string` | `'client:media'` | Attribute name for the media directive |
| `directiveIdle` | `string` | `'client:idle'` | Attribute name for the idle directive |

## License

MIT
