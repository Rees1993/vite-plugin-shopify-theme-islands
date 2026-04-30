import { readFileSync } from "node:fs";
import { compileResolvedTags, deriveDefaultTag, type ReviveOptions } from "./contract.js";
import { buildReviveModuleSource } from "./revive-module.js";
import type { ResolveTagFn } from "./options.js";

export interface ResolvedCustomDirective {
  name: string;
  entrypoint: string;
}

export interface ReviveCompileInputs {
  root: string;
  directories: string[];
  directoryFiles: Set<string>;
  islandFiles: Set<string>;
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
}

export interface ReviveCompilerPorts {
  toLoadPaths(islandFiles: Set<string>, root: string): string[];
}

export interface ReviveCompileResolvePorts {
  resolveEntrypoint(entrypoint: string): Promise<string>;
}

export interface ReviveCompiler {
  plan(input: ReviveCompileInputs, ports?: ReviveCompileResolvePorts): Promise<RevivePlan>;
  emit(plan: RevivePlan): string;
  compile(input: ReviveCompileInputs, ports?: ReviveCompileResolvePorts): Promise<string>;
}

const STATIC_CUSTOM_ELEMENT_DEFINE_RE = /customElements\.define\(\s*["'`]([a-z0-9-]+)["'`]\s*,/;

function readStaticDefinedTag(filePath: string): string | null {
  try {
    const match = readFileSync(filePath, "utf-8").match(STATIC_CUSTOM_ELEMENT_DEFINE_RE);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function warnOnStaticTagMismatch(filePath: string, resolvedTag: string, definedTag: string): void {
  console.warn(
    `[vite-plugin-shopify-theme-islands] ${filePath} resolves to <${resolvedTag}> but statically registers <${definedTag}> via customElements.define(...). Tag ownership is path-based, so update the filename/resolveTag() or the registered tag so they match.`,
  );
}

function assertUniqueResolvedTagOwnership(
  fileMappings: Array<{ filePath: string; resolvedTag: string | false }>,
): void {
  const filePathsByTag = new Map<string, string[]>();
  for (const { filePath, resolvedTag } of fileMappings) {
    if (resolvedTag === false) continue;
    const filePaths = filePathsByTag.get(resolvedTag) ?? [];
    filePaths.push(filePath);
    filePathsByTag.set(resolvedTag, filePaths);
  }
  for (const [tag, filePaths] of filePathsByTag) {
    if (filePaths.length < 2) continue;
    throw new Error(
      `[vite-plugin-shopify-theme-islands] Multiple island entrypoints resolve to <${tag}>:\n- ${filePaths.join(
        "\n- ",
      )}\nTag ownership must be unique at compile time. Rename one file, adjust resolveTag({ filePath, defaultTag }), or return false to exclude one file.`,
    );
  }
}

export function createReviveCompiler(
  ports: ReviveCompilerPorts,
  runtimePath: string,
): ReviveCompiler {
  return {
    async plan(input, resolvePorts) {
      const absoluteFiles = [...new Set([...input.directoryFiles, ...input.islandFiles])];
      const filePaths = ports.toLoadPaths(new Set(absoluteFiles), input.root);
      const fileMappings = absoluteFiles.map((absoluteFilePath, index) => {
        const filePath = filePaths[index]!;
        const defaultTag = deriveDefaultTag(filePath);
        const resolvedTag = input.resolveTag
          ? input.resolveTag({ filePath, defaultTag })
          : defaultTag;
        return { absoluteFilePath, filePath, resolvedTag };
      });
      const resolvedTagByFilePath = new Map(
        fileMappings.map(({ filePath, resolvedTag }) => [filePath, resolvedTag]),
      );
      assertUniqueResolvedTagOwnership(fileMappings);
      const islandPaths =
        input.islandFiles.size > 0 ? ports.toLoadPaths(input.islandFiles, input.root) : null;
      const resolvedTags = input.resolveTag
        ? compileResolvedTags(
            filePaths,
            ({ filePath, defaultTag }) => resolvedTagByFilePath.get(filePath) ?? defaultTag,
          )
        : null;
      for (const { absoluteFilePath, filePath, resolvedTag } of fileMappings) {
        if (resolvedTag === false) continue;
        const definedTag = readStaticDefinedTag(absoluteFilePath);
        if (definedTag && definedTag !== resolvedTag) {
          warnOnStaticTagMismatch(filePath, resolvedTag, definedTag);
        }
      }
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

    async compile(input, resolvePorts) {
      const plan = await this.plan(input, resolvePorts);
      return this.emit(plan);
    },
  };
}
