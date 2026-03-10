import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin, ResolvedConfig } from "vite";

const VIRTUAL_ID = "vite-plugin-shopify-theme-islands/revive";
const RESOLVED_ID = "\0" + VIRTUAL_ID;
const ISLAND_ID = "vite-plugin-shopify-theme-islands/island";
const runtimePath = fileURLToPath(new URL("./runtime.js", import.meta.url));
const islandPath = fileURLToPath(new URL("./island.js", import.meta.url));

/** A function that triggers the load of an island module. */
export type ClientDirectiveLoader = () => Promise<unknown>;

/** Options passed to a custom client directive function. */
export interface ClientDirectiveOptions {
  /** The matched attribute name, e.g. `'client:on-click'` */
  name: string;
  /** The attribute value; empty string if no value was set */
  value: string;
}

/**
 * A custom client directive function.
 *
 * Called by the runtime when a matching attribute is found on an island element.
 * The function is responsible for calling `load()` when the desired condition is met.
 *
 * @example
 * ```ts
 * import type { ClientDirective } from 'vite-plugin-shopify-theme-islands';
 *
 * const hoverDirective: ClientDirective = (load, _opts, el) => {
 *   el.addEventListener('mouseenter', load, { once: true });
 * };
 *
 * export default hoverDirective;
 * ```
 */
export type ClientDirective = (
  load: ClientDirectiveLoader,
  options: ClientDirectiveOptions,
  el: Element,
) => void | Promise<void>;

/** Plugin option entry for registering a custom client directive. */
export interface ClientDirectiveDefinition {
  /** HTML attribute name, e.g. `'client:on-click'` */
  name: string;
  /** Path to the directive module (supports Vite aliases) */
  entrypoint: string;
}

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
    /** Deadline (ms) passed to requestIdleCallback; also used as the setTimeout fallback delay. Default: `500` */
    timeout?: number;
  };
  /** Configuration for the `client:media` directive (matchMedia). */
  media?: {
    /** HTML attribute name. Default: `'client:media'` */
    attribute?: string;
  };
  /** Configuration for the `client:defer` directive (fixed setTimeout delay). */
  defer?: {
    /** HTML attribute name. Default: `'client:defer'` */
    attribute?: string;
    /** Fallback delay (ms) when the attribute has no value. Default: `3000` */
    delay?: number;
  };
}

export interface ShopifyThemeIslandsOptions {
  /** Directories to scan for island files. Accepts paths or Vite aliases. Default: `['/frontend/js/islands/']` */
  directories?: string | string[];
  /** Log discovered islands and generated virtual module. Default: `false` */
  debug?: boolean;
  /** Per-directive configuration. */
  directives?: DirectivesConfig;
  /** Custom client directives to register. Each entry maps an attribute name to a module entrypoint. */
  clientDirectives?: ClientDirectiveDefinition[];
}

export interface ReviveOptions {
  directives?: DirectivesConfig;
  /** Log island activation and directive events to the console. Default: `false` */
  debug?: boolean;
}

const defaults = {
  directories: ["/frontend/js/islands/"],
  directives: {
    visible: { attribute: "client:visible", rootMargin: "200px", threshold: 0 },
    idle:    { attribute: "client:idle",    timeout: 500 },
    media:   { attribute: "client:media" },
    defer:   { attribute: "client:defer",   delay: 3000 },
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

  const clientDirectiveDefinitions: ClientDirectiveDefinition[] = options.clientDirectives ?? [];

  // Deep merge directives — per-directive defaults are preserved when only some keys are overridden
  const directives: DirectivesConfig = {
    visible: { ...defaults.directives.visible, ...options.directives?.visible },
    idle:    { ...defaults.directives.idle,    ...options.directives?.idle },
    media:   { ...defaults.directives.media,   ...options.directives?.media },
    defer:   { ...defaults.directives.defer,   ...options.directives?.defer },
  };

  const debug = options.debug ?? false;
  const log = debug ? (...args: unknown[]) => console.log('[islands]', ...args) : () => {};

  let resolvedDirs = rawDirs;
  let root = process.cwd();
  // Absolute forms of resolvedDirs, precomputed in configResolved to avoid repeated path joins
  // in the hot inDirectory() check called on every transform.
  let absDirs: string[] = rawDirs;
  const islandFiles = new Set<string>();
  let scanned = false;

  // Returns true if the file is already covered by a scanned directory glob.
  const inDirectory = (file: string) => absDirs.some((dir) => file.startsWith(dir));

  return {
    name: "vite-plugin-shopify-theme-islands",
    enforce: "pre",

    configResolved(config) {
      root = config.root;
      resolvedDirs = resolveAliases(rawDirs, config);
      absDirs = resolvedDirs.map((d) => d.startsWith(root) ? d : join(root, d.replace(/^\//, '')));
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
      if (!TS_JS_RE.test(id)) return;
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

    async load(this: { resolve(id: string): Promise<{ id: string } | null> }, id: string) {
      if (id !== RESOLVED_ID) return;

      const globs = resolvedDirs.map(
        (dir) => `...import.meta.glob(${JSON.stringify(dir + "**/*.{ts,js}")})`
      );

      // Use import.meta.glob for island files so Vite handles base URL rewriting
      // (hand-crafted import() calls resolve against the page origin, not the dev server)
      const islandPaths = islandFiles.size
        ? [...islandFiles].map((file) => '/' + relative(root, file).replace(/\\/g, '/'))
        : null;

      // globs always has at least one entry (rawDirs is never empty)
      const islandsEntries = [`{ ${globs.join(", ")} }`];
      if (islandPaths) islandsEntries.push(`import.meta.glob(${JSON.stringify(islandPaths)})`);

      // Resolve custom directive entrypoints via Vite's resolver (handles aliases, registers deps)
      const directiveImports: string[] = [];
      const mapEntries: string[] = [];
      for (let i = 0; i < clientDirectiveDefinitions.length; i++) {
        const def = clientDirectiveDefinitions[i];
        const resolved = await this.resolve(def.entrypoint);
        if (!resolved) {
          throw new Error(
            `[vite-plugin-shopify-theme-islands] Cannot resolve custom directive entrypoint: "${def.entrypoint}"`
          );
        }
        directiveImports.push(`import _directive${i} from ${JSON.stringify(resolved.id)};`);
        mapEntries.push(`  [${JSON.stringify(def.name)}, _directive${i}]`);
      }

      const lines = [
        ...directiveImports,
        `import { revive as _islands } from ${JSON.stringify(runtimePath)};`,
        `const islands = Object.assign({}, ${islandsEntries.join(", ")});`,
        `const options = ${JSON.stringify({ directives, debug })};`,
      ];

      if (mapEntries.length) {
        lines.push(`const customDirectives = new Map([\n${mapEntries.join(",\n")}\n]);`);
        lines.push(`_islands(islands, options, customDirectives);`);
      } else {
        lines.push(`_islands(islands, options);`);
      }

      return lines.join("\n");
    },
  };
}
