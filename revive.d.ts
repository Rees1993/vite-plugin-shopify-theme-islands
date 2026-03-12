declare module "vite-plugin-shopify-theme-islands/revive" {
  /** Stops the island MutationObserver. Call during SPA navigation teardown. */
  export const disconnect: () => void;
}
