import type { Plugin, ResolvedConfig } from "vite";

const VIRTUAL_ID = "vite-plugin-shopify-theme-islands/islands";
const RESOLVED_ID = "\0" + VIRTUAL_ID;
const MIXIN_ID = "vite-plugin-shopify-theme-islands/mixin";
const runtimePath = new URL("./runtime.js", import.meta.url).pathname;
const mixinPath = new URL("./mixin.js", import.meta.url).pathname;

// Matches any import from the island mixin module
const MIXIN_IMPORT_RE = /from\s+['"]vite-plugin-shopify-theme-islands\/mixin['"]/;

export interface ShopifyThemeIslandsOptions {
  /** Directories to scan for island files. Accepts paths or Vite aliases. Default: `['/frontend/js/islands/']` */
  directories?: string | string[];
  /** Attribute for "load when visible". Default: `'client:visible'` */
  directiveVisible?: string;
  /** Attribute for "load when media matches". Default: `'client:media'` */
  directiveMedia?: string;
  /** Attribute for "load when idle". Default: `'client:idle'` */
  directiveIdle?: string;
}

const defaults = {
  directories: ["/frontend/js/islands/"],
  directiveVisible: "client:visible",
  directiveMedia: "client:media",
  directiveIdle: "client:idle",
};

function normalizeDir(dir: string): string {
  return dir.endsWith('/') ? dir : dir + '/';
}

function resolveAliases(dirs: string[], config: ResolvedConfig): string[] {
  const aliases = config.resolve.alias;
  return dirs.map((dir) => {
    for (const { find, replacement } of aliases) {
      if (typeof find === "string" && dir.startsWith(find))
        return dir.replace(find, replacement);
      if (find instanceof RegExp && find.test(dir))
        return dir.replace(find, replacement);
    }
    return dir;
  });
}

export default function shopifyThemeIslands(options: ShopifyThemeIslandsOptions = {}): Plugin {
  const rawDirs = (Array.isArray(options.directories)
    ? options.directories
    : [options.directories ?? defaults.directories[0]]
  ).map(normalizeDir);

  const directiveVisible = options.directiveVisible ?? defaults.directiveVisible;
  const directiveMedia = options.directiveMedia ?? defaults.directiveMedia;
  const directiveIdle = options.directiveIdle ?? defaults.directiveIdle;

  let resolvedDirs = rawDirs;

  // Files detected via Island mixin import
  const mixinFiles = new Set<string>();

  return {
    name: "vite-plugin-shopify-theme-islands",
    enforce: "pre",

    configResolved(config) {
      resolvedDirs = resolveAliases(rawDirs, config);
    },

    // Resolve the mixin module to its built path
    resolveId(id) {
      if (id === VIRTUAL_ID || id === `virtual:${VIRTUAL_ID}`) return RESOLVED_ID;
      if (id === MIXIN_ID) return mixinPath;
    },

    // Detect files that import the Island mixin and register them
    transform(code, id) {
      if (MIXIN_IMPORT_RE.test(code)) mixinFiles.add(id);
    },

    load(id) {
      if (id !== RESOLVED_ID) return;

      const globs = resolvedDirs.map(
        (dir) => `...import.meta.glob(${JSON.stringify(dir + "**/*.{ts,js}")})`
      );

      // Explicit lazy imports for mixin-detected files
      const mixinImports = [...mixinFiles].map(
        (file) => `  [${JSON.stringify(file)}]: () => import(${JSON.stringify(file)})`
      );

      const islandsEntries = [
        globs.length ? `{ ${globs.join(", ")} }` : null,
        mixinFiles.size ? `{\n${mixinImports.join(",\n")}\n}` : null,
      ].filter(Boolean);

      return [
        `import { revive as _islands } from ${JSON.stringify(runtimePath)};`,
        `const islands = Object.assign({}, ${islandsEntries.join(", ")});`,
        `const options = ${JSON.stringify({ directiveVisible, directiveMedia, directiveIdle })};`,
        `export default () => _islands(islands, options);`,
      ].join("\n");
    },
  };
}
