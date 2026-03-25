/**
 * Virtual revive module source generator.
 * Single place for "what the client receives" when loading the revive virtual module.
 */
import type { ReviveOptions } from "./contract.js";

export interface BuildReviveModuleSourceParams {
  /** Resolved path to the runtime module (revive export). */
  runtimePath: string;
  /** import.meta.glob expressions for configured island directories. */
  directoryGlobs: string[];
  /** Additional discovered island paths outside the configured directories. */
  islandPaths?: string[] | null;
  /** Resolved custom directive modules keyed by attribute name. */
  customDirectives?: Array<{ name: string; entrypoint: string }>;
  /** Options object passed to revive (JSON-serialized in output). */
  reviveOptions: ReviveOptions;
}

/**
 * Builds the source code for the virtual revive module.
 * Used by the plugin's load() so the emitted shape is defined and testable in one place.
 */
export function buildReviveModuleSource(params: BuildReviveModuleSourceParams): string {
  const { runtimePath, directoryGlobs, islandPaths, customDirectives, reviveOptions } = params;
  const directiveImportLines =
    customDirectives?.map(
      ({ entrypoint }, index) => `import _directive${index} from ${JSON.stringify(entrypoint)};`,
    ) ?? [];
  const globEntries = [
    `{ ${directoryGlobs.map((glob) => `...import.meta.glob(${JSON.stringify(glob)})`).join(", ")} }`,
  ];
  if (islandPaths?.length) globEntries.push(`import.meta.glob(${JSON.stringify(islandPaths)})`);

  const lines = [
    ...directiveImportLines,
    `import { revive as _islands } from ${JSON.stringify(runtimePath)};`,
    `const islands = Object.assign({}, ${globEntries.join(", ")});`,
    `const options = ${JSON.stringify(reviveOptions)};`,
  ];

  if (customDirectives?.length) {
    const customDirectivesMapLines = customDirectives.map(
      ({ name }, index) => `  [${JSON.stringify(name)}, _directive${index}]`,
    );
    lines.push(`const customDirectives = new Map([\n${customDirectivesMapLines.join(",\n")}\n]);`);
    lines.push(`const payload = { islands, options, customDirectives };`);
  } else {
    lines.push(`const payload = { islands, options };`);
  }
  lines.push(`const runtimeKey = "__shopify_theme_islands_runtime__";`);
  lines.push(`const runtimeState = (globalThis[runtimeKey] ??= {});`);
  lines.push(`const runtime = runtimeState.runtime ?? _islands(payload);`);
  lines.push(`runtimeState.runtime = runtime;`);
  lines.push(`if (import.meta.hot) {`);
  lines.push(`  import.meta.hot.accept();`);
  lines.push(`  import.meta.hot.dispose(() => {`);
  lines.push(`    if (runtimeState.runtime === runtime) {`);
  lines.push(`      runtime.disconnect();`);
  lines.push(`      delete runtimeState.runtime;`);
  lines.push(`    }`);
  lines.push(`  });`);
  lines.push(`}`);
  lines.push(`export const { disconnect, scan, observe, unobserve } = runtime;`);

  return lines.join("\n");
}
