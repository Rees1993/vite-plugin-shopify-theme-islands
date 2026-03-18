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
