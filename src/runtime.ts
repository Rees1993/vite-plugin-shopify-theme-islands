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
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        obs.disconnect();
        resolve();
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

// NodeFilter that accepts custom elements (tag names containing a hyphen) and
// skips (but still descends into) everything else
const customElementFilter: NodeFilter = {
  acceptNode: (node) =>
    (node as Element).tagName.includes('-')
      ? NodeFilter.FILTER_ACCEPT
      : NodeFilter.FILTER_SKIP,
};

export function revive(islands: Record<string, () => Promise<unknown>>, options?: ReviveOptions): void {
  const attrVisible = options?.directiveVisible ?? 'client:visible';
  const attrMedia = options?.directiveMedia ?? 'client:media';
  const attrIdle = options?.directiveIdle ?? 'client:idle';

  // Precompute tag name → loader map from glob keys (filename without extension = tag name)
  const islandMap = new Map<string, () => Promise<unknown>>();
  for (const [key, loader] of Object.entries(islands)) {
    const tagName = key.split('/').pop()!.replace(/\.(ts|js)$/, '');
    if (!tagName.includes('-')) {
      console.warn(`[islands] Skipping "${key.split('/').pop()}" — filename must contain a hyphen to match a valid custom element tag name (e.g. rename to "${tagName}-island.ts")`);
      continue;
    }
    if (!islandMap.has(tagName)) islandMap.set(tagName, loader);
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

  function activate(el: Element): void {
    const tagName = el.tagName.toLowerCase();
    if (queued.has(tagName)) return;
    const loader = islandMap.get(tagName);
    if (loader) {
      queued.add(tagName);
      loadIsland(tagName, el, loader);
    }
  }

  // Walk a subtree using a native TreeWalker — faster than JS recursion for large DOMs
  // and avoids stack overflow on deeply nested pages
  function walk(el: Element): void {
    activate(el);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT, customElementFilter);
    let node: Node | null;
    while ((node = walker.nextNode())) activate(node as Element);
  }

  const observer = new MutationObserver((mutations) => {
    for (const { addedNodes } of mutations) {
      for (const node of addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) walk(node as Element);
      }
    }
  });

  function init(): void {
    walk(document.body);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
}
