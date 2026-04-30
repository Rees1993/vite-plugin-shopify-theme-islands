# Integration coverage: `client:interaction` parse → execute

Status: needs-triage

## What to build

Add a test file that exercises a real `client:interaction` attribute end-to-end through the parse → execute path: the spine reads the attribute, builds the Gate, the Activation session reads the Gate, dispatches to the interaction waiter, and the waiter runs against real DOM listeners.

Currently parsing is covered in `directive-spine.test.ts` and execution is covered with mocked waiters. No test bridges the two, which means a regression in `partitionInteractionEventTokens()` (token validation lives in `interaction-events.ts`) can pass both unit suites and only surface in integration.

This slice also stabilises the test-helper shape that issue 02 will reuse for the other Gate types.

## Acceptance criteria

- [ ] New test file (e.g. `src/__tests__/parse-to-execute-interaction.test.ts`) exists
- [ ] Covers happy-path: a valid `client:interaction="mouseenter touchstart"` triggers Activation when the listed event fires on the element
- [ ] Covers token filtering: an attribute with a mix of valid and invalid tokens activates only on the valid ones, with the runtime warning at `activation-session.ts:142–149` firing exactly as expected
- [ ] Covers the all-tokens-invalid case: falls back to configured default events, warns once
- [ ] Covers empty attribute: falls back to configured default events
- [ ] Test helper shape is reusable by issue 02 (visible/idle/defer/media)
- [ ] `bun run check`, `bun test`, `bun run lint`, `bun run format` all pass

## Notes

- Use real DOM events via the existing test harness, not mocks of the waiter
- This is a testing fix, not an architectural change

## Blocked by

None — can start immediately.
