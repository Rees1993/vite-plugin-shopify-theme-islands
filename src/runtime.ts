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

// Typed helper — event name and detail shape are checked against DocumentEventMap
const dispatch = <K extends "islands:load" | "islands:error">(
  name: K,
  detail: DocumentEventMap[K] extends CustomEvent<infer D> ? D : never,
) => document.dispatchEvent(new CustomEvent(name, { detail }));

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

// Resolves when any of the given DOM events fires on the element.
// Registers a cancel function in `pending` so the outer MutationObserver can
// abort this if the element is removed from the DOM before interacting.
function interaction(
  element: Element,
  events: string[],
  pending: Map<Element, () => void>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      for (const name of events) element.removeEventListener(name, handler);
      pending.delete(element);
    };
    const handler = () => {
      cleanup();
      resolve();
    };
    for (const name of events) element.addEventListener(name, handler);
    pending.set(element, () => {
      cleanup();
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

const noop = (..._: unknown[]) => {};

function isRevivePayload(v: unknown): v is RevivePayload {
  return typeof v === "object" && v !== null && "islands" in v && !Array.isArray(v);
}

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
  const interactionEvents = opts.directives.interaction.events;
  const rootMargin = opts.directives.visible.rootMargin;
  const threshold = opts.directives.visible.threshold;
  const idleTimeout = opts.directives.idle.timeout;
  const deferDelay = opts.directives.defer.delay;
  const debug = opts.debug;
  const retries = opts.retry.retries;
  const retryDelay = opts.retry.delay;
  const directiveTimeout = opts.directiveTimeout;

  // Track queued tag names to avoid duplicate customElements.define calls
  const queued = new Set<string>();

  // Set to true after the initial DOM walk — suppresses the upfront "waiting · ..." log for
  // dynamically added islands, where the completion group alone is sufficient.
  let initDone = false;

  // Track successfully loaded tag names so child islands can activate after their parent loads
  const loaded = new Set<string>();

  // Elements awaiting a cancellable directive (client:visible, client:interaction) — maps
  // element to its cancel function. Checked by the MutationObserver to abort loading if removed.
  const pendingCancellable = new Map<Element, () => void>();

  // Tracks auto-retry attempts per tag — cleared on success or exhaustion.
  const retryCount = new Map<string, number>();

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

  // Stage 1: await all built-in directives in order. Throws if element is removed (cancellable reject).
  async function applyBuiltInDirectives(
    tagName: string,
    el: HTMLElement,
    note: (msg: string) => void,
  ): Promise<void> {
    const visibleAttr = el.getAttribute(attrVisible);
    if (visibleAttr !== null) {
      // Per-element value overrides global rootMargin (e.g. client:visible="0px")
      note(`waiting for ${attrVisible}`);
      await visible(el, visibleAttr || rootMargin, threshold, pendingCancellable);
    }
    const query = el.getAttribute(attrMedia);
    if (query === "") {
      console.warn(
        `[islands] <${tagName}> ${attrMedia} has no value — media check skipped, island will load immediately`,
      );
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
      const dMs = parseInt(d, 10);
      if (d !== "" && Number.isNaN(dMs)) {
        console.warn(
          `[islands] <${tagName}> invalid ${attrDefer} value "${d}" — using default ${deferDelay}ms`,
        );
      }
      const ms = Number.isNaN(dMs) ? deferDelay : dMs;
      note(`waiting for ${attrDefer} (${ms}ms)`);
      await defer(ms);
    }
    const interactionAttr = el.getAttribute(attrInteraction);
    if (interactionAttr !== null) {
      // Per-element value overrides global events (space-separated MDN event names)
      let events = interactionEvents;
      if (interactionAttr) {
        const tokens = interactionAttr.split(/\s+/).filter(Boolean);
        if (tokens.length > 0) events = tokens;
        else
          console.warn(
            `[islands] <${tagName}> ${attrInteraction} has no valid event tokens — using default events`,
          );
      }
      note(`waiting for ${attrInteraction} (${events.join(", ")})`);
      await interaction(el, events, pendingCancellable);
    }
  }

  // Stage 2: AND latch — all matched custom directives must call load() before the island activates.
  // Returns true if a directive matched (directive owns the load call); false if no match.
  function applyCustomDirectives(
    tagName: string,
    el: HTMLElement,
    matched: Array<[string, ClientDirective, string]>,
    run: () => Promise<void>,
    handleDirectiveError: (attrName: string, err: unknown) => void,
    flush: (msg: string) => void,
  ): boolean {
    if (matched.length === 0) return false;

    // With a single directive, remaining hits 0 on the first call — identical to passing run directly.
    flush(
      `dispatching to custom directive${matched.length === 1 ? "" : "s"} ${matched.map(([a]) => a).join(", ")}`,
    );
    let remaining = matched.length;
    let fired = false;
    let aborted = false;
    const loadOnce = () => {
      if (fired || aborted) return Promise.resolve();
      if (--remaining === 0) {
        clearTimeout(timer);
        fired = true;
        return run();
      }
      return Promise.resolve();
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (directiveTimeout > 0) {
      timer = setTimeout(() => {
        if (fired || aborted) return;
        aborted = true;
        const err = new Error(
          `[islands] Custom directive timed out after ${directiveTimeout}ms for <${tagName}>`,
        );
        console.error(err.message);
        dispatch("islands:error", { tag: tagName, error: err, attempt: 1 });
        retryCount.delete(tagName);
        queued.delete(tagName);
      }, directiveTimeout);
    }
    for (const [attrName, directiveFn, value] of matched) {
      try {
        Promise.resolve(directiveFn(loadOnce, { name: attrName, value }, el)).catch((err) => {
          clearTimeout(timer);
          aborted = true;
          handleDirectiveError(attrName, err);
        });
      } catch (err) {
        clearTimeout(timer);
        aborted = true;
        handleDirectiveError(attrName, err);
      }
    }
    return true; // directive owns the load call
  }

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

    // Buffer subsequent stages; flush as a collapsed group if there were any,
    // or as a flat log if the island triggered with no intermediate steps
    const msgs = debug ? ([] as string[]) : null;
    const note = msgs ? (msg: string) => msgs.push(msg) : noop;
    const flushLog = msgs
      ? (final: string) => {
          if (msgs.length === 0) {
            console.log("[islands]", `<${tagName}> ${final}`);
          } else {
            console.groupCollapsed(`[islands] <${tagName}> ${final}`);
            for (const m of msgs) console.log(m);
            console.groupEnd();
          }
        }
      : noop;

    // Stage 1: built-in directives
    try {
      await applyBuiltInDirectives(tagName, el, note);
    } catch {
      // element was removed from the DOM before all conditions were met — skip loading
      flushLog("aborted (element removed)");
      return;
    }

    // Stage 2: retry-aware loader
    const run = (): Promise<void> => {
      if (disconnected) return Promise.resolve();
      const t0 = performance.now();
      return loader()
        .then(() => {
          const attempt = (retryCount.get(tagName) ?? 0) + 1;
          loaded.add(tagName);
          retryCount.delete(tagName);
          dispatch("islands:load", {
            tag: tagName,
            duration: performance.now() - t0,
            attempt,
          });
          if (el.children.length) walk(el); // pick up child islands now that parent has loaded
        })
        .catch((err) => {
          console.error(`[islands] Failed to load <${tagName}>:`, err);
          const attempt = retryCount.get(tagName) ?? 0;
          dispatch("islands:error", { tag: tagName, error: err, attempt: attempt + 1 });
          if (attempt < retries) {
            retryCount.set(tagName, attempt + 1);
            setTimeout(run, retryDelay * 2 ** attempt);
          } else {
            retryCount.delete(tagName);
            queued.delete(tagName);
          }
        });
    };

    const handleDirectiveError = (attrName: string, err: unknown) => {
      console.error(`[islands] Custom directive ${attrName} failed for <${tagName}>:`, err);
      dispatch("islands:error", { tag: tagName, error: err, attempt: 1 });
      retryCount.delete(tagName);
      queued.delete(tagName);
    };

    // Stage 3: custom directives (run after built-ins — the directive owns the load() call)
    if (resolvedDirectives?.size) {
      const matched: Array<[string, ClientDirective, string]> = [];
      for (const [attrName, directiveFn] of resolvedDirectives) {
        const value = el.getAttribute(attrName);
        if (value !== null) matched.push([attrName, directiveFn, value]);
      }
      if (applyCustomDirectives(tagName, el, matched, run, handleDirectiveError, flushLog)) return;
    }

    flushLog("triggered");
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

  // Cancel loading for any pending-cancellable elements that were removed from the DOM.
  function handleRemovals(mutations: MutationRecord[]): void {
    if (pendingCancellable.size === 0 || !mutations.some((m) => m.removedNodes.length > 0)) return;
    for (const [el, cancel] of pendingCancellable) {
      if (!el.isConnected) {
        pendingCancellable.delete(el);
        cancel();
      }
    }
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
    handleRemovals(mutations);
    handleAdditions(mutations);
  });

  function init(): void {
    if (debug) console.groupCollapsed(`[islands] ready — ${islandMap.size} island(s)`);
    walk(document.body);
    initDone = true;
    if (debug) console.groupEnd();
    observer.observe(document.body, { childList: true, subtree: true });
  }

  let disconnected = false;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  const disconnect = () => {
    disconnected = true;
    observer.disconnect();
  };
  return { disconnect };
}
