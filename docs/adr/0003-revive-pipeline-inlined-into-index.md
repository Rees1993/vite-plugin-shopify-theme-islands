# `revive-pipeline.ts` inlined into the plugin entry

`createRevivePipeline` is removed. The plugin entry (`src/index.ts`) instantiates `createIslandInventory(...)` and `createReviveCompiler(...)` directly and uses each from the relevant Vite hook (`scan` from `buildStart`, `applyTransform` from `transform`, `applyWatchChange` from `watchChange`, `compile(inventory.state(), …)` from `load`).

The pipeline existed to give `index.ts` one composite dependency, but five of its six methods were pure delegation to `inventory` and the sixth was a one-line composition of `inventory.state()` + `compiler.compile(...)`. The interface implied coordination it wasn't doing. Removing the layer concentrates the plugin's wiring story in one file: anyone reading `index.ts` sees the full lifecycle of the virtual `/revive` module without bouncing into a pipeline indirection.

This partially walks back the consolidated pipeline that landed in v2.0. Recording it here so future architecture reviews don't re-suggest re-introducing the layer, and so the apparent "extract then inline" pattern in git history has a clear reason.

Internal-only — `RevivePipeline` and `RevivePipelineOptions` are not exported from any package entry. Consumers see no change.

## Considered alternatives

- **Keep `revive-pipeline` and deepen it** by moving the dev-server invalidation handshake (`invalidateReviveModule` in `index.ts`) into the pipeline. Rejected: the invalidation logic touches `devServer.moduleGraph` and `devServer.ws`, which are Vite-plugin concerns that don't belong inside the discovery/compile pair. Relocating them would make the pipeline broader and `index.ts` no thinner.
- **Keep `revive-pipeline` as-is.** Rejected: the interface lied about what the module did, same problem the `RuntimeObservability` shrink in ADR-0002 fixes.
