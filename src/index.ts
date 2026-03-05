import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Plugin, ResolvedConfig } from "vite";

const VIRTUAL_ID = "vite-plugin-shopify-theme-islands/revive";
const RESOLVED_ID = "\0" + VIRTUAL_ID;
const MIXIN_ID = "vite-plugin-shopify-theme-islands/island";
const runtimePath = new URL("./runtime.js", import.meta.url).pathname;
const mixinPath = new URL("./island.js", import.meta.url).pathname;

const MIXIN_IMPORT_RE = /from\s+['"]vite-plugin-shopify-theme-islands\/island['"]/;
const TS_JS_RE = /\.(ts|js)$/;

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

// Recursively scan a directory for files containing the Island mixin import
function scanForMixinFiles(dir: string, found: Set<string>): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      scanForMixinFiles(full, found);
    } else if (TS_JS_RE.test(entry.name)) {
      try {
        const content = readFileSync(full, 'utf-8');
        if (MIXIN_IMPORT_RE.test(content)) found.add(full);
      } catch {
        // skip unreadable files
      }
    }
  }
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
  let root = process.cwd();
  const mixinFiles = new Set<string>();
  let scanned = false;

  return {
    name: "vite-plugin-shopify-theme-islands",
    enforce: "pre",

    configResolved(config) {
      root = config.root;
      resolvedDirs = resolveAliases(rawDirs, config);
    },

    buildStart() {
      if (scanned) return;
      scanned = true;
      scanForMixinFiles(root, mixinFiles);
    },

    // Pick up files added/changed during dev (HMR); remove stale entries
    transform(code, id) {
      if (!id.endsWith('.ts') && !id.endsWith('.js')) return;
      if (code.includes('shopify-theme-islands/island') && MIXIN_IMPORT_RE.test(code)) {
        mixinFiles.add(id);
      } else {
        mixinFiles.delete(id);
      }
    },

    // Remove deleted files from the mixin set
    watchChange(id, { event }) {
      if (event === 'delete') mixinFiles.delete(id);
    },

    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
      if (id === MIXIN_ID) return mixinPath;
    },

    load(id) {
      if (id !== RESOLVED_ID) return;

      const globs = resolvedDirs.map(
        (dir) => `...import.meta.glob(${JSON.stringify(dir + "**/*.{ts,js}")})`
      );

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
        `_islands(islands, options);`,
      ].join("\n");
    },
  };
}
