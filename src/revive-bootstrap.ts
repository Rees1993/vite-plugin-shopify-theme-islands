import { deriveDefaultTag, type ReviveOptions } from "./contract.js";
import { buildReviveModuleSource } from "./revive-module.js";
import type { ResolveTagFn } from "./options.js";

export interface ResolvedCustomDirective {
  name: string;
  entrypoint: string;
}

export interface ReviveBootstrapInputs {
  root: string;
  directories: string[];
  directoryFiles: Set<string>;
  islandFiles: Set<string>;
  resolveTag?: ResolveTagFn;
  customDirectives?: Array<{ name: string; entrypoint: string }>;
  reviveOptions: ReviveOptions;
}

export interface ReviveBootstrapPlan {
  runtimePath: string;
  directoryGlobs: string[];
  islandPaths: string[] | null;
  resolvedTags: Record<string, string | false> | null;
  customDirectives: ResolvedCustomDirective[] | null;
  reviveOptions: ReviveOptions;
}

export interface ReviveBootstrapCompilerPorts {
  toLoadPaths(islandFiles: Set<string>, root: string): string[];
}

export interface ReviveBootstrapResolvePorts {
  resolveEntrypoint(entrypoint: string): Promise<string>;
}

export interface ReviveBootstrapCompiler {
  plan(
    input: ReviveBootstrapInputs,
    ports?: ReviveBootstrapResolvePorts,
  ): Promise<ReviveBootstrapPlan>;
  emit(plan: ReviveBootstrapPlan): string;
}

export function createReviveBootstrapCompiler(
  ports: ReviveBootstrapCompilerPorts,
  runtimePath: string,
): ReviveBootstrapCompiler {
  return {
    async plan(input, resolvePorts) {
      const islandPaths =
        input.islandFiles.size > 0 ? ports.toLoadPaths(input.islandFiles, input.root) : null;
      const resolvedTags = input.resolveTag
        ? (() => {
            const entries: Array<[string, string | false]> = [];
            for (const filePath of ports.toLoadPaths(
              new Set([...input.directoryFiles, ...input.islandFiles]),
              input.root,
            )) {
              const defaultTag = deriveDefaultTag(filePath);
              const resolvedTag = input.resolveTag({ filePath, defaultTag });
              if (resolvedTag === defaultTag) continue;
              entries.push([filePath, resolvedTag]);
            }
            return entries.length > 0 ? Object.fromEntries(entries) : null;
          })()
        : null;
      const customDirectives = input.customDirectives?.length
        ? await (() => {
            if (!resolvePorts) {
              throw new Error(
                "[vite-plugin-shopify-theme-islands] resolveEntrypoint is required when custom directives are configured",
              );
            }
            return Promise.all(
              input.customDirectives.map(async ({ name, entrypoint }) => ({
                name,
                entrypoint: await resolvePorts.resolveEntrypoint(entrypoint),
              })),
            );
          })()
        : null;
      const directoryGlobs = input.directories.map((dir) => dir + "**/*.{ts,js}");
      return {
        runtimePath,
        directoryGlobs,
        islandPaths,
        resolvedTags,
        customDirectives,
        reviveOptions: input.reviveOptions,
      };
    },

    emit(plan) {
      return buildReviveModuleSource({
        runtimePath: plan.runtimePath,
        directoryGlobs: plan.directoryGlobs,
        islandPaths: plan.islandPaths,
        resolvedTags: plan.resolvedTags ?? undefined,
        customDirectives: plan.customDirectives?.length ? plan.customDirectives : undefined,
        reviveOptions: plan.reviveOptions,
      });
    },
  };
}
