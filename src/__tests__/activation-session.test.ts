import { describe, expect, it, mock } from "bun:test";
import { DEFAULT_DIRECTIVES, type IslandLoader } from "../contract";
import { createActivationSession, type ActivationCandidate } from "../activation-session";

describe("activation-session", () => {
  it("activates an island and dispatches load through one boundary", async () => {
    const platformConsole = {
      log: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
    };
    const loader = mock<IslandLoader>(async () => {});
    const runBuiltIns = mock(async () => false);
    const dispatchLoad = mock((_detail: { tag: string; duration: number; attempt: number }) => {});
    const walk = mock((_root: HTMLElement) => {});
    const candidateEl = document.createElement("x-activation");
    candidateEl.appendChild(document.createElement("x-child"));

    const session = createActivationSession({
      directives: DEFAULT_DIRECTIVES,
      debug: false,
      directiveTimeout: 0,
      orchestrator: {
        run: runBuiltIns,
      },
      ownership: {
        initialWalkComplete: true,
        isObserved: () => true,
        settleSuccess: () => 1,
        settleFailure: () => ({ retryDelayMs: null, attempt: 1 }),
        evict: mock((_tag: string) => {}),
        watchCancellable: mock(() => () => {}),
        walk,
      },
      surface: {
        createLogger: () => ({ note() {}, flush() {} }),
        dispatchLoad,
        dispatchError: mock((_detail: { tag: string; error: unknown; attempt: number }) => {}),
      },
      platform: {
        now: mock(() => 10),
        console: platformConsole,
        setTimeout,
        clearTimeout,
      },
    });

    const candidate: ActivationCandidate = {
      tagName: "x-activation",
      element: candidateEl,
      loader,
    };

    await session.activate(candidate);

    expect(runBuiltIns).toHaveBeenCalledTimes(1);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(dispatchLoad).toHaveBeenCalledWith({
      tag: "x-activation",
      duration: 0,
      attempt: 1,
    });
    expect(walk).toHaveBeenCalledWith(candidateEl);
  });

  it("clears pending retries for a tag when the subtree is unobserved", async () => {
    type FakeTimer = { fn: () => void; cleared: boolean };

    const timers: FakeTimer[] = [];
    const platformConsole = {
      log: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
    };
    const setTimeoutMock = mock((fn: () => void) => {
      const timer: FakeTimer = { fn, cleared: false };
      timers.push(timer);
      return timer as unknown as ReturnType<typeof setTimeout>;
    });
    const clearTimeoutMock = mock((timer: ReturnType<typeof setTimeout>) => {
      (timer as unknown as FakeTimer).cleared = true;
    });

    const loader = mock<IslandLoader>(async () => {
      throw new Error("retry me");
    });
    const evict = mock((_tag: string) => {});
    const dispatchError = mock((_detail: { tag: string; error: unknown; attempt: number }) => {});

    const session = createActivationSession({
      directives: DEFAULT_DIRECTIVES,
      debug: false,
      directiveTimeout: 0,
      orchestrator: {
        run: mock(async () => false),
      },
      ownership: {
        initialWalkComplete: true,
        isObserved: () => true,
        settleSuccess: () => 1,
        settleFailure: () => ({ retryDelayMs: 25, attempt: 1 }),
        evict,
        watchCancellable: mock(() => () => {}),
        walk: mock((_root: HTMLElement) => {}),
      },
      surface: {
        createLogger: () => ({ note() {}, flush() {} }),
        dispatchLoad: mock(() => {}),
        dispatchError,
      },
      platform: {
        now: mock(() => 10),
        console: platformConsole,
        setTimeout: setTimeoutMock as unknown as typeof setTimeout,
        clearTimeout: clearTimeoutMock as unknown as typeof clearTimeout,
      },
    });

    await session.activate({
      tagName: "x-retry",
      element: document.createElement("x-retry"),
      loader,
    });

    expect(loader).toHaveBeenCalledTimes(1);
    expect(dispatchError).toHaveBeenCalledTimes(1);
    expect(timers).toHaveLength(1);

    session.clear(["x-retry"]);

    expect(evict).toHaveBeenCalledWith("x-retry");
    expect(clearTimeoutMock).toHaveBeenCalledTimes(1);

    if (!timers[0].cleared) timers[0].fn();
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
