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
import { createIslandLifecycleCoordinator } from "./lifecycle.js";
import { getRuntimeSurface } from "./runtime-surface.js";

function isRevivePayload(v: unknown): v is RevivePayload {
  return typeof v === "object" && v !== null && "islands" in v && !Array.isArray(v);
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

  const lifecycle = createIslandLifecycleCoordinator({
    retries: opts.retry.retries,
    retryDelay: opts.retry.delay,
  });
  const directiveOrchestrator = createDirectiveOrchestrator();
  let disconnected = false;

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

    const run = (): Promise<void> => {
      if (disconnected) return Promise.resolve();
      const t0 = performance.now();
      return loader()
        .then(() => {
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

  const endReadyLog = runtimeSurface.beginReadyLog(islandMap.size, debug);
  const disconnectLifecycle = lifecycle.start({
    root: document.body,
    islandMap,
    onActivate: loadIsland,
    onInitialWalkComplete: endReadyLog,
  });
  return {
    disconnect() {
      disconnected = true;
      disconnectLifecycle.disconnect();
    },
  };
}
