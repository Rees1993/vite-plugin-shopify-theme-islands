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
import { createActivationSession } from "./activation-session.js";
import { createIslandLifecycleCoordinator } from "./lifecycle.js";
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

  const lifecycle = createIslandLifecycleCoordinator({
    retries: opts.retry.retries,
    retryDelay: opts.retry.delay,
  });
  let disconnected = false;

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

  const session = createActivationSession({
    directives: opts.directives,
    debug: opts.debug,
    directiveTimeout: opts.directiveTimeout,
    customDirectives: payload.customDirectives,
    ownership: lifecycle,
    surface: runtimeSurface,
    platform: {
      now: () => performance.now(),
      console,
      setTimeout,
      clearTimeout,
    },
  });

  let endReadyLog: (() => void) | undefined;
  const disconnectLifecycle = lifecycle.start({
    getRoot: () => document.body,
    islandMap,
    onDiscover: (tagName, el) => session.discover(tagName, el),
    onActivate: (tagName, el, loader) => {
      void session.activate({ tagName, element: el, loader });
    },
    onBeforeInitialWalk: () => {
      endReadyLog = runtimeSurface.beginReadyLog(islandMap.size, opts.debug);
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
    session.clear();
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
        session.clear(collectSubtreeTags(root));
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
