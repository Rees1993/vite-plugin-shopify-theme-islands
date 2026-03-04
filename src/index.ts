import type { Plugin } from 'vite';

/**
 * Vite plugin: Shopify theme island architecture.
 * Provides the revive runtime via a virtual module.
 *
 * Usage in vite.config.ts:
 *   import shopifyThemeIslands from 'vite-plugin-shopify-theme-islands';
 *   plugins: [shopifyThemeIslands({ pathPrefix: '/frontend/js/islands/' })]
 *
 * Usage in your entrypoint:
 *   import revive from 'vite-plugin-shopify-theme-islands/revive';
 *   const islands = import.meta.glob('/frontend/js/islands/*.{ts,js}');
 *   revive(islands);
 */

const VIRTUAL_REVIVE = 'virtual:shopify-theme-islands/revive';
const RESOLVED_REVIVE = '\0virtual:shopify-theme-islands/revive';
const runtimePath = new URL('./runtime.js', import.meta.url).pathname;

export interface ShopifyThemeIslandsOptions {
  /** Path prefix used to match island glob keys. Default: `'/frontend/js/islands/'` */
  pathPrefix?: string;
  /** Attribute for "load when visible". Default: `'client:visible'` */
  directiveVisible?: string;
  /** Attribute for "load when media matches". Default: `'client:media'` */
  directiveMedia?: string;
  /** Attribute for "load when idle". Default: `'client:idle'` */
  directiveIdle?: string;
}

export default function shopifyThemeIslands(pluginOptions: ShopifyThemeIslandsOptions = {}): Plugin {
  const pathPrefix = pluginOptions.pathPrefix ?? '/frontend/js/islands/';
  const directiveVisible = pluginOptions.directiveVisible ?? 'client:visible';
  const directiveMedia = pluginOptions.directiveMedia ?? 'client:media';
  const directiveIdle = pluginOptions.directiveIdle ?? 'client:idle';

  return {
    name: 'vite-plugin-shopify-theme-islands',
    enforce: 'pre',
    resolveId(id: string) {
      if (id === VIRTUAL_REVIVE || id === 'vite-plugin-shopify-theme-islands/revive') return RESOLVED_REVIVE;
      return null;
    },
    load(id: string) {
      if (id !== RESOLVED_REVIVE) return null;
      return `
import { revive as _revive } from ${JSON.stringify(runtimePath)};

export default function revive(islands) {
  _revive(islands, {
    pathPrefix: ${JSON.stringify(pathPrefix)},
    directiveVisible: ${JSON.stringify(directiveVisible)},
    directiveMedia: ${JSON.stringify(directiveMedia)},
    directiveIdle: ${JSON.stringify(directiveIdle)},
  });
}
`;
    },
  };
}
