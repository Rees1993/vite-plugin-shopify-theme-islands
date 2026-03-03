/// <reference types="vite/client" />

declare module 'virtual:shopify-theme-islands/revive' {
  export function revive(islands: Record<string, () => Promise<unknown>>): void;
}
