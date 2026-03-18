/**
 * Virtual revive module source generator.
 * Single place for "what the client receives" when loading the revive virtual module.
 */
import type { ReviveOptions } from "./contract.js";

export interface BuildReviveModuleSourceParams {
  /** Resolved path to the runtime module (revive export). */
  runtimePath: string;
  /** Import statements for custom directive modules. */
  directiveImportLines: string[];
  /** RHS of "const islands = ..." (e.g. "Object.assign({}, ...)"). */
  islandsObjectExpr: string;
  /** Lines for "new Map([...])" — each line is one "[key, value]" entry. Null when no custom directives. */
  customDirectivesMapLines: string[] | null;
  /** Options object passed to revive (JSON-serialized in output). */
  reviveOptions: ReviveOptions;
}

/**
 * Builds the source code for the virtual revive module.
 * Used by the plugin's load() so the emitted shape is defined and testable in one place.
 */
export function buildReviveModuleSource(params: BuildReviveModuleSourceParams): string {
  const {
    runtimePath,
    directiveImportLines,
    islandsObjectExpr,
    customDirectivesMapLines,
    reviveOptions,
  } = params;

  const lines = [
    ...directiveImportLines,
    `import { revive as _islands } from ${JSON.stringify(runtimePath)};`,
    `const islands = ${islandsObjectExpr};`,
    `const options = ${JSON.stringify(reviveOptions)};`,
  ];

  if (customDirectivesMapLines?.length) {
    lines.push(`const customDirectives = new Map([\n${customDirectivesMapLines.join(",\n")}\n]);`);
    lines.push(`const payload = { islands, options, customDirectives };`);
  } else {
    lines.push(`const payload = { islands, options };`);
  }
  lines.push(`export const { disconnect } = _islands(payload);`);

  return lines.join("\n");
}
