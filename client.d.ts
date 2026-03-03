/// <reference types="vite/client" />

declare module 'virtual:shopify-theme-islands/revive' {
  export function revive(
    islands: Record<string, () => Promise<unknown>>,
    options?: {
      pathPrefix?: string;
      directiveVisible?: string;
      directiveMedia?: string;
      directiveIdle?: string;
    }
  ): void;
  export function getReviveOptions(): {
    pathPrefix: string;
    directiveVisible: string;
    directiveMedia: string;
    directiveIdle: string;
  };
}
