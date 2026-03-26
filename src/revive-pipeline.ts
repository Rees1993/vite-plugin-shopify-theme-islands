import {
  createIslandInventory,
  getIslandPathsForLoad,
  type AliasLike,
  type IslandInventoryChange,
  type IslandInventorySnapshot,
} from "./discovery.js";
import type { ReviveOptions } from "./contract.js";
import type { ClientDirectiveDefinition } from "./options.js";
import { createReviveBootstrapCompiler } from "./revive-bootstrap.js";

export interface RevivePipelineConfig {
  root: string;
  aliases: readonly AliasLike[];
}

export interface RevivePipelineOptions {
  rawDirectories: string[];
  runtimePath: string;
  resolveTag?: (filePath: string) => string | null;
  customDirectives?: ClientDirectiveDefinition[];
  reviveOptions: ReviveOptions;
}

export interface RevivePipeline {
  configure(config: RevivePipelineConfig): void;
  scan(): IslandInventorySnapshot | null;
  applyTransform(id: string, code: string): IslandInventoryChange | null;
  applyWatchChange(id: string, event: string): IslandInventoryChange | null;
  compile(resolveEntrypoint: (entrypoint: string) => Promise<string>): Promise<string>;
  getRoot(): string;
}

export function createRevivePipeline(options: RevivePipelineOptions): RevivePipeline {
  const inventory = createIslandInventory(options.rawDirectories);

  return {
    configure(config) {
      inventory.configure(config);
    },

    scan() {
      return inventory.scan();
    },

    applyTransform(id, code) {
      return inventory.applyTransform(id, code);
    },

    applyWatchChange(id, event) {
      return inventory.applyWatchChange(id, event);
    },

    async compile(resolveEntrypoint) {
      const compiler = createReviveBootstrapCompiler(
        {
          resolveEntrypoint,
          toLoadPaths: getIslandPathsForLoad,
        },
        options.runtimePath,
      );

      const plan = await compiler.plan({
        ...inventory.getBootstrapState(),
        resolveTag: options.resolveTag,
        customDirectives: options.customDirectives,
        reviveOptions: options.reviveOptions,
      });

      return compiler.emit(plan);
    },

    getRoot() {
      return inventory.getRoot();
    },
  };
}
