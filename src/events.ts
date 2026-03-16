import type { IslandLoadDetail, IslandErrorDetail } from "./index.js";

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
  const listener = (e: CustomEvent<IslandLoadDetail>) => handler(e.detail);
  document.addEventListener("islands:load", listener);
  return () => document.removeEventListener("islands:load", listener);
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
  const listener = (e: CustomEvent<IslandErrorDetail>) => handler(e.detail);
  document.addEventListener("islands:error", listener);
  return () => document.removeEventListener("islands:error", listener);
}
