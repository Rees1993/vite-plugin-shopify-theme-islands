import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin, ResolvedConfig } from "vite";

const VIRTUAL_ID = "vite-plugin-shopify-theme-islands/revive";
const RESOLVED_ID = "\0" + VIRTUAL_ID;
const ISLAND_ID = "vite-plugin-shopify-theme-islands/island";
const runtimePath = fileURLToPath(new URL("./runtime.js", import.meta.url));
const islandPath = fileURLToPath(new URL("./island.js", import.meta.url));

const ISLAND_IMPORT_RE = /from\s+['"]vite-plugin-shopify-theme-islands\/island['"]/;
const TS_JS_RE = /\.(ts|js)$/;

/** Shared directive configuration shape used by both the plugin and the runtime. */
export interface DirectivesConfig {
  /** Configuration for the `client:visible` directive (IntersectionObserver). */
  visible?: {
    /** HTML attribute name. Default: `'client:visible'` */
    attribute?: string;
    /** Passed to IntersectionObserver — loads islands before they scroll into view. Default: `'200px'` */
    rootMargin?: string;
    /** Passed to IntersectionObserver — ratio of element that must be visible. Default: `0` */
    threshold?: number;
  };
  /** Configuration for the `client:idle` directive (requestIdleCallback). */
  idle?: {
    /** HTML attribute name. Default: `'client:idle'` */
    attribute?: string;
    /** Fallback timeout (ms) when requestIdleCallback is unavailable. Default: `200` */
    timeout?: number;
  };
  /** Configuration for the `client:media` directive (matchMedia). */
  media?: {
    /** HTML attribute name. Default: `'client:media'` */
    attribute?: string;
  };
}

export interface ShopifyThemeIslandsOptions {
  /** Directories to scan for island files. Accepts paths or Vite aliases. Default: `['/frontend/js/islands/']` */
  directories?: string | string[];
  /** Log discovered islands and generated virtual module. Default: `false` */
  debug?: boolean;
  /** Per-directive configuration. */
  directives?: DirectivesConfig;
}

export interface ReviveOptions {
  directives?: DirectivesConfig;
}

const defaults = {
  directories: ["/frontend/js/islands/"],
  directives: {
    visible: { attribute: "client:visible", rootMargin: "200px", threshold: 0 },
    idle:    { attribute: "client:idle",    timeout: 500 },
    media:   { attribute: "client:media" },
  },
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

// Recursively scan a directory for files containing the Island import
function scanForIslandFiles(dir: string, found: Set<string>): void {
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
      scanForIslandFiles(full, found);
    } else if (TS_JS_RE.test(entry.name)) {
      try {
        const content = readFileSync(full, 'utf-8');
        if (ISLAND_IMPORT_RE.test(content)) found.add(full);
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

  // Deep merge directives — per-directive defaults are preserved when only some keys are overridden
  const directives: DirectivesConfig = {
    visible: { ...defaults.directives.visible, ...options.directives?.visible },
    idle:    { ...defaults.directives.idle,    ...options.directives?.idle },
    media:   { ...defaults.directives.media,   ...options.directives?.media },
  };

  const debug = options.debug ?? false;
  const log = (...args: unknown[]) => { if (debug) console.log('[islands]', ...args); };

  let resolvedDirs = rawDirs;
  let root = process.cwd();
  const islandFiles = new Set<string>();
  let scanned = false;

  // Returns true if the file is already covered by a scanned directory glob.
  // resolvedDirs may be root-relative (/frontend/js/islands/) or absolute (alias-resolved),
  // so normalise to absolute before comparing against islandFiles (which are always absolute).
  const inDirectory = (file: string) => resolvedDirs.some((dir) => {
    const absDir = dir.startsWith(root) ? dir : join(root, dir.replace(/^\//, ''));
    return file.startsWith(absDir);
  });

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
      scanForIslandFiles(root, islandFiles);
      for (const f of islandFiles) if (inDirectory(f)) islandFiles.delete(f);
      if (debug) {
        log('Scanning directories:', resolvedDirs.map((d) => d + '**/*.{ts,js}').join(', '));
        log('Directives:', directives);
        if (islandFiles.size) {
          log(`Found ${islandFiles.size} island file(s) via mixin import:`);
          for (const f of islandFiles) log(' ', relative(root, f));
        }
      }
    },

    // Pick up files added/changed during dev (HMR); remove stale entries
    transform(code, id) {
      if (!id.endsWith('.ts') && !id.endsWith('.js')) return;
      if (code.includes('shopify-theme-islands/island') && ISLAND_IMPORT_RE.test(code) && !inDirectory(id)) {
        islandFiles.add(id);
        log('Detected island:', relative(root, id));
      } else {
        if (islandFiles.delete(id)) log('Removed island:', relative(root, id));
      }
    },

    watchChange(id, { event }) {
      if (!TS_JS_RE.test(id)) return;
      if (event === 'delete') {
        if (islandFiles.delete(id)) log('Removed island (deleted):', relative(root, id));
      } else {
        try {
          const content = readFileSync(id, 'utf-8');
          if (ISLAND_IMPORT_RE.test(content) && !inDirectory(id)) {
            islandFiles.add(id);
            log('Detected island (watchChange):', relative(root, id));
          } else {
            if (islandFiles.delete(id)) log('Removed island (watchChange):', relative(root, id));
          }
        } catch {
          // ignore unreadable files
        }
      }
    },

    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
      if (id === ISLAND_ID) return islandPath;
    },

    load(id) {
      if (id !== RESOLVED_ID) return;

      const globs = resolvedDirs.map(
        (dir) => `...import.meta.glob(${JSON.stringify(dir + "**/*.{ts,js}")})`
      );

      // Use import.meta.glob for island files so Vite handles base URL rewriting
      // (hand-crafted import() calls resolve against the page origin, not the dev server)
      const islandPaths = [...islandFiles].map(
        (file) => '/' + relative(root, file).replace(/\\/g, '/')
      );

      const islandsEntries = [
        globs.length ? `{ ${globs.join(", ")} }` : null,
        islandFiles.size ? `import.meta.glob(${JSON.stringify(islandPaths)})` : null,
      ].filter(Boolean);

      return [
        `import { revive as _islands } from ${JSON.stringify(runtimePath)};`,
        `const islands = Object.assign({}, ${islandsEntries.join(", ")});`,
        `const options = ${JSON.stringify({ directives })};`,
        `_islands(islands, options);`,
      ].join("\n");
    },
  };
}
