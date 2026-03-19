/**
 * Island architecture runtime for Shopify themes.
 *
 * Walks the DOM for custom elements that match island files, then loads them
 * lazily based on client directives:
 *
 *   client:visible     — load when the element scrolls into view
 *   client:media       — load when a CSS media query matches
 *   client:idle        — load when the browser has idle time
 *   client:defer       — load after a fixed delay (ms value on the attribute)
 *   client:interaction — load on mouseenter / touchstart / focusin (or custom events)
 *
 * Directives can be combined; all conditions must be met before loading.
 * A MutationObserver re-runs the same logic for elements added dynamically.
 */

import {
  buildIslandMap,
  normalizeReviveOptions,
  type ClientDirective,
  type IslandLoader,
  type ReviveOptions,
  type RevivePayload,
} from "./contract.js";
import { createDirectiveOrchestrator, DirectiveCancelledError } from "./directive-orchestration.js";
import { getRuntimeSurface } from "./runtime-surface.js";

function isRevivePayload(v: unknown): v is RevivePayload {
  return typeof v === "object" && v !== null && "islands" in v && !Array.isArray(v);
}

// ─── Island Loading State Registry ───────────────────────────────────────────

interface IslandRegistry {
  /**
   * Attempt to claim a tag name for loading.
   * Returns false if already queued or loaded — lets activate() bail early without
   * a separate read.
   */
  queue(tag: string): boolean;

  /** Mark tag as loaded. Returns the 1-based attempt number for the islands:load event. */
  settleSuccess(tag: string): number;
  /** Record a load failure. Returns next retry delay in ms, or null if retries exhausted (tag evicted). */
  settleFailure(tag: string): { retryDelayMs: number | null; attempt: number };

  /**
   * Immediately evict a tag from the registry — used by directive errors that
   * should abandon the island without going through retry logic.
   */
  evict(tag: string): void;

  /**
   * Returns true if the tag is queued but not yet loaded.
   * Used by customElementFilter (NodeFilter.FILTER_REJECT) and the ancestor walk
   * in activate() to defer child islands until the parent resolves.
   */
  isQueued(tag: string): boolean;

  /** True once the initial DOM walk has completed (suppresses "waiting · ..." logs). */
  readonly initialWalkComplete: boolean;

  /** Called exactly once at the end of init(). */
  markInitialWalkComplete(): void;

  /** Register a cancel callback for an element awaiting a cancellable directive. */
  watchCancellable(el: Element, cancel: () => void): () => void;

  /**
   * Remove and invoke cancel callbacks for every element no longer connected to the DOM.
   * Called by handleRemovals() — owns the isConnected scan internally.
   */
  cancelDetached(): void;
}

