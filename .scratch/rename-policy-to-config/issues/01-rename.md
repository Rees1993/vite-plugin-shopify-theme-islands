# Rename `Policy` → `Config` in plugin internals

Status: ready-for-human

## Why

"Policy" implies rules / permissions / decisions. The thing it names is a validated configuration object with two derivation methods (`runtimeOptions()`, `compileBootstrap()`). The rename describes the shape honestly. Internal-only — no `Policy` symbol is exported from the package entry, so consumers see no change.

## Symbols

| Current | Target |
| --- | --- |
| `src/config-policy.ts` | `src/resolved-config.ts` |
| `ThemeIslandsPluginPolicy` | `ThemeIslandsPluginConfig` |
| `CompiledThemeIslandsPolicy` | `CompiledThemeIslandsConfig` |
| `resolveThemeIslandsPolicy` | `resolveThemeIslandsConfig` |
| `compileThemeIslandsPolicy` | `compileThemeIslandsConfig` |

## Call sites

- `src/config-policy.ts` (definition)
- `src/index.ts` — 4 lines (one import, three usages)
- `src/__tests__/config-policy.test.ts` — move to `resolved-config.test.ts`

## Done when

- `bun run check` passes
- `bun run lint` passes
- `bun test` passes
- No `Policy` references remain in `src/`
