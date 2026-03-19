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
import { resolveThemeIslandsPolicy } from "./config-policy.js";
import type { ShopifyThemeIslandsOptions } from "./options.js";
import { createReviveBootstrapCompiler } from "./revive-bootstrap.js";
import { fileURLToPath } from "node:url";
import type { Plugin, ResolvedConfig } from "vite";

const VIRTUAL_ID = "vite-plugin-shopify-theme-islands/revive";
const RESOLVED_ID = "\0" + VIRTUAL_ID;
const ISLAND_ID = "vite-plugin-shopify-theme-islands/island";
const runtimePath = fileURLToPath(new URL("./runtime.js", import.meta.url));
const islandPath = fileURLToPath(new URL("./island.js", import.meta.url));

/** A function that triggers the load of an island module. */
export type ClientDirectiveLoader = () => Promise<void>;

export type { ClientDirective, ClientDirectiveOptions } from "./contract.js";

export type {
  ClientDirectiveDefinition,
  DirectivesConfig,
  ShopifyThemeIslandsOptions,
} from "./options.js";
export type {
  IslandLoadDetail,
  IslandErrorDetail,
  ReviveOptions,
  RetryConfig,
  RuntimeDirectivesConfig,
} from "./contract.js";

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

  const policy = resolveThemeIslandsPolicy(options);
  const { directives, customDirectives: clientDirectiveDefinitions, debug } = policy.plugin;
  const { runtime: reviveOptions } = policy;
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

      const compiler = createReviveBootstrapCompiler(
        {
          resolveEntrypoint: async (entrypoint: string) => {
            const resolved = await this.resolve(entrypoint);
            if (!resolved) {
              throw new Error(
                `[vite-plugin-shopify-theme-islands] Cannot resolve custom directive entrypoint: "${entrypoint}"`,
              );
            }
            return resolved.id;
          },
          toLoadPaths: getIslandPathsForLoad,
        },
        runtimePath,
      );

      const plan = await compiler.plan({
        root,
        directories: resolvedDirs,
        islandFiles,
        customDirectives: clientDirectiveDefinitions,
        reviveOptions,
      });

      return compiler.emit(plan);
    },
  };
}
