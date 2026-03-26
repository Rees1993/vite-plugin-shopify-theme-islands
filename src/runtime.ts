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

import { buildIslandMap, normalizeReviveOptions, type RevivePayload } from "./contract.js";
import { createDirectiveOrchestrator, DirectiveCancelledError } from "./directive-orchestration.js";
import { createIslandLifecycleCoordinator } from "./lifecycle.js";
import { describeEffectiveLoadGate } from "./load-gates.js";
import { getRuntimeSurface } from "./runtime-surface.js";
import { connectShopifyLifecycle } from "./shopify-lifecycle.js";

function isRevivePayload(v: unknown): v is RevivePayload {
  return typeof v === "object" && v !== null && "islands" in v && !Array.isArray(v);
}

// ─────────────────────────────────────────────────────────────────────────────

export interface ReviveRuntime {
  disconnect: () => void;
  scan: (root?: HTMLElement | null) => void;
  observe: (root?: HTMLElement | null) => void;
  unobserve: (root?: HTMLElement | null) => void;
}

export function revive(payload: RevivePayload): ReviveRuntime {
  const runtimeSurface = getRuntimeSurface();
  if (!isRevivePayload(payload)) {
    throw new TypeError(
      "[islands] revive() now requires a RevivePayload object. Pass { islands, options?, customDirectives?, resolvedTags? }.",
    );
  }
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
  const discoveredElementsByTag = new Map<string, Set<HTMLElement>>();
  const warnedLoadGateSignatures = new Map<string, string>();

  const lifecycle = createIslandLifecycleCoordinator({
    retries: opts.retry.retries,
    retryDelay: opts.retry.delay,
  });
  const directiveOrchestrator = createDirectiveOrchestrator();
  let disconnected = false;
  const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const clearRetryTimer = (tagName: string): void => {
    const timer = retryTimers.get(tagName);
    if (timer === undefined) return;
    clearTimeout(timer);
    retryTimers.delete(tagName);
  };

  const clearRetryTimers = (tagNames?: Iterable<string>): void => {
    if (tagNames) {
      for (const tagName of tagNames) clearRetryTimer(tagName);
      return;
    }

    for (const timer of retryTimers.values()) clearTimeout(timer);
    retryTimers.clear();
  };

  const collectSubtreeTags = (root: HTMLElement): Set<string> => {
    const tags = new Set<string>();
    const collect = (el: Element) => {
      const tagName = el.tagName.toLowerCase();
      if (islandMap.has(tagName)) tags.add(tagName);
    };

    collect(root);
    for (const el of root.querySelectorAll("*")) collect(el);
    return tags;
  };

  const clearTagState = (tagNames?: Iterable<string>): void => {
    if (tagNames) {
      for (const tagName of tagNames) {
        clearRetryTimer(tagName);
        discoveredElementsByTag.delete(tagName);
        warnedLoadGateSignatures.delete(tagName);
        lifecycle.evict(tagName);
      }
      return;
    }

    clearRetryTimers();
    clearLoadGateTracking();
  };

  const clearLoadGateTracking = (tagNames?: Iterable<string>): void => {
    if (tagNames) {
      for (const tagName of tagNames) {
        discoveredElementsByTag.delete(tagName);
        warnedLoadGateSignatures.delete(tagName);
      }
      return;
    }

    discoveredElementsByTag.clear();
    warnedLoadGateSignatures.clear();
  };

  const warnOnConflictingLoadGate = (tagName: string, el: HTMLElement): void => {
    if (!debug) return;

    const elements = discoveredElementsByTag.get(tagName) ?? new Set<HTMLElement>();
    elements.add(el);
    discoveredElementsByTag.set(tagName, elements);

    const gates = new Set<string>();
    for (const candidate of elements) {
      if (!candidate.isConnected || !lifecycle.isObserved(candidate)) {
        elements.delete(candidate);
        continue;
      }
      gates.add(describeEffectiveLoadGate(candidate, opts.directives, resolvedDirectives));
    }

    if (elements.size === 0) {
      discoveredElementsByTag.delete(tagName);
      warnedLoadGateSignatures.delete(tagName);
      return;
    }

    if (gates.size <= 1) {
      warnedLoadGateSignatures.delete(tagName);
      return;
    }

    const signature = [...gates].sort().join(" vs ");
    if (warnedLoadGateSignatures.get(tagName) === signature) return;
    warnedLoadGateSignatures.set(tagName, signature);
    console.warn(
      `[islands] Found same tag <${tagName}> with conflicting directive gates (${signature}). Directives load code at the tag level, so the first-resolved instance wins for this tag.`,
    );
  };

  async function loadIsland(
    tagName: string,
    el: HTMLElement,
    loader: () => Promise<unknown>,
  ): Promise<void> {
    // Show which directives the island is waiting on inside the init group. Skipped for
    // dynamic (post-init) activations — the completion group is sufficient there.
    // Empty client:media is excluded: it's warned and skipped, so the island fires immediately.
    if (debug && !lifecycle.initialWalkComplete) {
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

    const abortIfInactive = (): boolean => {
      if (!disconnected && lifecycle.isObserved(el)) return false;
      clearRetryTimer(tagName);
      lifecycle.evict(tagName);
      return true;
    };

    const run = (): Promise<void> => {
      if (abortIfInactive()) return Promise.resolve();
      const t0 = performance.now();
      return loader()
        .then(() => {
          if (abortIfInactive()) return;
          clearRetryTimer(tagName);
          const attempt = lifecycle.settleSuccess(tagName);
          runtimeSurface.dispatchLoad({
            tag: tagName,
            duration: performance.now() - t0,
            attempt,
          });
          if (!disconnected && el.children.length) lifecycle.walk(el);
        })
        .catch((err) => {
          console.error(`[islands] Failed to load <${tagName}>:`, err);
          const { retryDelayMs, attempt } = lifecycle.settleFailure(tagName);
          runtimeSurface.dispatchError({ tag: tagName, error: err, attempt });
          if (retryDelayMs !== null) {
            clearRetryTimer(tagName);
            const timer = setTimeout(() => {
              retryTimers.delete(tagName);
              void run();
            }, retryDelayMs);
            retryTimers.set(tagName, timer);
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
      clearRetryTimer(tagName);
      lifecycle.evict(tagName);
    };

    try {
      const matchedCustomDirectives = await directiveOrchestrator.run({
        tagName,
        element: el,
        directives: opts.directives,
        customDirectives: resolvedDirectives,
        directiveTimeout,
        watchCancellable: lifecycle.watchCancellable,
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

  let endReadyLog: (() => void) | undefined;
  const disconnectLifecycle = lifecycle.start({
    getRoot: () => document.body,
    islandMap,
    onDiscover: warnOnConflictingLoadGate,
    onActivate: loadIsland,
    onBeforeInitialWalk: () => {
      endReadyLog = runtimeSurface.beginReadyLog(islandMap.size, debug);
    },
    onInitialWalkComplete: () => {
      endReadyLog?.();
      endReadyLog = undefined;
    },
  });

  const disconnectRoot = (root: HTMLElement | null = document.body): void => {
    if (root !== document.body) return;
    lifecycle.excludeRoot(document.body);
    disconnected = true;
    clearTagState();
    endReadyLog?.();
    endReadyLog = undefined;
    disconnectLifecycle.disconnect();
  };

  const runtime: ReviveRuntime = {
    scan(root = document.body) {
      if (disconnected || !root) return;
      lifecycle.walk(root);
    },
    observe(root = document.body) {
      if (disconnected || !root) return;
      if (root !== document.body) lifecycle.includeRoot(root);
      lifecycle.walk(root);
    },
    unobserve(root = document.body) {
      if (root && root !== document.body) {
        clearTagState(collectSubtreeTags(root));
        lifecycle.excludeRoot(root);
        return;
      }
      disconnectRoot(root);
    },
    disconnect() {
      disconnectRoot(document.body);
    },
  };

  const disconnectShopifyLifecycle = connectShopifyLifecycle(runtime);

  return {
    ...runtime,
    disconnect() {
      disconnectShopifyLifecycle();
      runtime.disconnect();
    },
  };
}
