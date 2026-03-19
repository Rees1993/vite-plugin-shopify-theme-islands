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
      const islandPaths = input.islandFiles.size > 0 ? ports.toLoadPaths(input.islandFiles, input.root) : null;
      const customDirectives =
        input.customDirectives?.length
          ? await Promise.all(
              input.customDirectives.map(async ({ name, entrypoint }) => ({
                name,
                entrypoint: await ports.resolveEntrypoint(entrypoint),
              })),
            )
          : null;

      return {
        runtimePath,
        directoryGlobs: input.directories.map((dir) => dir + "**/*.{ts,js}"),
        islandPaths,
        customDirectives,
        reviveOptions: input.reviveOptions,
      };
    },

    emit(plan) {
      return buildReviveModuleSource({
        runtimePath: plan.runtimePath,
        directoryGlobs: plan.directoryGlobs,
        islandPaths: plan.islandPaths,
        customDirectives: plan.customDirectives?.length ? plan.customDirectives : undefined,
        reviveOptions: plan.reviveOptions,
      });
    },
  };
}
