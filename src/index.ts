import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  inDirectory,
  getIslandPathsForLoad,
  discoverIslandFiles,
  collectTagNames,
  ISLAND_IMPORT_RE,
  TS_JS_RE,
} from "./discovery.js";
import { buildReviveModuleSource } from "./revive-module.js";
import { fileURLToPath } from "node:url";
import type { Plugin, ResolvedConfig } from "vite";

const VIRTUAL_ID = "vite-plugin-shopify-theme-islands/revive";
const RESOLVED_ID = "\0" + VIRTUAL_ID;
const ISLAND_ID = "vite-plugin-shopify-theme-islands/island";
const runtimePath = fileURLToPath(new URL("./runtime.js", import.meta.url));
const islandPath = fileURLToPath(new URL("./island.js", import.meta.url));

/** A function that triggers the load of an island module. */
export type ClientDirectiveLoader = () => Promise<void>;

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
 * // src/directives/hash.ts
 * import type { ClientDirective } from 'vite-plugin-shopify-theme-islands';
 *
 * const hashDirective: ClientDirective = (load, opts) => {
 *   const target = opts.value;
 *   if (location.hash === target) { load(); return; }
 *   window.addEventListener('hashchange', () => {
 *     if (location.hash === target) load();
 *   });
 * };
 *
 * export default hashDirective;
 * ```
 *
 * Register it in `vite.config.ts`:
 * ```ts
 * shopifyThemeIslands({
 *   directives: {
 *     custom: [{ name: 'client:hash', entrypoint: './src/directives/hash.ts' }],
 *   },
 * })
 * ```
 */
export type ClientDirective = (
  load: ClientDirectiveLoader,
  options: ClientDirectiveOptions,
  el: HTMLElement,
) => void | Promise<void>;

/** Plugin option entry for registering a custom client directive. */
export interface ClientDirectiveDefinition {
  /** HTML attribute name, e.g. `'client:on-click'` */
  name: string;
  /** Path to the directive module (supports Vite aliases) */
  entrypoint: string;
}

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
  /** Configuration for the `client:interaction` directive (mouseenter/touchstart/focusin). */
  interaction?: {
    /** HTML attribute name. Default: `'client:interaction'` */
    attribute?: string;
    /** DOM event names to listen for. Default: `['mouseenter', 'touchstart', 'focusin']` */
    events?: string[];
  };
  /** Custom client directives to register. Each entry maps an attribute name to a module entrypoint. */
  custom?: ClientDirectiveDefinition[];
}

/** Event detail and runtime options (single source of truth in contract). */
import type {
  IslandLoadDetail,
  IslandErrorDetail,
  ReviveOptions,
  RetryConfig,
  RuntimeDirectivesConfig,
} from "./contract.js";
export type {
  IslandLoadDetail,
  IslandErrorDetail,
  ReviveOptions,
  RetryConfig,
  RuntimeDirectivesConfig,
} from "./contract.js";
import { DEFAULT_DIRECTIVES } from "./contract.js";

export interface ShopifyThemeIslandsOptions {
  /** Directories to scan for island files. Accepts paths or Vite aliases. Default: `['/frontend/js/islands/']` */
  directories?: string | string[];
  /** Log discovered islands and generated virtual module. Default: `false` */
  debug?: boolean;
  /** Per-directive configuration. */
  directives?: DirectivesConfig;
  /** Automatic retry behaviour for failed island loads. */
  retry?: RetryConfig;
}

const PREFIX = "[vite-plugin-shopify-theme-islands]";

function validateOptions(options: ShopifyThemeIslandsOptions, directives: DirectivesConfig): void {
  const customDefs = options.directives?.custom ?? [];
  if (Array.isArray(options.directories) && options.directories.length === 0) {
    throw new Error(`${PREFIX} "directories" must not be empty`);
  }

  const threshold = options.directives?.visible?.threshold;
  if (threshold !== undefined && (threshold < 0 || threshold > 1)) {
    throw new Error(
      `${PREFIX} "directives.visible.threshold" must be between 0 and 1, got ${threshold}`,
    );
  }

  if (options.retry !== undefined) {
    const { retries, delay } = options.retry;
    if (retries !== undefined && retries < 0) {
      throw new Error(`${PREFIX} "retry.retries" must be >= 0, got ${retries}`);
    }
    if (delay !== undefined && delay < 0) {
      throw new Error(`${PREFIX} "retry.delay" must be >= 0, got ${delay}`);
    }
  }

  const builtinAttributes = new Set([
    directives.visible!.attribute!,
    directives.idle!.attribute!,
    directives.media!.attribute!,
    directives.defer!.attribute!,
    directives.interaction!.attribute!,
  ]);
  const seen = new Set<string>();
  for (const def of customDefs) {
    if (seen.has(def.name)) {
      throw new Error(`${PREFIX} Duplicate custom directive name: "${def.name}"`);
    }
    if (builtinAttributes.has(def.name)) {
      throw new Error(
        `${PREFIX} Custom directive "${def.name}" conflicts with a built-in directive`,
      );
    }
    seen.add(def.name);
  }
}

const defaultDirectories = ["/frontend/js/islands/"];

function normalizeDir(dir: string): string {
  return dir.endsWith("/") ? dir : dir + "/";
}

function resolveAliases(dirs: string[], config: ResolvedConfig): string[] {
  // Sort string aliases by length descending so more-specific prefixes match first
  // (e.g. "@islands" before "@" — matches Vite's own alias resolution order)
  const aliases = [...config.resolve.alias].sort(
    (a, b) =>
      (typeof b.find === "string" ? b.find.length : 0) -
      (typeof a.find === "string" ? a.find.length : 0),
  );
  return dirs.map((dir) => {
    for (const { find, replacement } of aliases) {
      if (typeof find === "string" && dir.startsWith(find)) return dir.replace(find, replacement);
      if (find instanceof RegExp && find.test(dir)) return dir.replace(find, replacement);
    }
    return dir;
  });
}

export default function shopifyThemeIslands(options: ShopifyThemeIslandsOptions = {}): Plugin {
  const rawDirs = (
    Array.isArray(options.directories)
      ? options.directories
      : [options.directories ?? defaultDirectories[0]]
  ).map(normalizeDir);

  // Deep merge directives — contract is single source of truth for defaults
  const directives: DirectivesConfig = {
    visible: { ...DEFAULT_DIRECTIVES.visible, ...options.directives?.visible },
    idle: { ...DEFAULT_DIRECTIVES.idle, ...options.directives?.idle },
    media: { ...DEFAULT_DIRECTIVES.media, ...options.directives?.media },
    defer: { ...DEFAULT_DIRECTIVES.defer, ...options.directives?.defer },
    interaction: { ...DEFAULT_DIRECTIVES.interaction, ...options.directives?.interaction },
  };

  const clientDirectiveDefinitions: ClientDirectiveDefinition[] = options.directives?.custom ?? [];

  validateOptions(options, directives);

  const debug = options.debug ?? false;
  const log = debug ? (...args: unknown[]) => console.log("[islands]", ...args) : () => {};

  let resolvedDirs = rawDirs;
  let root = process.cwd();
  // Absolute forms of resolvedDirs, precomputed in configResolved to avoid repeated path joins
  // in the hot inDirectory() check called on every transform.
  let absDirs: string[] = rawDirs;
  const islandFiles = new Set<string>();
  let scanned = false;

  return {
    name: "vite-plugin-shopify-theme-islands",
    enforce: "pre",

    configResolved(config) {
      root = config.root;
      resolvedDirs = resolveAliases(rawDirs, config);
      absDirs = resolvedDirs.map((d) =>
        d.startsWith(root) ? d : join(root, d.replace(/^\//, "")),
      );
    },

    buildStart() {
      if (scanned) return;
      scanned = true;
      const t0 = performance.now();
      const initial = discoverIslandFiles(root, absDirs);
      islandFiles.clear();
      initial.forEach((f) => islandFiles.add(f));
      if (debug) {
        const scanMs = (performance.now() - t0).toFixed(1);
        log(`Scanned in ${scanMs}ms`);
        log("Scanning directories:", resolvedDirs.map((d) => d + "**/*.{ts,js}").join(", "));
        const dirNames = absDirs.flatMap((dir) => collectTagNames(dir));
        if (dirNames.length)
          log(`Found ${dirNames.length} directory island(s): [${dirNames.join(", ")}]`);
        if (islandFiles.size) {
          log(`Found ${islandFiles.size} island file(s) via mixin import:`);
          for (const f of islandFiles) log(" ", relative(root, f));
        }
        log("Directives:", directives);
      }
    },

    // Pick up files added/changed during dev (HMR); remove stale entries
    transform(code, id) {
      if (!TS_JS_RE.test(id)) return;
      if (
        code.includes("shopify-theme-islands/island") &&
        ISLAND_IMPORT_RE.test(code) &&
        !inDirectory(id, absDirs)
      ) {
        islandFiles.add(id);
        log("Detected island:", relative(root, id));
      } else {
        if (islandFiles.delete(id)) log("Removed island:", relative(root, id));
      }
    },

    watchChange(id, { event }) {
      if (!TS_JS_RE.test(id)) return;
      if (event === "delete") {
        if (islandFiles.delete(id)) log("Removed island (deleted):", relative(root, id));
      } else {
        try {
          const content = readFileSync(id, "utf-8");
          if (ISLAND_IMPORT_RE.test(content) && !inDirectory(id, absDirs)) {
            islandFiles.add(id);
            log("Detected island (watchChange):", relative(root, id));
          } else {
            if (islandFiles.delete(id)) log("Removed island (watchChange):", relative(root, id));
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
        (dir) => `...import.meta.glob(${JSON.stringify(dir + "**/*.{ts,js}")})`,
      );

      // Use import.meta.glob for island files so Vite handles base URL rewriting
      // (hand-crafted import() calls resolve against the page origin, not the dev server)
      const islandPaths = islandFiles.size > 0 ? getIslandPathsForLoad(islandFiles, root) : null;

      // globs always has at least one entry (rawDirs is never empty)
      const islandsEntries = [`{ ${globs.join(", ")} }`];
      if (islandPaths) islandsEntries.push(`import.meta.glob(${JSON.stringify(islandPaths)})`);

      // Resolve custom directive entrypoints via Vite's resolver (handles aliases, registers deps)
      const directiveImports: string[] = [];
      const mapEntries: string[] = [];
      for (const [i, def] of clientDirectiveDefinitions.entries()) {
        const resolved = await this.resolve(def.entrypoint);
        if (!resolved) {
          throw new Error(
            `[vite-plugin-shopify-theme-islands] Cannot resolve custom directive entrypoint: "${def.entrypoint}"`,
          );
        }
        directiveImports.push(`import _directive${i} from ${JSON.stringify(resolved.id)};`);
        mapEntries.push(`  [${JSON.stringify(def.name)}, _directive${i}]`);
      }

      const reviveOptions = { directives, debug, retry: options.retry };
      const islandsObjectExpr = `Object.assign({}, ${islandsEntries.join(", ")})`;
      return buildReviveModuleSource({
        runtimePath,
        directiveImportLines: directiveImports,
        islandsObjectExpr,
        customDirectivesMapLines: mapEntries.length ? mapEntries : null,
        reviveOptions,
      });
    },
  };
}
