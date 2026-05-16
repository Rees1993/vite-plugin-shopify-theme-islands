# `RuntimeObservability` is debug-only; surface stands on its own

`RuntimeObservability` exposes only the three debug-time methods that have real content: `noteInitialWaits`, `warnOnConflictingLoadGate`, and `clear`. The four surface methods it previously re-exported (`createLogger`, `dispatchLoad`, `dispatchError`, `beginReadyLog`) are taken directly from `RuntimeSurface` by the Activation session as a separate `surface` dependency.

The earlier shape — observability wrapping surface so the Activation session could take one dep — bundled two unrelated concerns under one name. The interface lied: most of `RuntimeObservability` was just surface in disguise. Splitting them makes the type honest: `RuntimeSurface` is the runtime's outward dispatch seam (events, logs, ready-log); `RuntimeObservability` is the debug observer with its own state. Each has a single purpose and the Activation session declares both as separate deps.

This partially walks back the consolidated extraction that landed in v2.0. Recording it here so future architecture reviews don't re-suggest re-bundling them, and so the apparent "extract then trim" pattern in git history has a clear reason.

Internal-only — `RuntimeObservability`, `RuntimeSurface`, and `ActivationSessionDeps` are not exported from any package entry. Consumers see no change.

## Considered alternatives

- **Keep the consolidated module.** Rejected: the interface didn't reflect what the module did; four of seven methods were pure delegates. "One-dep convenience" wasn't worth the dishonesty.
- **Split debug observability further into per-behaviour modules** (`gate-conflict-warner.ts`, `initial-waits-logger.ts`). Rejected: both behaviours watch element-level Gate state in real time and share state-management concerns; they belong together as one debug observer.
