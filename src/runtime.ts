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
 * Returns a cleanup function that disconnects the observer.
 */

interface ReviveOptions {
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

export function revive(islands: Record<string, () => Promise<unknown>>, options?: ReviveOptions): () => void {
  const attrVisible = options?.directiveVisible ?? 'client:visible';
  const attrMedia = options?.directiveMedia ?? 'client:media';
  const attrIdle = options?.directiveIdle ?? 'client:idle';

  // Precompute tag name → loader map from glob keys (filename without extension = tag name)
  const islandMap = new Map<string, () => Promise<unknown>>();
  for (const [key, loader] of Object.entries(islands)) {
    const tagName = key.split('/').pop()!.replace(/\.(ts|js)$/, '');
    if (tagName.includes('-') && !islandMap.has(tagName)) islandMap.set(tagName, loader);
  }

  // Track queued tag names to avoid duplicate customElements.define calls
  const queued = new Set<string>();

  async function loadIsland(tagName: string, el: Element, loader: () => Promise<unknown>): Promise<void> {
    if (el.hasAttribute(attrVisible)) await visible(el);
    const q = el.getAttribute(attrMedia);
    if (q) await media(q);
    if (el.hasAttribute(attrIdle)) await idle();
    loader().catch((err) => console.error(`[islands] Failed to load <${tagName}>:`, err));
  }

  function visit(node: Element): void {
    const tagName = node.tagName.toLowerCase();
    if (!queued.has(tagName)) {
      const loader = islandMap.get(tagName);
      if (loader) {
        queued.add(tagName);
        loadIsland(tagName, node, loader);
      }
    }
    let child = node.firstElementChild;
    while (child) {
      visit(child);
      child = child.nextElementSibling;
    }
  }

  const observer = new MutationObserver((mutations) => {
    for (const { addedNodes } of mutations) {
      for (const node of addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) visit(node as Element);
      }
    }
  });

  function init(): void {
    visit(document.body);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  return () => observer.disconnect();
}
