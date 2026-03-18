# RFC: Debug Logger as Injected Dependency

## Problem

`src/runtime.ts` — debug logging is constructed inline inside `loadIsland()` on every
invocation and threaded as two separate parameters through downstream functions:

```ts
// Constructed per-island-load:
const msgs = debug ? ([] as string[]) : null;
const note = msgs ? (msg: string) => msgs.push(msg) : noop;
const flushLog = msgs
  ? (final: string) => {
      if (msgs.length === 0) {
        console.log("[islands]", `<${tagName}> ${final}`);
      } else {
        console.groupCollapsed(`[islands] <${tagName}> ${final}`);
        for (const m of msgs) console.log(m);
        console.groupEnd();
      }
    }
  : noop;
```

Then:
- `note` is passed to `applyBuiltInDirectives(tagName, el, note)` — last parameter
- `flushLog` is passed to `applyCustomDirectives(tagName, el, matched, run, handleDirectiveError, flushLog)` — last parameter
- `flushLog(...)` is called at three separate sites in `loadIsland`

Problems:
1. Adding a new directive stage requires threading both `note` and `flushLog` as two new
   parameters — structural friction for every future extension.
2. The `msgs ? note : noop` null-check is noise repeated at every call site.
3. `tagName` is threaded separately alongside the logger primitives, even though it's
   only needed for log formatting.
4. Three `flushLog` sites means the `[islands] <tag> ...` prefix format is implicitly
   replicated.

## Recommended Interface

The **minimal** and **common-caller** designs converge — both arrive at `note/flush` with
a `NOOP_LOGGER` singleton. This is the right answer.

```ts
interface IslandLogger {
  /** Buffer an intermediate message. Always safe to call — no-op when debug is off. */
  note(msg: string): void;

  /**
   * Emit the buffer as a collapsed console group (if notes were buffered) or a
   * single console.log (if nothing was buffered). Then reset the buffer.
   * Always safe to call — no-op when debug is off.
   */
  flush(summary: string): void;
}

/**
 * Returns a real logger in debug mode, the NOOP_LOGGER singleton otherwise.
 * tagName is captured once — never needed as a separate parameter downstream.
 */
function createIslandLogger(tagName: string, debug: boolean): IslandLogger;
```

### Implementation sketch

```ts
const NOOP_LOGGER: IslandLogger = Object.freeze({
  note(_msg: string): void {},
  flush(_summary: string): void {},
});

function createIslandLogger(tagName: string, debug: boolean): IslandLogger {
  if (!debug) return NOOP_LOGGER;

  const msgs: string[] = [];
  return {
    note(msg) {
      msgs.push(msg);
    },
    flush(summary) {
      const label = `[islands] <${tagName}> ${summary}`;
      if (msgs.length === 0) {
        console.log(label);
      } else {
        console.groupCollapsed(label);
        for (const m of msgs) console.log(m);
        console.groupEnd();
      }
      msgs.length = 0; // reset so a logger can be flushed again after a retry
    },
  };
}
```

### Downstream signature changes

```ts
// Before
async function applyBuiltInDirectives(
  tagName: string,
  el: HTMLElement,
  note: (msg: string) => void,
): Promise<void>

// After — tagName removed (no longer needed for logging), note replaced by log
async function applyBuiltInDirectives(
  el: HTMLElement,
  log: IslandLogger,
): Promise<void>
```

```ts
// Before
function applyCustomDirectives(
  tagName: string,
  el: HTMLElement,
  matched: Array<[string, ClientDirective, string]>,
  run: () => Promise<void>,
  handleDirectiveError: (attrName: string, err: unknown) => void,
  flush: (msg: string) => void,
): boolean

// After — flush replaced by log
function applyCustomDirectives(
  tagName: string,
  el: HTMLElement,
  matched: Array<[string, ClientDirective, string]>,
  run: () => Promise<void>,
  handleDirectiveError: (attrName: string, err: unknown) => void,
  log: IslandLogger,
): boolean
```

### `loadIsland()` before/after

```ts
// Before
const msgs = debug ? ([] as string[]) : null;
const note = msgs ? (msg: string) => msgs.push(msg) : noop;
const flushLog = msgs ? (final: string) => { ... } : noop;

try {
  await applyBuiltInDirectives(tagName, el, note);
} catch {
  flushLog("aborted (element removed)");
  return;
}
if (applyCustomDirectives(tagName, el, matched, run, handleDirectiveError, flushLog)) return;
flushLog("triggered");
run();

// After
const log = createIslandLogger(tagName, debug);

try {
  await applyBuiltInDirectives(el, log);
} catch {
  log.flush("aborted (element removed)");
  return;
}
if (applyCustomDirectives(tagName, el, matched, run, handleDirectiveError, log)) return;
log.flush("triggered");
run();
```

The three `flushLog` sites become three `log.flush(...)` sites — same count, but the
format logic is in one place and `tagName` is gone from the surrounding call.

## What This Fixes

| Issue | Before | After |
|---|---|---|
| Two separate logger primitives threaded as params | `note`, `flushLog` on every stage function | single `log: IslandLogger` |
| `msgs ? note : noop` null-check noise | inline in `loadIsland` | inside `createIslandLogger` |
| `tagName` threaded alongside logger | separate parameter on `applyBuiltInDirectives` | captured in `createIslandLogger` closure |
| Log format `[islands] <tag> ...` duplicated | implicit across 3 flush sites | owned by `flush()` |
| New directive stage needs 2 new params | yes | 1 new param (`log`) |

## Testing

`IslandLogger` is trivially mockable:
```ts
const log = { note: vi.fn(), flush: vi.fn() };
```

Existing debug logging tests (spy on `console.groupCollapsed`) continue working — they
test through `revive()` with `debug: true` and the real `consoleSink` behaviour is
preserved inside `flush()`.

## Designs Considered

### Minimal / Common-caller (recommended — both converge)
`note(msg)` + `flush(summary)`, `NOOP_LOGGER` singleton, `createIslandLogger(tagName, debug)`
factory. The two constraints arrive at the same design independently. Zero allocations in
non-debug mode. `flush()` resets the buffer for potential future retry-loop reuse.

### Flexible (IslandSpan + IslandLogSink)
Structured `IslandLogEntry` with `level: LogLevel`, `stage: LogStage`, `ts: DOMHighResTimeStamp`,
`meta: Record<string, unknown>`. `IslandLogSink` interface enables devtools, telemetry,
in-memory capture for tests. `consoleSink()` / `memorySink()` / `nullSink()` as built-ins.
`ReviveOptions.logger` escape hatch for consumer sink registration.

Rejected for now: the structured entry shape and sink interface are a meaningful API
commitment with no current consumer. The `memorySink` pattern for tests is appealing but
achievable by mocking `console` without the full abstraction. **Worth revisiting if a
devtools integration story materialises** — the `IslandLogSink` interface would be the
right foundation.

## Note on `flush()` ownership convention

Only `loadIsland()` should call `flush()`. Inner functions (`applyBuiltInDirectives`,
`applyCustomDirectives`) call `note()` only. This is a convention, not enforced by types.
If callee discipline becomes a problem, split into:

```ts
interface IslandLogWriter { note(msg: string): void; }
interface IslandLogger extends IslandLogWriter { flush(summary: string): void; }
```

Pass `IslandLogWriter` to callees, keep `IslandLogger` in `loadIsland` only. Adds a second
type — not worth it until there's a violation to prevent.
