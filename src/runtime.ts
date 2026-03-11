/**
 * Island architecture runtime for Shopify themes.
 *
 * Walks the DOM for custom elements that match island files, then loads them
 * lazily based on client directives:
 *
 *   client:visible  — load when the element scrolls into view
 *   client:media    — load when a CSS media query matches
 *   client:idle     — load when the browser has idle time
 *   client:defer    — load after a fixed delay (ms value on the attribute)
 *
 * Directives can be combined; all conditions must be met before loading.
 * A MutationObserver re-runs the same logic for elements added dynamically.
 */

import type { ClientDirective, ReviveOptions } from "./index.js";

// Resolves when the given media query matches
function media(query: string): Promise<void> {
  const m = window.matchMedia(query);
  return new Promise((resolve) => {
    if (m.matches) resolve();
    else m.addEventListener('change', () => resolve(), { once: true });
  });
}

// Resolves when the element enters the viewport.
// Registers a cancel function in `pending` so the outer MutationObserver can
// abort this if the element is removed from the DOM before becoming visible.
function visible(
  element: Element,
  rootMargin: string,
  threshold: number,
  pending: Map<Element, () => void>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          io.disconnect();
          pending.delete(element);
          resolve();
          return;
        }
      }
    }, { rootMargin, threshold });

    io.observe(element);
    pending.set(element, () => { io.disconnect(); reject(); });
  });
}

// Resolves after a fixed delay.
function defer(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Resolves when the browser is idle.
// Falls back to setTimeout with a configurable timeout for browsers without requestIdleCallback.
function idle(timeout: number): Promise<void> {
  return new Promise((resolve) => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(() => resolve(), { timeout });
    else setTimeout(resolve, timeout);
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

export function revive(
  islands: Record<string, () => Promise<unknown>>,
  options?: ReviveOptions,
  customDirectives?: Map<string, ClientDirective>,
): void {
  const attrVisible = options?.directives?.visible?.attribute ?? 'client:visible';
  const attrMedia   = options?.directives?.media?.attribute   ?? 'client:media';
  const attrIdle    = options?.directives?.idle?.attribute    ?? 'client:idle';
  const attrDefer   = options?.directives?.defer?.attribute   ?? 'client:defer';
  const rootMargin  = options?.directives?.visible?.rootMargin ?? '200px';
  const threshold   = options?.directives?.visible?.threshold  ?? 0;
  const idleTimeout = options?.directives?.idle?.timeout       ?? 500;
  const deferDelay  = options?.directives?.defer?.delay        ?? 3000;
  const log = options?.debug ? (...args: unknown[]) => console.log('[islands]', ...args) : () => {};

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

  log(`revive() ready — ${islandMap.size} island(s):`, [...islandMap.keys()]);

  // Track queued tag names to avoid duplicate customElements.define calls
  const queued = new Set<string>();

  // Elements awaiting client:visible — maps element to its IO cancel function.
  // Checked by the outer MutationObserver to abort loading if the element is removed.
  const pendingVisible = new Map<Element, () => void>();

  async function loadIsland(tagName: string, el: Element, loader: () => Promise<unknown>): Promise<void> {
    log(`<${tagName}> activating`);
    try {
      if (el.hasAttribute(attrVisible)) {
        // Per-element value overrides global rootMargin (e.g. client:visible="0px")
        const elRootMargin = el.getAttribute(attrVisible) || rootMargin;
        log(`<${tagName}> waiting for ${attrVisible}`);
        await visible(el, elRootMargin, threshold, pendingVisible);
      }
      const q = el.getAttribute(attrMedia);
      if (q) {
        log(`<${tagName}> waiting for ${attrMedia}="${q}"`);
        await media(q);
      }
      if (el.hasAttribute(attrIdle)) {
        // Per-element value overrides global timeout (e.g. client:idle="1000")
        // parseInt('', 10) === NaN, so the empty-string case is covered by the NaN check
        const rawIdle = parseInt(el.getAttribute(attrIdle)!, 10);
        const elTimeout = Number.isNaN(rawIdle) ? idleTimeout : rawIdle;
        log(`<${tagName}> waiting for ${attrIdle} (timeout: ${elTimeout}ms)`);
        await idle(elTimeout);
      }
      const d = el.getAttribute(attrDefer);
      if (d !== null) {
        const raw = parseInt(d, 10);
        const ms = Number.isNaN(raw) ? deferDelay : raw;
        if (d !== '' && Number.isNaN(raw)) {
          console.warn(`[islands] <${tagName}> invalid ${attrDefer} value "${d}" — using default ${deferDelay}ms`);
        }
        log(`<${tagName}> waiting for ${attrDefer} (${ms}ms)`);
        await defer(ms);
      }
    } catch {
      // element was removed from the DOM before all conditions were met — skip loading
      log(`<${tagName}> aborted (element removed)`);
      return;
    }

    const run = () => loader().catch((err) => console.error(`[islands] Failed to load <${tagName}>:`, err));

    // Custom directives run after built-ins — the directive owns the load() call
    if (customDirectives?.size) {
      for (const [attrName, directiveFn] of customDirectives) {
        if (el.hasAttribute(attrName)) {
          log(`<${tagName}> dispatching to custom directive ${attrName}`);
          directiveFn(run, { name: attrName, value: el.getAttribute(attrName)! }, el);
          return; // directive owns the load call
        }
      }
    }

    log(`<${tagName}> loading`);
    run();
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
    // Cancel loading for any pending-visible elements that were removed from the DOM
    for (const [el, cancel] of pendingVisible) {
      if (!el.isConnected) {
        pendingVisible.delete(el);
        cancel();
      }
    }
    // Activate islands added dynamically
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
