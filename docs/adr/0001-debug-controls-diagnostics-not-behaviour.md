# `debug: true` controls diagnostics, never behaviour

Runtime and plugin behaviour must be identical regardless of the `debug` option. `debug: true` only opts a consumer into additional diagnostic output (`console.warn` / `console.debug` lines such as duplicate-`resolveTag` warnings, conflicting same-tag load-gate diagnostics, and static tag mismatch warnings).

Decisions that change what the code _does_ — for example, throwing on duplicate tag ownership in `buildIslandMap` — are unconditional and live in the runtime contract, not behind the debug flag. This keeps production and development on the same code path so a class of "works in dev, fails in prod" bugs cannot exist, and makes diagnostics opt-in noise rather than a behavioural switch.

## Considered alternatives

- **Stricter behaviour in debug** (e.g. throw instead of warn). Rejected: it lets users ship code that only fails for some readers, depending on how they configured the build.
- **Always warn, never opt-in**. Rejected: the diagnostics are intentionally chatty; gating them on `debug: true` keeps default builds quiet.
