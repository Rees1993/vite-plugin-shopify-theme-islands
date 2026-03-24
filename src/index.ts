import { resolveThemeIslandsPolicy } from "./config-policy.js";
import type { ShopifyThemeIslandsOptions } from "./options.js";
import { createRevivePluginSession } from "./revive-session.js";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

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

  const policy = resolveThemeIslandsPolicy(options);
  const { directives, customDirectives: clientDirectiveDefinitions, debug } = policy.plugin;
  const { runtime: reviveOptions } = policy;
  const log = debug ? (...args: unknown[]) => console.log("[islands]", ...args) : () => {};
  const reviveSession = createRevivePluginSession({
    directories: rawDirs,
    directives,
    customDirectives: clientDirectiveDefinitions,
    reviveOptions,
    debug,
    runtimePath,
    log,
  });

  return {
    name: "vite-plugin-shopify-theme-islands",
    enforce: "pre",

    configResolved(config) {
      reviveSession.configure({
        root: config.root,
        aliases: config.resolve.alias,
      });
    },

    buildStart() {
      reviveSession.buildStart();
    },

    // Pick up files added/changed during dev (HMR); remove stale entries
    transform(code, id) {
      reviveSession.transform(code, id);
    },

    watchChange(id, { event }) {
      reviveSession.watchChange(id, event);
    },

    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
      if (id === ISLAND_ID) return islandPath;
    },

    async load(this: { resolve(id: string): Promise<{ id: string } | null> }, id: string) {
      if (id !== RESOLVED_ID) return;

      return reviveSession.load(async (entrypoint: string) => {
        const resolved = await this.resolve(entrypoint);
        if (!resolved) {
          throw new Error(
            `[vite-plugin-shopify-theme-islands] Cannot resolve custom directive entrypoint: "${entrypoint}"`,
          );
        }
        return resolved.id;
      });
    },
  };
}
