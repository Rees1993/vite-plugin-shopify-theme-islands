import { relative } from "node:path";
import type { ReviveOptions } from "./contract.js";
import {
  createIslandInventory,
  getIslandPathsForLoad,
  type IslandInventoryConfig,
} from "./discovery.js";
import type { DirectivesConfig, ClientDirectiveDefinition } from "./options.js";
import { createReviveBootstrapCompiler } from "./revive-bootstrap.js";

export interface RevivePluginSession {
  configure(config: IslandInventoryConfig): void;
  buildStart(): void;
  transform(code: string, id: string): void;
  watchChange(id: string, event: string): void;
  load(resolveEntrypoint: (entrypoint: string) => Promise<string>): Promise<string>;
}

export interface CreateRevivePluginSessionInput {
  directories: string[];
  directives: DirectivesConfig;
  customDirectives: ClientDirectiveDefinition[];
  reviveOptions: ReviveOptions;
  debug: boolean;
  runtimePath: string;
  log(...args: unknown[]): void;
}

export function createRevivePluginSession(
  input: CreateRevivePluginSessionInput,
): RevivePluginSession {
  const inventory = createIslandInventory(input.directories);

  const logScan = (scanStartedAt: number): void => {
    const snapshot = inventory.scan();
    if (!snapshot || !input.debug) return;

    const scanMs = (performance.now() - scanStartedAt).toFixed(1);
    input.log(`Scanned in ${scanMs}ms`);
    input.log(
      "Scanning directories:",
      snapshot.resolvedDirectories.map((dir) => dir + "**/*.{ts,js}").join(", "),
    );
    if (snapshot.directoryTagNames.length) {
      input.log(
        `Found ${snapshot.directoryTagNames.length} directory island(s): [${snapshot.directoryTagNames.join(", ")}]`,
      );
    }
    if (snapshot.islandFiles.length) {
      const root = inventory.getRoot();
      input.log(`Found ${snapshot.islandFiles.length} island file(s) via mixin import:`);
      for (const file of snapshot.islandFiles) input.log(" ", relative(root, file));
    }
    input.log("Directives:", input.directives);
  };

  const logChange = (
    change: { type: "detected" | "removed"; file: string } | null,
    detectedPrefix: string,
    removedPrefix: string,
  ): void => {
    if (!change) return;
    const root = inventory.getRoot();
    input.log(
      change.type === "detected" ? detectedPrefix : removedPrefix,
      relative(root, change.file),
    );
  };

  return {
    configure(config) {
      inventory.configure(config);
    },

    buildStart() {
      logScan(performance.now());
    },

    transform(code, id) {
      logChange(inventory.applyTransform(id, code), "Detected island:", "Removed island:");
    },

    watchChange(id, event) {
      const change = inventory.applyWatchChange(id, event);
      if (!change) return;
      const root = inventory.getRoot();
      const prefix =
        event === "delete"
          ? "Removed island (deleted):"
          : change.type === "detected"
            ? "Detected island (watchChange):"
            : "Removed island (watchChange):";
      input.log(prefix, relative(root, change.file));
    },

    async load(resolveEntrypoint) {
      const compiler = createReviveBootstrapCompiler(
        {
          resolveEntrypoint,
          toLoadPaths: getIslandPathsForLoad,
        },
        input.runtimePath,
      );
      const plan = await compiler.plan({
        ...inventory.getBootstrapState(),
        customDirectives: input.customDirectives,
        reviveOptions: input.reviveOptions,
      });
      return compiler.emit(plan);
    },
  };
}
