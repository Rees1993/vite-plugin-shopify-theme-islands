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
import {
  createDirectiveSpine,
  DEFAULT_DIRECTIVE_SPINE,
  extendDirectiveSpine,
} from "./directive-spine.js";
import { createIslandLifecycleCoordinator } from "./lifecycle.js";
import { getRuntimeSurface } from "./runtime-surface.js";
import { createRuntimeObservability } from "./runtime-observability.js";
import { createRootOwnershipCoordinator } from "./runtime-ownership.js";

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
  const baseSpine = payload.options?.directives
    ? createDirectiveSpine(opts.directives)
    : DEFAULT_DIRECTIVE_SPINE;
  const spine = extendDirectiveSpine(baseSpine, payload.customDirectives);

  const lifecycle = createIslandLifecycleCoordinator({
    retries: opts.retry.retries,
    retryDelay: opts.retry.delay,
  });
  const observability = createRuntimeObservability({
    spine,
    debug: opts.debug,
    isObserved: (element) => lifecycle.isObserved(element),
    console,
  });
  const debugBoundSurface = {
    dispatchLoad: runtimeSurface.dispatchLoad,
    dispatchError: runtimeSurface.dispatchError,
    createLogger: (tagName: string) => runtimeSurface.createLogger(tagName, opts.debug),
    beginReadyLog: (islandCount: number) => runtimeSurface.beginReadyLog(islandCount, opts.debug),
  };
  const session = createActivationSession({
    spine,
    directiveTimeout: opts.directiveTimeout,
    ownership: lifecycle,
    surface: debugBoundSurface,
    observability,
    platform: {
      now: () => performance.now(),
      console: {
        error: console.error.bind(console),
        warn: console.warn.bind(console),
      },
    },
  });

  return createRootOwnershipCoordinator({
    islandMap,
    lifecycle,
    session,
    surface: debugBoundSurface,
  });
}
