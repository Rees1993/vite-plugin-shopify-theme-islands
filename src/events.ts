import type { IslandLoadDetail, IslandErrorDetail } from "./contract.js";
import { getRuntimeSurface } from "./runtime-surface.js";

/**
 * Listen for successful island module loads.
 *
 * Returns a cleanup function that removes the listener.
 *
 * @example
 * ```ts
 * import { onIslandLoad } from "vite-plugin-shopify-theme-islands/events";
 *
 * const off = onIslandLoad(({ tag }) => {
 *   analytics.track("island_loaded", { tag });
 * });
 * ```
 */
export function onIslandLoad(handler: (detail: IslandLoadDetail) => void): () => void {
  return getRuntimeSurface().onLoad(handler);
}

/**
 * Listen for island load or custom directive failures.
 *
 * Fires on each retry attempt, not just the final failure.
 * Returns a cleanup function that removes the listener.
 *
 * @example
 * ```ts
 * import { onIslandError } from "vite-plugin-shopify-theme-islands/events";
 *
 * const off = onIslandError(({ tag, error }) => {
 *   errorReporter.capture(error, { context: tag });
 * });
 * ```
 */
export function onIslandError(handler: (detail: IslandErrorDetail) => void): () => void {
  return getRuntimeSurface().onError(handler);
}
