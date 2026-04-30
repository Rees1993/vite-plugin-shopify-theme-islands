# Shrink `RuntimeObservability` to its debug-only methods

Status: needs-triage

## What to build

Drop the four surface pass-throughs from `RuntimeObservability` (`createLogger`, `dispatchLoad`, `dispatchError`, `beginReadyLog`). The Activation session takes a new `surface` dep alongside `observability`, and surface call sites move from `observability.dispatchLoad(...)` to `surface.dispatchLoad(...)` (etc.).

After this slice:

- `RuntimeObservability` exposes three methods (`noteInitialWaits`, `warnOnConflictingLoadGate`, `clear`) — all debug-only, all backed by real state in `runtime-observability.ts`.
- `RuntimeSurface` is the single seam for runtime-side dispatch (events, logs, ready-log).
- `ActivationSessionDeps` declares both `observability` and `surface` as separate `Pick<…>` fields, narrowed to what the session actually uses.

See ADR-0002 for the rationale.

## Acceptance criteria

- [ ] `RuntimeObservability` interface (in `src/runtime-observability.ts`) exposes only `noteInitialWaits`, `warnOnConflictingLoadGate`, `clear`
- [ ] `RuntimeObservabilityDeps.surface` field removed; observability no longer wraps surface
- [ ] `ActivationSessionDeps` adds `surface: Pick<RuntimeSurface, "createLogger" | "dispatchLoad" | "dispatchError">`
- [ ] Activation-session call sites at `activation-session.ts:272, 284, 331, 342` moved from `observability.*` to `surface.*`
- [ ] Wiring at `runtime.ts:67` passes `runtimeSurface` as a new `surface` dep to the session
- [ ] Existing observability tests cover the trimmed interface; new tests where needed for the surface wiring
- [ ] No public API change; consumers see no surface difference
- [ ] `bun run check`, `bun test`, `bun run lint`, `bun run format` all pass

## Notes

- `runtime-observability.ts` shrinks from ~124 to ~70 lines
- This partially reverses the consolidated extraction landed in v2.0; ADR-0002 records why
- `runtime-ownership.ts:63` already calls `surface.beginReadyLog` directly — no change needed there

## Blocked by

None — can start immediately.
