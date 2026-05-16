import { readFileSync } from "node:fs";
import { compileResolvedTags, deriveDefaultTag, type ReviveOptions } from "./contract.js";
import { buildReviveModuleSource } from "./revive-module.js";
import type { ResolveTagFn } from "./options.js";
import { analyzeTagOwnership, recomputeFileTagOwnership } from "./tag-ownership.js";

export interface ResolvedCustomDirective {
  name: string;
  entrypoint: string;
}

export interface ReviveCompileInputs {
  root: string;
  directories: string[];
  directoryFiles: Set<string>;
  islandFiles: Set<string>;
  tagSource?: "registeredTag" | "filename";
  resolveTag?: ResolveTagFn;
  customDirectives?: Array<{ name: string; entrypoint: string }>;
  reviveOptions: ReviveOptions;
}

export interface RevivePlan {
  runtimePath: string;
  directoryGlobs: string[];
  islandPaths: string[] | null;
  resolvedTags: Record<string, string | false> | null;
  customDirectives: ResolvedCustomDirective[] | null;
  reviveOptions: ReviveOptions;
  /** Maps absoluteFilePath → effective tag. Populated only in registeredTag mode. */
  ownershipMap: ReadonlyMap<string, string | false>;
}

export interface ReviveCompilerPorts {
  toLoadPaths(islandFiles: Set<string>, root: string): string[];
  readFile?(path: string): string | null;
}

export interface ReviveCompileResolvePorts {
  resolveEntrypoint(entrypoint: string): Promise<string>;
}

export interface ReviveCompiler {
  plan(input: ReviveCompileInputs, ports?: ReviveCompileResolvePorts): Promise<RevivePlan>;
  emit(plan: RevivePlan): string;
  compile(input: ReviveCompileInputs, ports?: ReviveCompileResolvePorts): Promise<string>;
  /** Re-derives the effective tag for one file. Returns null when unreadable or indeterminate. */
  recomputeOwnership(
    absoluteFilePath: string,
    filePath: string,
    input: Pick<ReviveCompileInputs, "tagSource" | "resolveTag">,
  ): string | false | null;
}

function getFileContent(ports: ReviveCompilerPorts, filePath: string): string | null {
  if (ports.readFile) return ports.readFile(filePath);
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

export function createReviveCompiler(
  ports: ReviveCompilerPorts,
  runtimePath: string,
): ReviveCompiler {
  return {
    async plan(input, resolvePorts) {
      const tagSource = input.tagSource ?? "registeredTag";
      const absoluteFiles = [...new Set([...input.directoryFiles, ...input.islandFiles])];
      const filePaths = ports.toLoadPaths(new Set(absoluteFiles), input.root);
      const files = absoluteFiles.map((absoluteFilePath, index) => ({
        absoluteFilePath,
        filePath: filePaths[index]!,
      }));
      const records = analyzeTagOwnership({
        files,
        tagSource,
        resolveTag: input.resolveTag,
        getFileContent: (path) => getFileContent(ports, path),
      });
      const islandPaths =
        input.islandFiles.size > 0 ? ports.toLoadPaths(input.islandFiles, input.root) : null;
      const resolvedTags = (() => {
        if (tagSource === "registeredTag") {
          const entries: Array<[string, string | false]> = [];
          for (const { filePath, resolvedTag } of records) {
            if (resolvedTag !== deriveDefaultTag(filePath)) entries.push([filePath, resolvedTag]);
          }
          return entries.length > 0 ? Object.fromEntries(entries) : null;
        }
        const resolvedTagByFilePath = new Map(
          records.map(({ filePath, resolvedTag }) => [filePath, resolvedTag]),
        );
        return input.resolveTag
          ? compileResolvedTags(
              filePaths,
              ({ filePath, defaultTag }) => resolvedTagByFilePath.get(filePath) ?? defaultTag,
            )
          : null;
      })();
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
      const ownershipMap: Map<string, string | false> =
        tagSource === "registeredTag"
          ? new Map(
              records.map(({ absoluteFilePath, resolvedTag }) => [absoluteFilePath, resolvedTag]),
            )
          : new Map();
      return {
        runtimePath,
        directoryGlobs,
        islandPaths,
        resolvedTags,
        customDirectives,
        reviveOptions: input.reviveOptions,
        ownershipMap,
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

    async compile(input, resolvePorts) {
      const plan = await this.plan(input, resolvePorts);
      return this.emit(plan);
    },

    recomputeOwnership(absoluteFilePath, filePath, input) {
      return recomputeFileTagOwnership(absoluteFilePath, filePath, {
        tagSource: input.tagSource ?? "registeredTag",
        resolveTag: input.resolveTag,
        getFileContent: (path) => getFileContent(ports, path),
      });
    },
  };
}
