import type { ReviveOptions } from "./contract.js";
import { buildReviveModuleSource } from "./revive-module.js";

export interface ResolvedCustomDirective {
  name: string;
  entrypoint: string;
}

export interface ReviveBootstrapInputs {
  root: string;
  directories: string[];
  islandFiles: Set<string>;
  customDirectives?: Array<{ name: string; entrypoint: string }>;
  reviveOptions: ReviveOptions;
}

export interface ReviveBootstrapPlan {
  runtimePath: string;
  directoryGlobs: string[];
  islandPaths: string[] | null;
  customDirectives: ResolvedCustomDirective[] | null;
  reviveOptions: ReviveOptions;
  source: string;
}

export interface ReviveBootstrapCompilerPorts {
  resolveEntrypoint(entrypoint: string): Promise<string>;
  toLoadPaths(islandFiles: Set<string>, root: string): string[];
}

export interface ReviveBootstrapCompiler {
  plan(input: ReviveBootstrapInputs): Promise<ReviveBootstrapPlan>;
  emit(plan: ReviveBootstrapPlan): string;
}

export function createReviveBootstrapCompiler(
  ports: ReviveBootstrapCompilerPorts,
  runtimePath: string,
): ReviveBootstrapCompiler {
  return {
    async plan(input) {
      const islandPaths =
        input.islandFiles.size > 0 ? ports.toLoadPaths(input.islandFiles, input.root) : null;
      const customDirectives = input.customDirectives?.length
        ? await Promise.all(
            input.customDirectives.map(async ({ name, entrypoint }) => ({
              name,
              entrypoint: await ports.resolveEntrypoint(entrypoint),
            })),
          )
        : null;
      const directoryGlobs = input.directories.map((dir) => dir + "**/*.{ts,js}");
      const source = buildReviveModuleSource({
        runtimePath,
        directoryGlobs,
        islandPaths,
        customDirectives: customDirectives?.length ? customDirectives : undefined,
        reviveOptions: input.reviveOptions,
      });

      return {
        runtimePath,
        directoryGlobs,
        islandPaths,
        customDirectives,
        reviveOptions: input.reviveOptions,
        source,
      };
    },

    emit(plan) {
      return plan.source;
    },
  };
}
