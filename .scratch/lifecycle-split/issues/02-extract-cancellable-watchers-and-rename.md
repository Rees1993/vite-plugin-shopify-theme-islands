# Extract Cancellable watcher set, then rename what's left of `lifecycle.ts`

Status: needs-triage

## What to build

Two-step change in one slice:

1. **Extract cancellable watchers.** Move `watchCancellable` / `cancelDetached` / the `cancellableElements` map into a new `src/cancellable-watchers.ts`. Lifecycle delegates.
2. **Rename what's left of `lifecycle.ts`.** After issue 01 (retry scheduler) and step 1 of this issue land, `lifecycle.ts` only owns Observed-root tracking + per-Tag queue/loaded sets. Rename the file and the type to reflect that scope (e.g. `observed-root-tracker.ts` / `ObservedRootTracker`). Update CONTEXT.md vocabulary if a new domain term emerges.

## Acceptance criteria

- [ ] New module `src/cancellable-watchers.ts` owns the cancellable-element bookkeeping
- [ ] `lifecycle.ts` calls into it; no cancellable-specific state remains in lifecycle
- [ ] Existing `watchCancellable` / `cancelDetached` coverage moves to a focused test file
- [ ] After step 1, what remains in `lifecycle.ts` is renamed to reflect its actual scope; CONTEXT.md updated if the rename introduces or sharpens a domain term
- [ ] No public API change; consumers see no surface difference
- [ ] `bun run check`, `bun test`, `bun run lint`, `bun run format` all pass

## Notes

- Naming for both modules is a placeholder — confirm at implementation time
- The rename is part of this slice (not its own) because the module's identity only becomes clear once both retry and cancellation are gone

## Blocked by

- Issue 01 — Extract Retry scheduler
