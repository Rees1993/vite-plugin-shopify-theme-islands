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
    else m.addEventListener("change", () => resolve(), { once: true });
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
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          io.disconnect();
          pending.delete(element);
          resolve();
        }
      },
      { rootMargin, threshold },
    );

    io.observe(element);
    pending.set(element, () => {
      io.disconnect();
      reject();
    });
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
    if ("requestIdleCallback" in window) window.requestIdleCallback(() => resolve(), { timeout });
    else setTimeout(resolve, timeout);
  });
}

export function revive(
  islands: Record<string, () => Promise<unknown>>,
  options?: ReviveOptions,
  customDirectives?: Map<string, ClientDirective>,
): () => void {
  const attrVisible = options?.directives?.visible?.attribute ?? "client:visible";
  const attrMedia = options?.directives?.media?.attribute ?? "client:media";
  const attrIdle = options?.directives?.idle?.attribute ?? "client:idle";
  const attrDefer = options?.directives?.defer?.attribute ?? "client:defer";
  const rootMargin = options?.directives?.visible?.rootMargin ?? "200px";
  const threshold = options?.directives?.visible?.threshold ?? 0;
  const idleTimeout = options?.directives?.idle?.timeout ?? 500;
  const deferDelay = options?.directives?.defer?.delay ?? 3000;
  const debug = options?.debug ?? false;

  // Precompute tag name → loader map from glob keys (filename without extension = tag name)
  const islandMap = new Map<string, () => Promise<unknown>>();
  for (const [key, loader] of Object.entries(islands)) {
    const filename = key.split("/").pop()!;
    const tagName = filename.replace(/\.(ts|js)$/, "");
    if (!tagName.includes("-")) {
      console.warn(
        `[islands] Skipping "${filename}" — filename must contain a hyphen to match a valid custom element tag name (e.g. rename to "${tagName}-island.ts")`,
      );
      continue;
    }
    if (!islandMap.has(tagName)) islandMap.set(tagName, loader);
  }

  // Track queued tag names to avoid duplicate customElements.define calls
  const queued = new Set<string>();

  // Set to true after the initial DOM walk — suppresses the upfront "waiting · ..." log for
  // dynamically added islands, where the completion group alone is sufficient.
  let initDone = false;

  // Track successfully loaded tag names so child islands can activate after their parent loads
  const loaded = new Set<string>();

  // Elements awaiting client:visible — maps element to its IO cancel function.
  // Checked by the outer MutationObserver to abort loading if the element is removed.
  const pendingVisible = new Map<Element, () => void>();

  // Returns true if the tag is queued but not yet loaded.
  // Only islands can enter `queued`, so the islandMap check is redundant here.
  const isUnloadedIsland = (tag: string) => queued.has(tag) && !loaded.has(tag);

  // NodeFilter that accepts custom elements (tag names containing a hyphen),
  // skips (but still descends into) non-custom elements, and rejects the subtree
  // of any queued-but-not-yet-loaded island (children are walked after the parent loads).
  const customElementFilter: NodeFilter = {
    acceptNode: (node) => {
      const tag = (node as Element).tagName;
      if (!tag.includes("-")) return NodeFilter.FILTER_SKIP;
      const lowerTag = tag.toLowerCase();
      if (isUnloadedIsland(lowerTag)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  };

  async function loadIsland(
    tagName: string,
    el: HTMLElement,
    loader: () => Promise<unknown>,
  ): Promise<void> {
    // Show which directives the island is waiting on inside the init group. Skipped for
    // dynamic (post-init) activations — the completion group is sufficient there.
    // Empty client:media is excluded: it's warned and skipped, so the island fires immediately.
    if (debug && !initDone) {
      const parts: string[] = [];
      const visibleVal = el.getAttribute(attrVisible);
      if (visibleVal !== null)
        parts.push(visibleVal ? `${attrVisible}="${visibleVal}"` : attrVisible);
      const mediaVal = el.getAttribute(attrMedia);
      if (mediaVal) parts.push(`${attrMedia}="${mediaVal}"`);
      const idleVal = el.getAttribute(attrIdle);
      if (idleVal !== null) parts.push(idleVal ? `${attrIdle}="${idleVal}"` : attrIdle);
      const deferVal = el.getAttribute(attrDefer);
      if (deferVal !== null) parts.push(deferVal ? `${attrDefer}="${deferVal}"` : attrDefer);
      if (customDirectives?.size) {
        for (const a of customDirectives.keys()) {
          if (el.hasAttribute(a)) parts.push(a);
        }
      }
      if (parts.length > 0) console.log("[islands]", `<${tagName}> waiting · ${parts.join(", ")}`);
    }

    // Buffer subsequent stages; flush as a collapsed group if there were any,
    // or as a flat log if the island triggered with no intermediate steps
    const msgs: string[] = [];
    const note = debug ? (msg: string) => msgs.push(msg) : () => {};
    const flush = debug
      ? (final: string) => {
          if (msgs.length === 0) {
            console.log("[islands]", `<${tagName}> ${final}`);
          } else {
            console.groupCollapsed(`[islands] <${tagName}> ${final}`);
            for (const m of msgs) console.log(m);
            console.groupEnd();
          }
        }
      : () => {};
    try {
      const visibleAttr = el.getAttribute(attrVisible);
      if (visibleAttr !== null) {
        // Per-element value overrides global rootMargin (e.g. client:visible="0px")
        note(`waiting for ${attrVisible}`);
        await visible(el, visibleAttr || rootMargin, threshold, pendingVisible);
      }
      const query = el.getAttribute(attrMedia);
      if (query === "") {
        console.warn(`[islands] <${tagName}> ${attrMedia} has no value — skipping media check`);
      } else if (query) {
        note(`waiting for ${attrMedia}="${query}"`);
        await media(query);
      }
      const idleAttr = el.getAttribute(attrIdle);
      if (idleAttr !== null) {
        // Per-element value overrides global timeout (e.g. client:idle="1000")
        // parseInt('', 10) === NaN, so the empty-string case is covered by the NaN check
        const raw = parseInt(idleAttr, 10);
        const elTimeout = Number.isNaN(raw) ? idleTimeout : raw;
        note(`waiting for ${attrIdle} (${elTimeout}ms)`);
        await idle(elTimeout);
      }
      const d = el.getAttribute(attrDefer);
      if (d !== null) {
        const raw = parseInt(d, 10);
        const ms = Number.isNaN(raw) ? deferDelay : raw;
        if (d !== "" && Number.isNaN(raw)) {
          console.warn(
            `[islands] <${tagName}> invalid ${attrDefer} value "${d}" — using default ${deferDelay}ms`,
          );
        }
        note(`waiting for ${attrDefer} (${ms}ms)`);
        await defer(ms);
      }
    } catch {
      // element was removed from the DOM before all conditions were met — skip loading
      flush("aborted (element removed)");
      return;
    }

    const run = () =>
      loader()
        .then(() => {
          loaded.add(tagName);
          if (el.children.length) walk(el); // pick up child islands now that parent has loaded
        })
        .catch((err) => {
          console.error(`[islands] Failed to load <${tagName}>:`, err);
          queued.delete(tagName);
        });

    // Custom directives run after built-ins — the directive owns the load() call
    if (customDirectives?.size) {
      const matched: Array<[string, ClientDirective]> = [];
      for (const [attrName, directiveFn] of customDirectives) {
        if (el.hasAttribute(attrName)) matched.push([attrName, directiveFn]);
      }
      if (matched.length > 1) {
        console.warn(
          `[islands] <${tagName}> has multiple custom directives (${matched.map(([a]) => a).join(", ")}) — only "${matched[0][0]}" will be used. Combining custom directives is not yet supported.`,
        );
      }
      if (matched.length > 0) {
        const [attrName, directiveFn] = matched[0];
        flush(`dispatching to custom directive ${attrName}`);
        directiveFn(run, { name: attrName, value: el.getAttribute(attrName)! }, el);
        return; // directive owns the load call
      }
    }

    flush("triggered");
    run();
  }

  function activate(el: HTMLElement): void {
    const tagName = el.tagName.toLowerCase();
    if (queued.has(tagName)) return;
    const loader = islandMap.get(tagName);
    if (!loader) return;

    // Don't activate if this element is inside a queued-but-not-yet-loaded parent island
    let ancestor = el.parentElement;
    while (ancestor) {
      if (isUnloadedIsland(ancestor.tagName.toLowerCase())) return;
      ancestor = ancestor.parentElement;
    }

    queued.add(tagName);
    loadIsland(tagName, el, loader);
  }

  // Walk a subtree using a native TreeWalker — faster than JS recursion for large DOMs
  // and avoids stack overflow on deeply nested pages
  function walk(el: HTMLElement): void {
    activate(el);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT, customElementFilter);
    let node: Node | null;
    while ((node = walker.nextNode())) activate(node as HTMLElement);
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
        if (node.nodeType === Node.ELEMENT_NODE) walk(node as HTMLElement);
      }
    }
  });

  function init(): void {
    if (debug) console.groupCollapsed(`[islands] ready — ${islandMap.size} island(s)`);
    walk(document.body);
    initDone = true;
    if (debug) console.groupEnd();
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  return () => observer.disconnect();
}
