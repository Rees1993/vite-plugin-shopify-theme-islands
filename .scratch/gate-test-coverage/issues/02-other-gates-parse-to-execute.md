# Integration coverage: `client:visible` / `client:idle` / `client:defer` / `client:media` parse → execute

Status: needs-triage

## What to build

Extend the parse → execute integration coverage from issue 01 to the remaining built-in Gate types. Each test fixture should run a real attribute through the spine and the Activation session, asserting that the right waiter is invoked with the right inputs and that activation actually happens (or doesn't) under realistic conditions.

## Acceptance criteria

- [ ] `client:visible` — attribute parsed, IntersectionObserver fires, Activation runs
- [ ] `client:idle` — integer parsed correctly; suffix junk like `"20ms"` falls back to default; activation fires after the configured idle delay
- [ ] `client:defer` — integer parsed correctly; empty value falls back to `defer.delay`; activation fires after the timer
- [ ] `client:media` — query string honoured; empty value warns and skips media check (loads immediately) per the existing `directive-spine.test.ts` framing
- [ ] Reuses the helper shape introduced in issue 01
- [ ] `bun run check`, `bun test`, `bun run lint`, `bun run format` all pass

## Notes

- Can be one combined test file or split per Gate kind — implementer's call
- Same testing-fix framing as issue 01

## Blocked by

- Issue 01 — `client:interaction` parse → execute (helper shape stabilises there first)
