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

function isIdentifierChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_$]/.test(char);
}

function skipQuotedString(content: string, start: number, quote: "'" | '"'): number {
  let i = start + 1;
  while (i < content.length) {
    const char = content[i];
    if (char === "\\") {
      i += 2;
      continue;
    }
    if (char === quote) return i + 1;
    i += 1;
  }
  return i;
}

function skipTemplateLiteral(content: string, start: number): number {
  let i = start + 1;
  while (i < content.length) {
    const char = content[i];
    if (char === "\\") {
      i += 2;
      continue;
    }
    if (char === "`") return i + 1;
    i += 1;
  }
  return i;
}

function skipWhitespace(content: string, start: number): number {
  let i = start;
  while (i < content.length && /\s/.test(content[i]!)) i += 1;
  return i;
}

function readStaticDefinedTagAt(
  content: string,
  start: number,
): { tag: string; end: number } | null {
  const prefix = "customElements.define";
  if (!content.startsWith(prefix, start)) return null;
  if (isIdentifierChar(content[start - 1])) return null;

  let i = start + prefix.length;
  i = skipWhitespace(content, i);
  if (content[i] !== "(") return null;

  i = skipWhitespace(content, i + 1);
  const quote = content[i];
  if (quote !== "'" && quote !== '"' && quote !== "`") return null;

  let j = i + 1;
  let tag = "";
  while (j < content.length) {
    const char = content[j];
    if (char === "\\") return null;
    if (char === quote) break;
    tag += char;
    j += 1;
  }
  if (content[j] !== quote || !/^[a-z0-9-]+$/.test(tag)) return null;

  j = skipWhitespace(content, j + 1);
  if (content[j] !== ",") return null;
  return { tag, end: j + 1 };
}

function readStaticDefinedTags(content: string): string[] {
  const tags: string[] = [];
  let i = 0;

  while (i < content.length) {
    const char = content[i]!;

    if (char === "/" && content[i + 1] === "/") {
      i += 2;
      while (i < content.length && content[i] !== "\n") i += 1;
      continue;
    }

    if (char === "/" && content[i + 1] === "*") {
      i += 2;
      while (i < content.length && !(content[i] === "*" && content[i + 1] === "/")) i += 1;
      i = Math.min(i + 2, content.length);
      continue;
    }

    if (char === "'" || char === '"') {
      i = skipQuotedString(content, i, char);
      continue;
    }

    if (char === "`") {
      i = skipTemplateLiteral(content, i);
      continue;
    }

    const match = readStaticDefinedTagAt(content, i);
    if (match) {
      tags.push(match.tag);
      i = match.end;
      continue;
    }

    i += 1;
  }

  return tags;
}

function readFirstStaticDefinedTag(content: string): string | null {
  return readStaticDefinedTags(content)[0] ?? null;
}

function getFileContent(ports: ReviveCompilerPorts, filePath: string): string | null {
  if (ports.readFile) return ports.readFile(filePath);
  try {
    return readFileSync(filePath, "utf-8");
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
      const tagSource = input.tagSource ?? "registeredTag";
      const absoluteFiles = [...new Set([...input.directoryFiles, ...input.islandFiles])];
      const filePaths = ports.toLoadPaths(new Set(absoluteFiles), input.root);
      const fileMappings = absoluteFiles.map((absoluteFilePath, index) => {
        const filePath = filePaths[index]!;
        let defaultTag: string;
        if (tagSource === "registeredTag") {
          const content = getFileContent(ports, absoluteFilePath);
          const tags = content ? readStaticDefinedTags(content) : [];
          if (tags.length === 0) {
            throw new Error(
              `[vite-plugin-shopify-theme-islands] ${filePath}: no static customElements.define("...", ...) found. In registeredTag mode this plugin requires exactly one static Registered Tag per Island file so Tag ownership and lazy-load boundaries stay unambiguous. Add customElements.define("your-tag", ...) or switch to tagSource: "filename".`,
            );
          }
          if (tags.length > 1) {
            throw new Error(
              `[vite-plugin-shopify-theme-islands] ${filePath}: found ${tags.length} static customElements.define(...) calls (${tags.map((t) => `<${t}>`).join(", ")}). In registeredTag mode this plugin requires exactly one Registered Tag per Island file so Tag ownership and lazy-load boundaries stay unambiguous.`,
            );
          }
          defaultTag = tags[0]!;
        } else {
          defaultTag = deriveDefaultTag(filePath);
        }
        const resolvedTag = input.resolveTag
          ? input.resolveTag({ filePath, defaultTag })
          : defaultTag;
        return { absoluteFilePath, filePath, defaultTag, resolvedTag };
      });
      const resolvedTagByFilePath = new Map(
        fileMappings.map(({ filePath, resolvedTag }) => [filePath, resolvedTag]),
      );
      assertUniqueResolvedTagOwnership(fileMappings);
      const islandPaths =
        input.islandFiles.size > 0 ? ports.toLoadPaths(input.islandFiles, input.root) : null;
      const resolvedTags = (() => {
        if (tagSource === "registeredTag") {
          const entries: Array<[string, string | false]> = [];
          for (const { filePath, resolvedTag } of fileMappings) {
            if (resolvedTag !== deriveDefaultTag(filePath)) entries.push([filePath, resolvedTag]);
          }
          return entries.length > 0 ? Object.fromEntries(entries) : null;
        }
        return input.resolveTag
          ? compileResolvedTags(
              filePaths,
              ({ filePath, defaultTag }) => resolvedTagByFilePath.get(filePath) ?? defaultTag,
            )
          : null;
      })();
      if (tagSource === "filename") {
        for (const { absoluteFilePath, filePath, resolvedTag } of fileMappings) {
          if (resolvedTag === false) continue;
          const content = getFileContent(ports, absoluteFilePath);
          const definedTag = content ? readFirstStaticDefinedTag(content) : null;
          if (definedTag && definedTag !== resolvedTag) {
            warnOnStaticTagMismatch(filePath, resolvedTag, definedTag);
          }
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
      const ownershipMap: Map<string, string | false> =
        tagSource === "registeredTag"
          ? new Map(
              fileMappings.map(({ absoluteFilePath, resolvedTag }) => [
                absoluteFilePath,
                resolvedTag,
              ]),
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
      const tagSource = input.tagSource ?? "registeredTag";
      if (tagSource === "filename") return null;
      const content = getFileContent(ports, absoluteFilePath);
      const tags = content ? readStaticDefinedTags(content) : [];
      if (tags.length !== 1) return null;
      const defaultTag = tags[0]!;
      return input.resolveTag ? input.resolveTag({ filePath, defaultTag }) : defaultTag;
    },
  };
}
