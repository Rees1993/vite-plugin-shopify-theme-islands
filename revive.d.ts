declare module "vite-plugin-shopify-theme-islands/revive" {
  /** Stops all island observation and pending runtime work. */
  export const disconnect: () => void;
  /** Immediately scans a subtree for matching island elements. */
  export const scan: (root?: HTMLElement | null) => void;
  /** Re-enables the shared runtime for a subtree and immediately scans it. */
  export const observe: (root?: HTMLElement | null) => void;
  /** Pauses the shared runtime for a subtree and cancels pending work in it. */
  export const unobserve: (root?: HTMLElement | null) => void;
}
