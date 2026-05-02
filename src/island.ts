/**
 * Island marker for auto-discovery.
 *
 * Marks a custom element class as an island so the Vite plugin can detect
 * it at build time and include it as a lazy chunk — without needing to move
 * the file into a configured islands directory.
 *
 * Usage:
 *   import Island from 'vite-plugin-shopify-theme-islands/island';
 *
 *   class SiteFooter extends Island(HTMLElement) {
 *     connectedCallback() { ... }
 *   }
 *   if (!customElements.get('site-footer')) customElements.define('site-footer', SiteFooter);
 *
 * The only change from a standard web component is `extends Island(HTMLElement)`
 * instead of `extends HTMLElement`. Everything else stays identical.
 * By default, Tag ownership comes from the static `customElements.define(...)`
 * call in the file (`tagSource: "registeredTag"`). Set `tagSource: "filename"`
 * to restore the v1.x filename-based ownership model. `resolveTag()` remains
 * the final override layer in either mode.
 */

type Constructor<T = HTMLElement> = new (...args: any[]) => T;

export default function Island<T extends Constructor>(Base: T): T {
  return Base;
}
