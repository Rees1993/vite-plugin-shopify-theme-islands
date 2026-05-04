import { relative } from "node:path";
import { compileThemeIslandsConfig } from "./resolved-config.js";
import { createIslandInventory, getIslandPathsForLoad } from "./discovery.js";
import type { ShopifyThemeIslandsOptions } from "./options.js";
import { createReviveCompiler } from "./revive-compile.js";
import { fileURLToPath } from "node:url";
import type { Plugin, ViteDevServer } from "vite";

const VIRTUAL_ID = "vite-plugin-shopify-theme-islands/revive";
const RESOLVED_ID = "\0" + VIRTUAL_ID;
const ISLAND_ID = "vite-plugin-shopify-theme-islands/island";
const runtimePath = fileURLToPath(new URL("./runtime.js", import.meta.url));
const islandPath = fileURLToPath(new URL("./island.js", import.meta.url));

/** A function that triggers the load of an island module. */
export type ClientDirectiveLoader = () => Promise<void>;

export type {
  ClientDirective,
  ClientDirectiveContext,
  ClientDirectiveOptions,
} from "./contract.js";

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

export type { InteractionEventName } from "./interaction-events.js";

export {
  DEFAULT_INTERACTION_EVENTS,
  INTERACTION_EVENT_NAMES,
  isInteractionEventName,
} from "./interaction-events.js";

const defaultDirectories = ["/frontend/js/islands/"];

function normalizeDir(dir: string): string {
  return dir.endsWith("/") ? dir : dir + "/";
}

export default function shopifyThemeIslands(options: ShopifyThemeIslandsOptions = {}): Plugin {
  const rawDirs = (
    Array.isArray(options.directories)
      ? options.directories
      : [options.directories ?? defaultDirectories[0]]
  ).map(normalizeDir);

  const config = compileThemeIslandsConfig(options);
  const { directives, debug } = config.plugin;
  const log = debug ? (...args: unknown[]) => console.log("[islands]", ...args) : () => {};
  const inventory = createIslandInventory(rawDirs);
  const compiler = createReviveCompiler({ toLoadPaths: getIslandPathsForLoad }, runtimePath);
  let devServer: ViteDevServer | null = null;
  const ownershipSnapshot = new Map<string, string | false>();

  const invalidateReviveModule = (): void => {
    if (!devServer) return;
    const mod = devServer.moduleGraph.getModuleById(RESOLVED_ID);
    if (!mod) return;
    devServer.moduleGraph.invalidateModule(mod);
    if (typeof devServer.reloadModule === "function") {
      void devServer.reloadModule(mod);
      return;
    }
    devServer.ws.send({ type: "full-reload" });
  };

  return {
    name: "vite-plugin-shopify-theme-islands",
    enforce: "pre",

    configResolved(config) {
      inventory.configure({
        root: config.root,
        aliases: config.resolve.alias,
      });
    },

    configureServer(server) {
      devServer = server;
    },

    buildStart() {
      const t0 = performance.now();
      const snapshot = inventory.scan();
      if (!snapshot) return;
      if (debug) {
        const scanMs = (performance.now() - t0).toFixed(1);
        log(`Scanned in ${scanMs}ms`);
        log(
          "Scanning directories:",
          snapshot.resolvedDirectories.map((dir) => dir + "**/*.{ts,js}").join(", "),
        );
        if (snapshot.directoryTagNames.length) {
          log(
            `Found ${snapshot.directoryTagNames.length} directory island(s): [${snapshot.directoryTagNames.join(", ")}]`,
          );
        }
        if (snapshot.islandFiles.length) {
          const root = inventory.getRoot();
          log(`Found ${snapshot.islandFiles.length} island file(s) via mixin import:`);
          for (const file of snapshot.islandFiles) log(" ", relative(root, file));
        }
        log("Directives:", directives);
      }
    },

    // Pick up files added/changed during dev (HMR); remove stale entries
    transform(code, id) {
      const change = inventory.applyTransform(id, code);
      if (!change) return;
      const root = inventory.getRoot();
      log(
        change.type === "detected" ? "Detected island:" : "Removed island:",
        relative(root, change.file),
      );
    },

    watchChange(id, { event }) {
      const change = inventory.applyWatchChange(id, event);
      if (change) {
        const root = inventory.getRoot();
        const prefix =
          event === "delete"
            ? "Removed island (deleted):"
            : change.type === "detected"
              ? "Detected island (watchChange):"
              : "Removed island (watchChange):";
        log(prefix, relative(root, change.file));
        invalidateReviveModule();
        return;
      }
      if (event === "update" && ownershipSnapshot.has(id)) {
        const compileInputs = config.compileInputs(inventory.state());
        const loadPath = "/" + relative(inventory.getRoot(), id).replace(/\\/g, "/");
        const newTag = compiler.recomputeOwnership(id, loadPath, compileInputs);
        if (newTag === null || newTag !== ownershipSnapshot.get(id)) {
          if (newTag !== null) ownershipSnapshot.set(id, newTag);
          invalidateReviveModule();
        }
      }
    },

    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
      if (id === ISLAND_ID) return islandPath;
    },

    async load(this: { resolve(id: string): Promise<{ id: string } | null> }, id: string) {
      if (id !== RESOLVED_ID) return;

      const plan = await compiler.plan(config.compileInputs(inventory.state()), {
        resolveEntrypoint: async (entrypoint: string) => {
          const resolved = await this.resolve(entrypoint);
          if (!resolved) {
            throw new Error(
              `[vite-plugin-shopify-theme-islands] Cannot resolve custom directive entrypoint: "${entrypoint}"`,
            );
          }
          return resolved.id;
        },
      });
      ownershipSnapshot.clear();
      for (const [absPath, tag] of plan.ownershipMap) {
        ownershipSnapshot.set(absPath, tag);
      }
      return compiler.emit(plan);
    },
  };
}
