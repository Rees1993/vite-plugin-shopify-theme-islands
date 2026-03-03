import { readFileSync } from 'node:fs';

/**
 * Vite plugin: Shopify theme island architecture.
 * Provides the revive runtime via a virtual module.
 *
 * Usage in vite.config.mjs:
 *   import shopifyThemeIslands from 'vite-plugin-shopify-theme-islands';
 *   plugins: [shopifyThemeIslands({ pathPrefix: '/frontend/js/islands/' })]
 *
 * Usage in your entrypoint:
 *   import { revive, getReviveOptions } from 'virtual:shopify-theme-islands/revive';
 *   const islands = import.meta.glob('@/js/islands/*.{ts,js}');
 *   revive(islands, getReviveOptions());
 *
 * Options:
 *   - pathPrefix: string — path prefix used to match glob keys (default '/frontend/js/islands/')
 *   - directiveVisible: string — attribute for "load when visible" (default 'client:visible')
 *   - directiveIdle: string — attribute for "load when idle" (default 'client:idle')
 *   - directiveMedia: string — attribute for "load when media matches" (default 'client:media')
 */

const VIRTUAL_REVIVE = 'virtual:shopify-theme-islands/revive';
const runtimePath = new URL('./runtime.js', import.meta.url).pathname;

export default function shopifyThemeIslands(pluginOptions = {}) {
  const pathPrefix = pluginOptions.pathPrefix ?? '/frontend/js/islands/';
  const directiveVisible = pluginOptions.directiveVisible ?? 'client:visible';
  const directiveMedia = pluginOptions.directiveMedia ?? 'client:media';
  const directiveIdle = pluginOptions.directiveIdle ?? 'client:idle';

  return {
    name: 'vite-plugin-shopify-theme-islands',
    enforce: 'pre',
    resolveId(id) {
      if (id === VIRTUAL_REVIVE) return '\0' + id;
      return null;
    },
    load(id) {
      if (id !== '\0' + VIRTUAL_REVIVE) return null;
      const runtime = readFileSync(runtimePath, 'utf-8');
      return (
        runtime +
        `\nexport function getReviveOptions() {
  return {
    pathPrefix: ${JSON.stringify(pathPrefix)},
    directiveVisible: ${JSON.stringify(directiveVisible)},
    directiveMedia: ${JSON.stringify(directiveMedia)},
    directiveIdle: ${JSON.stringify(directiveIdle)},
  };
}
`
      );
    },
  };
}
