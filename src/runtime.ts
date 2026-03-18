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
// Calls watch(element, cancel) so the outer MutationObserver can abort this
// if the element is removed from the DOM before becoming visible.
function visible(
  element: Element,
  rootMargin: string,
  threshold: number,
  watch: (el: Element, cancel: () => void) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          io.disconnect();
          resolve();
        }
      },
      { rootMargin, threshold },
    );

    io.observe(element);
    watch(element, () => {
      io.disconnect();
      reject(new DirectiveCancelledError());
    });
  });
}

// Resolves when any of the given DOM events fires on the element.
// Calls watch(element, cancel) so the outer MutationObserver can abort this
// if the element is removed from the DOM before interacting.
function interaction(
  element: Element,
  events: string[],
  watch: (el: Element, cancel: () => void) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      for (const name of events) element.removeEventListener(name, handler);
    };
    const handler = () => {
      cleanup();
      resolve();
    };
    for (const name of events) element.addEventListener(name, handler);
    watch(element, () => {
      cleanup();
      reject(new DirectiveCancelledError());
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

interface IslandLogger {
  note(msg: string): void;
  flush(summary: string): void;
}

const NOOP_LOGGER: IslandLogger = {
  note(_) {},
  flush(_) {},
};

function createIslandLogger(tagName: string, debug: boolean): IslandLogger {
  if (!debug) return NOOP_LOGGER;
  const msgs: string[] = [];
  return {
    note(msg) {
      msgs.push(msg);
    },
    flush(summary) {
      if (msgs.length === 0) {
        console.log("[islands]", `<${tagName}> ${summary}`);
      } else {
        console.groupCollapsed(`[islands] <${tagName}> ${summary}`);
        for (const m of msgs) console.log(m);
        console.groupEnd();
      }
      msgs.length = 0;
    },
  };
}

// Thrown by visible() and interaction() cancel paths when the element is removed
// from the DOM before the directive condition is met. instanceof check is reliable
// across async boundaries; bare reject() was fragile (err === undefined heuristic).
class DirectiveCancelledError extends Error {
  constructor() {
    super("[islands] directive cancelled: element removed from DOM");
    this.name = "DirectiveCancelledError";
  }
}

type DirectiveOutcome =
  | { kind: "builtin-catch"; err: unknown }
  | { kind: "directive-error"; attrName: string; err: unknown };

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
  isBlockedBy(tag: string): boolean;

  /** True once the initial DOM walk has completed (suppresses "waiting · ..." logs). */
  readonly initDone: boolean;

  /** Called exactly once at the end of init(). */
  markInitDone(): void;

  /** Register a cancel callback for an element awaiting a cancellable directive. */
  watchCancellable(el: Element, cancel: () => void): void;

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
  const pendingCancellable = new Map<Element, () => void>();
  let initDone = false;

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

    isBlockedBy(tag: string): boolean {
      return queued.has(tag);
    },

    get initDone(): boolean {
      return initDone;
    },

    markInitDone(): void {
      initDone = true;
    },

    watchCancellable(el: Element, cancel: () => void): void {
      pendingCancellable.set(el, cancel);
    },

    cancelDetached(): void {
      if (pendingCancellable.size === 0) return;
      for (const [el, cancel] of pendingCancellable) {
        if (!el.isConnected) {
          pendingCancellable.delete(el);
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
  const directiveTimeout = opts.directiveTimeout;

  const registry = createIslandRegistry({
    retries: opts.retry.retries,
    retryDelay: opts.retry.delay,
  });

  // NodeFilter that accepts custom elements (tag names containing a hyphen),
  // skips (but still descends into) non-custom elements, and rejects the subtree
  // of any queued-but-not-yet-loaded island (children are walked after the parent loads).
  const customElementFilter: NodeFilter = {
    acceptNode: (node) => {
      const tag = (node as Element).tagName;
      if (!tag.includes("-")) return NodeFilter.FILTER_SKIP;
      const lowerTag = tag.toLowerCase();
      if (registry.isBlockedBy(lowerTag)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  };

  // Unified directive failure handler. Both built-in catch and custom directive errors route here.
  // Cancellation (element removed) is silent and leaves queued intact. Everything else fires islands:error.
  function makeDirectiveOutcomeHandler(tagName: string): (outcome: DirectiveOutcome) => void {
    return (outcome) => {
      if (outcome.kind === "builtin-catch" && outcome.err instanceof DirectiveCancelledError) {
        // Expected DOM removal — silent, queued intentionally preserved
        return;
      }
      const err = outcome.err;
      if (outcome.kind === "directive-error") {
        console.error(
          `[islands] Custom directive ${outcome.attrName} failed for <${tagName}>:`,
          err,
        );
      } else {
        console.error(`[islands] Built-in directive failed for <${tagName}>:`, err);
      }
      dispatch("islands:error", { tag: tagName, error: err, attempt: 1 });
      registry.evict(tagName);
    };
  }

  // Stage 1: await all built-in directives in order. Throws if element is removed (cancellable reject).
  async function applyBuiltInDirectives(
    tagName: string,
    el: HTMLElement,
    log: IslandLogger,
  ): Promise<void> {
    const visibleAttr = el.getAttribute(attrVisible);
    if (visibleAttr !== null) {
      // Per-element value overrides global rootMargin (e.g. client:visible="0px")
      log.note(`waiting for ${attrVisible}`);
      await visible(el, visibleAttr || rootMargin, threshold, registry.watchCancellable);
    }
    const query = el.getAttribute(attrMedia);
    if (query === "") {
      console.warn(
        `[islands] <${tagName}> ${attrMedia} has no value — media check skipped, island will load immediately`,
      );
    } else if (query) {
      log.note(`waiting for ${attrMedia}="${query}"`);
      await media(query);
    }
    const idleAttr = el.getAttribute(attrIdle);
    if (idleAttr !== null) {
      // Per-element value overrides global timeout (e.g. client:idle="1000")
      // parseInt('', 10) === NaN, so the empty-string case is covered by the NaN check
      const raw = parseInt(idleAttr, 10);
      const elTimeout = Number.isNaN(raw) ? idleTimeout : raw;
      log.note(`waiting for ${attrIdle} (${elTimeout}ms)`);
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
      log.note(`waiting for ${attrDefer} (${ms}ms)`);
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
      log.note(`waiting for ${attrInteraction} (${events.join(", ")})`);
      await interaction(el, events, registry.watchCancellable);
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
    log: IslandLogger,
  ): boolean {
    if (matched.length === 0) return false;

    const attrNames = matched.map(([a]) => a).join(", ");
    // With a single directive, remaining hits 0 on the first call — identical to passing run directly.
    log.flush(`dispatching to custom directive${matched.length === 1 ? "" : "s"} ${attrNames}`);
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
        handleDirectiveError(
          attrNames,
          new Error(
            `[islands] Custom directive timed out after ${directiveTimeout}ms for <${tagName}>`,
          ),
        );
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
    if (debug && !registry.initDone) {
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

    const log = createIslandLogger(tagName, debug);

    const handleOutcome = makeDirectiveOutcomeHandler(tagName);

    // Stage 1: built-in directives
    try {
      await applyBuiltInDirectives(tagName, el, log);
    } catch (err) {
      handleOutcome({ kind: "builtin-catch", err });
      log.flush(
        err instanceof DirectiveCancelledError
          ? "aborted (element removed)"
          : "aborted (directive error)",
      );
      return;
    }

    // Stage 2: retry-aware loader
    const run = (): Promise<void> => {
      if (disconnected) return Promise.resolve();
      const t0 = performance.now();
      return loader()
        .then(() => {
          const attempt = registry.settleSuccess(tagName);
          dispatch("islands:load", {
            tag: tagName,
            duration: performance.now() - t0,
            attempt,
          });
          if (el.children.length) walk(el); // pick up child islands now that parent has loaded
        })
        .catch((err) => {
          console.error(`[islands] Failed to load <${tagName}>:`, err);
          const { retryDelayMs, attempt } = registry.settleFailure(tagName);
          dispatch("islands:error", { tag: tagName, error: err, attempt });
          if (retryDelayMs !== null) {
            setTimeout(run, retryDelayMs);
          }
        });
    };

    const handleDirectiveError = (attrName: string, err: unknown) =>
      handleOutcome({ kind: "directive-error", attrName, err });

    // Stage 3: custom directives (run after built-ins — the directive owns the load() call)
    if (resolvedDirectives?.size) {
      const matched: Array<[string, ClientDirective, string]> = [];
      for (const [attrName, directiveFn] of resolvedDirectives) {
        const value = el.getAttribute(attrName);
        if (value !== null) matched.push([attrName, directiveFn, value]);
      }
      if (applyCustomDirectives(tagName, el, matched, run, handleDirectiveError, log)) return;
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
      if (registry.isBlockedBy(ancestor.tagName.toLowerCase())) return;
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

  function init(): void {
    if (debug) console.groupCollapsed(`[islands] ready — ${islandMap.size} island(s)`);
    walk(document.body);
    registry.markInitDone();
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
