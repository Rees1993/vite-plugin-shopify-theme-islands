# Inline `revive-pipeline.ts` into the plugin entry

Status: needs-triage

## What to build

Remove `src/revive-pipeline.ts`. The plugin entry (`src/index.ts`) instantiates `createIslandInventory(...)` and `createReviveCompiler(...)` directly and uses each from the relevant Vite hook.

After this slice:

- `index.ts` constructs the inventory and the compiler at plugin-init time.
- `configResolved` calls `inventory.configure(...)`.
- `buildStart` calls `inventory.scan()`.
- `transform` calls `inventory.applyTransform(id, code)`.
- `watchChange` calls `inventory.applyWatchChange(id, event)`.
- `load` calls `compiler.compile(config.compileInputs(inventory.state()), { resolveEntrypoint })`.
- The `revive-pipeline.ts` and `revive-pipeline.test.ts` files are deleted.

See ADR-0003 for the rationale.

## Acceptance criteria

- [ ] `src/revive-pipeline.ts` deleted
- [ ] `src/__tests__/revive-pipeline.test.ts` deleted; any unique test cases that were covering real coordination logic are migrated to the existing `revive-compile.test.ts` or `discovery.test.ts`
- [ ] `src/index.ts` constructs `inventory` and `compiler` directly
- [ ] All five Vite-hook call sites updated to call `inventory.*` / `compiler.*` directly
- [ ] `index.ts` line count grows by no more than ~15 lines
- [ ] No public API change; consumers see no surface difference
- [ ] `bun run check`, `bun test`, `bun run lint`, `bun run format` all pass

## Notes

- This partially reverses the consolidated extraction that landed in v2.0; ADR-0003 records why
- Total source shrinks by ~55 lines (pipeline file gone, ~15 lines added to index.ts)
- The dev-server invalidation handshake in `index.ts` (`invalidateReviveModule`) stays where it is — it's plugin-specific glue, not pipeline concern

## Blocked by

None — can start immediately.
