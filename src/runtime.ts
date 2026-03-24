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
import { createActivationPipeline } from "./activation-pipeline.js";
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
  const debug = opts.debug;
  const directiveTimeout = opts.directiveTimeout;

  const lifecycle = createIslandLifecycleCoordinator({
    retries: opts.retry.retries,
    retryDelay: opts.retry.delay,
  });
  const activationPipeline = createActivationPipeline({
    directives: opts.directives,
    customDirectives: resolvedDirectives,
    debug,
    directiveTimeout,
    lifecycle,
    runtimeSurface,
  });
  const disconnectLifecycle = lifecycle.start({
    getRoot: () => document.body,
    islandMap,
    onActivate: activationPipeline.activate,
    onBeforeInitialWalk: () => {
      activationPipeline.beginInitialWalk(islandMap.size);
    },
    onInitialWalkComplete: () => {
      activationPipeline.completeInitialWalk();
    },
  });
  return {
    disconnect() {
      activationPipeline.disconnect();
      disconnectLifecycle.disconnect();
    },
  };
}