function createIslandRegistry(opts: { retries: number; retryDelay: number }): IslandRegistry {
  const queued = new Set<string>();
  const loaded = new Set<string>();
  const retryCount = new Map<string, number>();
  const cancellableElements = new Map<Element, () => void>();
  let initialWalkComplete = false;

  return {
    queue(tag: string): boolean {
      if (queued.has(tag) || loaded.has(tag)) return false;
      queued.add(tag);
      return true;
    },

    settleSuccess(tag: string): number {
      const attempt = (retryCount.get(tag) ?? 0) + 1;
      queued.delete(tag);
      loaded.add(tag);
      retryCount.delete(tag);
      return attempt;
    },

    settleFailure(tag: string): { retryDelayMs: number | null; attempt: number } {
      const attempt = (retryCount.get(tag) ?? 0) + 1;
      if (attempt <= opts.retries) {
        retryCount.set(tag, attempt);
        return { retryDelayMs: opts.retryDelay * 2 ** (attempt - 1), attempt };
      } else {
        retryCount.delete(tag);
        queued.delete(tag);
        return { retryDelayMs: null, attempt };
      }
    },

    evict(tag: string): void {
      retryCount.delete(tag);
      queued.delete(tag);
    },

    isQueued(tag: string): boolean {
      return queued.has(tag);
    },

    get initialWalkComplete(): boolean {
      return initialWalkComplete;
    },

    markInitialWalkComplete(): void {
      initialWalkComplete = true;
    },

    watchCancellable(el: Element, cancel: () => void): () => void {
      cancellableElements.set(el, cancel);
      return () => {
        cancellableElements.delete(el);
      };
    },

    cancelDetached(): void {
      if (cancellableElements.size === 0) return;
      for (const [el, cancel] of cancellableElements) {
        if (!el.isConnected) {
          cancellableElements.delete(el);
          cancel();
        }
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────

export function revive(payload: RevivePayload): { disconnect: () => void };
/** @deprecated Pass a RevivePayload object instead. Will be removed in v2.0. */
export function revive(
  islands: Record<string, IslandLoader>,
  options?: ReviveOptions,
  customDirectives?: Map<string, ClientDirective>,
): { disconnect: () => void };
export function revive(
  islandsOrPayload: RevivePayload | Record<string, IslandLoader>,
  options?: ReviveOptions,
  customDirectives?: Map<string, ClientDirective>,
): { disconnect: () => void } {
  const runtimeSurface = getRuntimeSurface();
  const payload: RevivePayload = isRevivePayload(islandsOrPayload)
    ? islandsOrPayload
    : { islands: islandsOrPayload as Record<string, IslandLoader>, options, customDirectives };
  const opts = normalizeReviveOptions(payload.options);
  const islandMap = buildIslandMap(payload);
  const resolvedDirectives = payload.customDirectives;

  const attrVisible = opts.directives.visible.attribute;
  const attrMedia = opts.directives.media.attribute;
  const attrIdle = opts.directives.idle.attribute;
  const attrDefer = opts.directives.defer.attribute;
  const attrInteraction = opts.directives.interaction.attribute;
  const debug = opts.debug;
  const directiveTimeout = opts.directiveTimeout;

  const registry = createIslandRegistry({
    retries: opts.retry.retries,
    retryDelay: opts.retry.delay,
  });
  const directiveOrchestrator = createDirectiveOrchestrator();

  // NodeFilter that accepts custom elements (tag names containing a hyphen),
  // skips (but still descends into) non-custom elements, and rejects the subtree
  // of any queued-but-not-yet-loaded island (children are walked after the parent loads).
  const customElementFilter: NodeFilter = {
    acceptNode: (node) => {
      const tag = (node as Element).tagName;
      if (!tag.includes("-")) return NodeFilter.FILTER_SKIP;
      const lowerTag = tag.toLowerCase();
      if (registry.isQueued(lowerTag)) return NodeFilter.FILTER_REJECT;
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
    if (debug && !registry.initialWalkComplete) {
      const parts: string[] = [];
      // Push `attr` or `attr="val"` when the element has the attribute; skip null (absent)
      const pushAttr = (attr: string, val: string | null) => {
        if (val !== null) parts.push(val ? `${attr}="${val}"` : attr);
      };
      pushAttr(attrVisible, el.getAttribute(attrVisible));
      // client:media excluded when empty — it warns+skips, so the island fires immediately
      const mediaVal = el.getAttribute(attrMedia);
      if (mediaVal) parts.push(`${attrMedia}="${mediaVal}"`);
      pushAttr(attrIdle, el.getAttribute(attrIdle));
      pushAttr(attrDefer, el.getAttribute(attrDefer));
      pushAttr(attrInteraction, el.getAttribute(attrInteraction));
      if (resolvedDirectives?.size) {
        for (const a of resolvedDirectives.keys()) {
          if (el.hasAttribute(a)) parts.push(a);
        }
      }
      if (parts.length > 0) console.log("[islands]", `<${tagName}> waiting · ${parts.join(", ")}`);
    }

    const log = runtimeSurface.createLogger(tagName, debug);

    const run = (): Promise<void> => {
      if (disconnected) return Promise.resolve();
      const t0 = performance.now();
      return loader()
        .then(() => {
          const attempt = registry.settleSuccess(tagName);
          runtimeSurface.dispatchLoad({
            tag: tagName,
            duration: performance.now() - t0,
            attempt,
          });
          if (el.children.length) walk(el); // pick up child islands now that parent has loaded
        })
        .catch((err) => {
          console.error(`[islands] Failed to load <${tagName}>:`, err);
          const { retryDelayMs, attempt } = registry.settleFailure(tagName);
          runtimeSurface.dispatchError({ tag: tagName, error: err, attempt });
          if (retryDelayMs !== null) {
            setTimeout(run, retryDelayMs);
          }
        });
    };

    const handleDirectiveError = (attrName: string | null, err: unknown) => {
      if (attrName === null && err instanceof DirectiveCancelledError) return;
      if (attrName !== null) {
        console.error(`[islands] Custom directive ${attrName} failed for <${tagName}>:`, err);
      } else {
        console.error(`[islands] Built-in directive failed for <${tagName}>:`, err);
      }
      runtimeSurface.dispatchError({ tag: tagName, error: err, attempt: 1 });
      registry.evict(tagName);
    };

    try {
      const matchedCustomDirectives = await directiveOrchestrator.run({
        tagName,
        element: el,
        directives: opts.directives,
        customDirectives: resolvedDirectives,
        directiveTimeout,
        watchCancellable: registry.watchCancellable,
        log,
        run,
        onError: handleDirectiveError,
      });
      if (matchedCustomDirectives) return;
    } catch (err) {
      handleDirectiveError(null, err);
      log.flush(
        err instanceof DirectiveCancelledError
          ? "aborted (element removed)"
          : "aborted (directive error)",
      );
      return;
    }

    log.flush("triggered");
    run();
  }

  function activate(el: HTMLElement): void {
    const tagName = el.tagName.toLowerCase();
    const loader = islandMap.get(tagName);
    if (!loader) return;

    // Don't activate if this element is inside a queued-but-not-yet-loaded parent island
    let ancestor = el.parentElement;
    while (ancestor) {
      if (registry.isQueued(ancestor.tagName.toLowerCase())) return;
      ancestor = ancestor.parentElement;
    }

    if (!registry.queue(tagName)) return; // false = already queued or loaded
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

  // Activate islands added dynamically.
  function handleAdditions(mutations: MutationRecord[]): void {
    for (const { addedNodes } of mutations) {
      for (const node of addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) walk(node as HTMLElement);
      }
    }
  }

  const observer = new MutationObserver((mutations) => {
    registry.cancelDetached();
    handleAdditions(mutations);
  });

  let disconnected = false;
  let initialized = false;

  function init(): void {
    if (disconnected || initialized) return;
    initialized = true;
    const endReadyLog = runtimeSurface.beginReadyLog(islandMap.size, debug);
    walk(document.body);
    registry.markInitialWalkComplete();
    endReadyLog();
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  const disconnect = () => {
    disconnected = true;
    document.removeEventListener("DOMContentLoaded", init);
    observer.disconnect();
  };
  return { disconnect };
}
