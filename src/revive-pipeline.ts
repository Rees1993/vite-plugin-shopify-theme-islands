import {
  createIslandInventory,
  getIslandPathsForLoad,
  type AliasLike,
  type IslandInventoryChange,
  type IslandInventoryBootstrapState,
  type IslandInventorySnapshot,
} from "./discovery.js";
import { createReviveBootstrapCompiler, type ReviveBootstrapInputs } from "./revive-bootstrap.js";

export interface RevivePipelineConfig {
  root: string;
  aliases: readonly AliasLike[];
}

export interface RevivePipelineOptions {
  rawDirectories: string[];
  runtimePath: string;
  compileBootstrap(input: IslandInventoryBootstrapState): ReviveBootstrapInputs;
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
  const compiler = createReviveBootstrapCompiler(
    {
      toLoadPaths: getIslandPathsForLoad,
    },
    options.runtimePath,
  );

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
      return compiler.compile(options.compileBootstrap(inventory.compileState()), {
        resolveEntrypoint,
      });
    },

    getRoot() {
      return inventory.getRoot();
    },
  };
}
