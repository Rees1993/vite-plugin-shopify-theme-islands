import type { Plugin } from 'vite';

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

export default function shopifyThemeIslands(options?: ShopifyThemeIslandsOptions): Plugin;
