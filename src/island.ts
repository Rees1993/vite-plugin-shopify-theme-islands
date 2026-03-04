/**
 * Island mixin for incremental adoption.
 *
 * Marks a custom element class as an island so the Vite plugin can detect
 * it at build time and include it as a lazy chunk — without needing to move
 * the file into a configured islands directory.
 *
 * Usage:
 *   import Island from 'vite-plugin-shopify-theme-islands/island';
 *
 *   class PreFooter extends Island(HTMLElement) {
 *     connectedCallback() { ... }
 *   }
 *   customElements.define('pre-footer', PreFooter);
 *
 * The only change from a standard web component is `extends Island(HTMLElement)`
 * instead of `extends HTMLElement`. Everything else stays identical.
 */

type Constructor<T = HTMLElement> = new (...args: any[]) => T;

export default function Island<T extends Constructor>(Base: T): T {
  return Base;
}
