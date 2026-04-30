/**
 * Island discovery: scan and filter to produce the set of island file paths.
 * Single place for "what is an island?" and "paths for the virtual module".
 */
import { readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

/** Matches .ts or .js extension. Exported for plugin transform/watch filters. */
export const TS_JS_RE = /\.(ts|js)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "public", "assets", ".cache"]);
/** Matches the island mixin import. Exported for plugin transform/watch detection. */
export const ISLAND_IMPORT_RE = /from\s+['"]vite-plugin-shopify-theme-islands\/island['"]/;

export interface AliasLike {
  find: string | RegExp;
  replacement: string;
}

export interface IslandInventoryConfig {
  root: string;
  aliases: readonly AliasLike[];
}

export interface IslandInventorySnapshot {
  resolvedDirectories: string[];
  islandFiles: string[];
  directoryFiles: string[];
  directoryTagNames: string[];
}

export interface IslandInventoryChange {
  type: "detected" | "removed";
  file: string;
}

export interface IslandInventoryState {
  root: string;
  directories: string[];
  directoryFiles: Set<string>;
  islandFiles: Set<string>;
}

/** True if file is under any of the given absolute directory paths. */
export function inDirectory(file: string, absDirs: string[]): boolean {
  const resolvedFile = resolve(file);
  return absDirs.some((dir) => {
    const rel = relative(resolve(dir), resolvedFile);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  });
}

/** Paths for load() virtual module: "/relative/to/root" form, forward slashes. */
export function getIslandPathsForLoad(islandFiles: Set<string>, root: string): string[] {
  return [...islandFiles].map((file) => "/" + relative(root, file).replace(/\\/g, "/"));
}

function walkDir(dir: string, visitor: (name: string, full: string) => void): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkDir(full, visitor);
    else if (TS_JS_RE.test(entry.name)) visitor(entry.name, full);
  }
}

function resolveAliases(dirs: string[], aliasesInput: readonly AliasLike[]): string[] {
  const aliases = [...aliasesInput].sort(
    (a, b) =>
      (typeof b.find === "string" ? b.find.length : 0) -
      (typeof a.find === "string" ? a.find.length : 0),
  );
  return dirs.map((dir) => {
    for (const { find, replacement } of aliases) {
      if (typeof find === "string" && dir.startsWith(find)) return dir.replace(find, replacement);
      if (find instanceof RegExp && find.test(dir)) return dir.replace(find, replacement);
    }
    return dir;
  });
}

function toAbsoluteDirs(root: string, resolvedDirs: string[]): string[] {
  return resolvedDirs.map((dir) =>
    dir.startsWith(root) ? dir : join(root, dir.replace(/^\//, "")),
  );
}

/** Scan from root for files containing the island import; returns paths (not in absDirs). */
export function discoverIslandFiles(root: string, absDirs: string[]): Set<string> {
  const found = new Set<string>();
  walkDir(root, (_, full) => {
    try {
      if (ISLAND_IMPORT_RE.test(readFileSync(full, "utf-8"))) found.add(full);
    } catch {
      // skip unreadable
    }
  });
  for (const f of [...found]) if (inDirectory(f, absDirs)) found.delete(f);
  return found;
}

/** Tag names (filename without extension) for TS/JS files in a directory. Used for debug logging. */
export function collectTagNames(dir: string): string[] {
  const names: string[] = [];
  walkDir(dir, (name) => names.push(name.replace(TS_JS_RE, "")));
  return names;
}

function collectFiles(dir: string): string[] {
  const files: string[] = [];
  walkDir(dir, (_, full) => files.push(full));
  return files;
}

export function createIslandInventory(rawDirectories: string[]) {
  let root = process.cwd();
  let resolvedDirs = [...rawDirectories];
  let absDirs = [...rawDirectories];
  const directoryFiles = new Set<string>();
  const islandFiles = new Set<string>();
  let scanned = false;

  const buildSnapshot = (): IslandInventorySnapshot => ({
    resolvedDirectories: [...resolvedDirs],
    directoryFiles: [...directoryFiles],
    islandFiles: [...islandFiles],
    directoryTagNames: absDirs.flatMap((dir) => collectTagNames(dir)),
  });

  const updateIslandFile = (id: string, code: string): IslandInventoryChange | null => {
    if (!TS_JS_RE.test(id)) return null;
    if (
      code.includes("shopify-theme-islands/island") &&
      ISLAND_IMPORT_RE.test(code) &&
      !inDirectory(id, absDirs)
    ) {
      const sizeBefore = islandFiles.size;
      islandFiles.add(id);
      return islandFiles.size !== sizeBefore ? { type: "detected", file: id } : null;
    }
    return islandFiles.delete(id) ? { type: "removed", file: id } : null;
  };

  const ensureScanned = (): IslandInventorySnapshot | null => {
    if (scanned) return null;
    scanned = true;
    directoryFiles.clear();
    absDirs.flatMap((dir) => collectFiles(dir)).forEach((file) => directoryFiles.add(file));
    islandFiles.clear();
    discoverIslandFiles(root, absDirs).forEach((file) => islandFiles.add(file));
    return buildSnapshot();
  };

  return {
    configure(config: IslandInventoryConfig): void {
      root = config.root;
      resolvedDirs = resolveAliases(rawDirectories, config.aliases);
      absDirs = toAbsoluteDirs(root, resolvedDirs);
    },

    scan(): IslandInventorySnapshot | null {
      return ensureScanned();
    },

    applyTransform(id: string, code: string): IslandInventoryChange | null {
      return updateIslandFile(id, code);
    },

    applyWatchChange(id: string, event: string): IslandInventoryChange | null {
      if (!TS_JS_RE.test(id)) return null;
      if (inDirectory(id, absDirs)) {
        if (event === "delete") {
          return directoryFiles.delete(id) ? { type: "removed", file: id } : null;
        }
        if (!directoryFiles.has(id)) {
          directoryFiles.add(id);
          return { type: "detected", file: id };
        }
        return null;
      }
      if (event === "delete") {
        return islandFiles.delete(id) ? { type: "removed", file: id } : null;
      }
      try {
        return updateIslandFile(id, readFileSync(id, "utf-8"));
      } catch {
        return null;
      }
    },

    state(): IslandInventoryState {
      ensureScanned();
      return {
        root,
        directories: [...resolvedDirs],
        directoryFiles: new Set(directoryFiles),
        islandFiles: new Set(islandFiles),
      };
    },

    getRoot(): string {
      return root;
    },
  };
}
