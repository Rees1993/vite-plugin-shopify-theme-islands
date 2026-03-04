/**
 * Island architecture runtime for Shopify themes.
 *
 * Walks the DOM for custom elements that match island files, then loads them
 * lazily based on client directives:
 *
 *   client:visible  — load when the element scrolls into view
 *   client:media    — load when a CSS media query matches
 *   client:idle     — load when the browser has idle time
 *
 * Directives can be combined; all conditions must be met before loading.
 * A MutationObserver re-runs the same logic for elements added dynamically.
 */

interface ReviveOptions {
  pathPrefix?: string;
  directiveVisible?: string;
  directiveMedia?: string;
  directiveIdle?: string;
}

// Resolves when the given media query matches
function media(query: string): Promise<void> {
  const m = window.matchMedia(query);
  return new Promise((resolve) => {
    if (m.matches) resolve();
    else m.addEventListener('change', () => resolve(), { once: true });
  });
}

// Resolves when the element enters the viewport
function visible(element: Element): Promise<void> {
  return new Promise((resolve) => {
    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          obs.disconnect();
          resolve();
          break;
        }
      }
    });
    obs.observe(element);
  });
}

// Resolves when the browser is idle (falls back to setTimeout for Safari)
function idle(): Promise<void> {
  return new Promise((resolve) => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(() => resolve());
    else setTimeout(resolve, 200);
  });
}

export function revive(islands: Record<string, () => Promise<unknown>>, options?: ReviveOptions): void {
  const pathPrefix = options?.pathPrefix ?? '/frontend/js/islands/';
  const attrVisible = options?.directiveVisible ?? 'client:visible';
  const attrMedia = options?.directiveMedia ?? 'client:media';
  const attrIdle = options?.directiveIdle ?? 'client:idle';

  const observer = new MutationObserver((mutations) => {
    for (const { addedNodes } of mutations) {
      for (const node of addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) dfs(node as Element);
      }
    }
  });

  async function dfs(node: Element): Promise<void> {
    const tagName = node.tagName.toLowerCase();
    const loader = islands[pathPrefix + tagName + '.ts'] ?? islands[pathPrefix + tagName + '.js'];

    // Custom elements always contain a hyphen
    if (/-/.test(tagName) && loader) {
      if (node.hasAttribute(attrVisible)) await visible(node);
      const q = node.getAttribute(attrMedia);
      if (q) await media(q);
      if (node.hasAttribute(attrIdle)) await idle();
      // Side effects (e.g. customElements.define) run when the import resolves
      loader().catch(console.error);
    }

    let child = node.firstElementChild;
    while (child) {
      dfs(child); // intentionally not awaited — siblings load in parallel
      child = child.nextElementSibling;
    }
  }

  dfs(document.body);
  observer.observe(document.body, { childList: true, subtree: true });
}
