# Rename `Bootstrap` → `Compile` in plugin internals

Status: ready-for-human

## Why

"Bootstrap" collides with two unrelated meanings: the CSS framework, and the runtime boot step (`revive()`). Using "bootstrap" for the *build-time compile step* risks readers conflating it with the *runtime boot step* — different operations at different times. "Compile" describes what the step actually does. Internal-only — none of these symbols are exported from the package entry, so consumers see no change.

## Symbols

| Current | Target |
| --- | --- |
| `src/revive-bootstrap.ts` | `src/revive-compile.ts` |
| `ReviveBootstrapInputs` | `ReviveCompileInputs` |
| `ReviveBootstrapPlan` | `RevivePlan` |
| `ReviveBootstrapCompiler` | `ReviveCompiler` |
| `ReviveBootstrapCompilerPorts` | `ReviveCompilerPorts` |
| `ReviveBootstrapResolvePorts` | `ReviveCompileResolvePorts` |
| `createReviveBootstrapCompiler` | `createReviveCompiler` |
| `IslandInventoryBootstrapState` | `IslandInventoryState` |

## Call sites

- `src/revive-bootstrap.ts` (definition)
- `src/revive-pipeline.ts`
- `src/index.ts`
- `src/config-policy.ts`
- `src/discovery.ts`
- `src/__tests__/revive-bootstrap.test.ts` — move to `revive-compile.test.ts`

## Done when

- `bun run check` passes
- `bun run lint` passes
- `bun test` passes
- No `Bootstrap` references remain in `src/`
