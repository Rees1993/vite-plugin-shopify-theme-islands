/**
 * Island mixin for incremental adoption.
 *
 * Wrap any HTMLElement subclass to mark it as an island and automatically
 * derive + register the custom element tag name from the class name:
 *
 *   class ProductForm extends Island(HTMLElement) { ... }
 *   // equivalent to: customElements.define('product-form', ProductForm)
 *
 * PascalCase → kebab-case: ProductForm → product-form
 *
 * The Vite plugin detects imports of this module at build time and
 * automatically includes the file as a lazy island chunk — no directory
 * config or manual glob needed.
 */

type Constructor<T = HTMLElement> = new (...args: any[]) => T;

function toKebabCase(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

export function Island<T extends Constructor>(Base: T) {
  return class extends Base {
    static __island = true;

    static {
      // Defer define until the subclass is fully declared via queueMicrotask,
      // so the class name is available and the subclass has finished setup
      queueMicrotask(() => {
        const tagName = toKebabCase(this.name);
        if (!tagName.includes('-')) {
          console.warn(`[islands] Class name "${this.name}" does not produce a valid custom element tag name (must contain a hyphen). Rename to e.g. "${this.name}Element".`);
          return;
        }
        if (!customElements.get(tagName)) customElements.define(tagName, this);
      });
    }
  };
}
