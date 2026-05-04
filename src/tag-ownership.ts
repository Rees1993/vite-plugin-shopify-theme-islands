import { deriveDefaultTag } from "./contract.js";
import type { ResolveTagFn } from "./options.js";

export interface TagOwnershipRecord {
  absoluteFilePath: string;
  filePath: string;
  defaultTag: string;
  resolvedTag: string | false;
}

export interface TagOwnershipInputs {
  files: Array<{ absoluteFilePath: string; filePath: string }>;
  tagSource: "registeredTag" | "filename";
  resolveTag?: ResolveTagFn;
  getFileContent: (absoluteFilePath: string) => string | null;
}

class StaticDefinedTagScanner {
  private readonly content: string;
  private cursor = 0;

  constructor(content: string) {
    this.content = content;
  }

  scan(): string[] {
    const tags: string[] = [];

    while (this.cursor < this.content.length) {
      if (this.skipComment() || this.skipQuotedString() || this.skipTemplateLiteral()) continue;

      const tag = this.readStaticDefinedTag();
      if (tag !== null) {
        tags.push(tag);
        continue;
      }

      this.cursor += 1;
    }

    return tags;
  }

  private skipComment(): boolean {
    if (this.peek() !== "/") return false;

    if (this.peek(1) === "/") {
      this.cursor += 2;
      while (this.cursor < this.content.length && this.peek() !== "\n") this.cursor += 1;
      return true;
    }

    if (this.peek(1) !== "*") return false;

    this.cursor += 2;
    while (this.cursor < this.content.length && !(this.peek() === "*" && this.peek(1) === "/")) {
      this.cursor += 1;
    }
    this.cursor = Math.min(this.cursor + 2, this.content.length);
    return true;
  }

  private skipQuotedString(): boolean {
    const quote = this.peek();
    if (quote !== "'" && quote !== '"') return false;

    this.cursor += 1;
    while (this.cursor < this.content.length) {
      if (this.peek() === "\\") {
        this.cursor += 2;
        continue;
      }
      if (this.peek() === quote) {
        this.cursor += 1;
        return true;
      }
      this.cursor += 1;
    }

    return true;
  }

  private skipTemplateLiteral(): boolean {
    if (this.peek() !== "`") return false;

    this.cursor += 1;
    while (this.cursor < this.content.length) {
      if (this.peek() === "\\") {
        this.cursor += 2;
        continue;
      }
      if (this.peek() === "`") {
        this.cursor += 1;
        return true;
      }
      this.cursor += 1;
    }

    return true;
  }

  private readStaticDefinedTag(): string | null {
    const prefix = "customElements.define";
    if (!this.content.startsWith(prefix, this.cursor)) return null;
    if (this.isIdentifierChar(this.peek(-1))) return null;

    let index = this.skipWhitespace(this.cursor + prefix.length);
    if (this.content[index] !== "(") return null;

    index = this.skipWhitespace(index + 1);
    const quote = this.content[index];
    if (quote !== "'" && quote !== '"' && quote !== "`") return null;

    let tag = "";
    index += 1;
    while (index < this.content.length) {
      const char = this.content[index];
      if (char === "\\") return null;
      if (char === quote) break;
      tag += char;
      index += 1;
    }
    if (this.content[index] !== quote || !/^[a-z0-9-]+$/.test(tag)) return null;

    index = this.skipWhitespace(index + 1);
    if (this.content[index] !== ",") return null;

    this.cursor = index + 1;
    return tag;
  }

  private skipWhitespace(start: number): number {
    let index = start;
    while (index < this.content.length && /\s/.test(this.content[index]!)) index += 1;
    return index;
  }

  private isIdentifierChar(char: string | undefined): boolean {
    return char !== undefined && /[A-Za-z0-9_$]/.test(char);
  }

  private peek(offset = 0): string | undefined {
    return this.content[this.cursor + offset];
  }
}

export function readStaticDefinedTags(content: string): string[] {
  return new StaticDefinedTagScanner(content).scan();
}

function assertUniqueTagOwnership(
  records: Array<{ filePath: string; resolvedTag: string | false }>,
): void {
  const filePathsByTag = new Map<string, string[]>();
  for (const { filePath, resolvedTag } of records) {
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

function warnOnTagMismatch(filePath: string, resolvedTag: string, definedTag: string): void {
  console.warn(
    `[vite-plugin-shopify-theme-islands] ${filePath} resolves to <${resolvedTag}> but statically registers <${definedTag}> via customElements.define(...). Tag ownership is path-based, so update the filename/resolveTag() or the registered tag so they match.`,
  );
}

/**
 * Derives effective Tag ownership for every Island file in the inventory.
 * Throws when duplicate final Tag ownership is detected.
 * Warns (filename mode only) when the static Registered Tag mismatches the resolved Tag.
 */
export function analyzeTagOwnership(inputs: TagOwnershipInputs): TagOwnershipRecord[] {
  const { files, tagSource, resolveTag, getFileContent } = inputs;

  const records: TagOwnershipRecord[] = files.map(({ absoluteFilePath, filePath }) => {
    let defaultTag: string;

    if (tagSource === "registeredTag") {
      const content = getFileContent(absoluteFilePath);
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

    const resolvedTag = resolveTag ? resolveTag({ filePath, defaultTag }) : defaultTag;
    return { absoluteFilePath, filePath, defaultTag, resolvedTag };
  });

  assertUniqueTagOwnership(records);

  if (tagSource === "filename") {
    for (const { absoluteFilePath, filePath, resolvedTag } of records) {
      if (resolvedTag === false) continue;
      const content = getFileContent(absoluteFilePath);
      const definedTag = content ? (readStaticDefinedTags(content)[0] ?? null) : null;
      if (definedTag && definedTag !== resolvedTag) {
        warnOnTagMismatch(filePath, resolvedTag, definedTag);
      }
    }
  }

  return records;
}

/**
 * Re-derives the effective tag for one Island file.
 * Returns null when unreadable or indeterminate (filename mode, or multiple/zero static tags).
 */
export function recomputeFileTagOwnership(
  absoluteFilePath: string,
  filePath: string,
  inputs: Pick<TagOwnershipInputs, "tagSource" | "resolveTag" | "getFileContent">,
): string | false | null {
  const { tagSource, resolveTag, getFileContent } = inputs;
  if (tagSource === "filename") return null;

  const content = getFileContent(absoluteFilePath);
  const tags = content ? readStaticDefinedTags(content) : [];
  if (tags.length !== 1) return null;

  const defaultTag = tags[0]!;
  return resolveTag ? resolveTag({ filePath, defaultTag }) : defaultTag;
}
