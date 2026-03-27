import { describe, expect, it, mock } from "bun:test";
import { DEFAULT_DIRECTIVES, type IslandLoader } from "../contract";
import { createActivationSession, type ActivationCandidate } from "../activation-session";

describe("activation-session", () => {
  it("activates an island and dispatches load through one boundary", async () => {
    const platformConsole = {
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
      directiveTimeout: 0,
      orchestrator: {
        run: runBuiltIns,
      },
      ownership: {
        initialWalkComplete: true,
        isObserved: () => true,
        settleSuccess: () => 1,
        settleFailure: () => ({ willRetry: false, attempt: 1 }),
        evict: mock((_tag: string) => {}),
        clear: mock((_tags?: Iterable<string>) => {}),
        watchCancellable: mock(() => () => {}),
        walk,
      },
      observability: {
        createLogger: () => ({ note() {}, flush() {} }),
        dispatchLoad,
        dispatchError: mock((_detail: { tag: string; error: unknown; attempt: number }) => {}),
        noteInitialWaits: mock(() => {}),
        warnOnConflictingLoadGate: mock(() => {}),
        clear: mock(() => {}),
      },
      platform: {
        now: mock(() => 10),
        console: platformConsole,
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

  it("delegates subtree clear to the ownership boundary", async () => {
    const platformConsole = {
      error: mock(() => {}),
    };
    const loader = mock<IslandLoader>(async () => {
      throw new Error("retry me");
    });
    const evict = mock((_tag: string) => {});
    const clear = mock((_tags?: Iterable<string>) => {});
    const dispatchError = mock((_detail: { tag: string; error: unknown; attempt: number }) => {});

    const session = createActivationSession({
      directives: DEFAULT_DIRECTIVES,
      directiveTimeout: 0,
      orchestrator: {
        run: mock(async () => false),
      },
      ownership: {
        initialWalkComplete: true,
        isObserved: () => true,
        settleSuccess: () => 1,
        settleFailure: () => ({ willRetry: true, attempt: 1 }),
        evict,
        clear,
        watchCancellable: mock(() => () => {}),
        walk: mock((_root: HTMLElement) => {}),
      },
      observability: {
        createLogger: () => ({ note() {}, flush() {} }),
        dispatchLoad: mock(() => {}),
        dispatchError,
        noteInitialWaits: mock(() => {}),
        warnOnConflictingLoadGate: mock(() => {}),
        clear: mock(() => {}),
      },
      platform: {
        now: mock(() => 10),
        console: platformConsole,
      },
    });

    await session.activate({
      tagName: "x-retry",
      element: document.createElement("x-retry"),
      loader,
    });

    expect(loader).toHaveBeenCalledTimes(1);
    expect(dispatchError).toHaveBeenCalledTimes(1);

    session.clear(["x-retry"]);

    expect(clear).toHaveBeenCalledTimes(1);
    const tags = clear.mock.calls[0]?.[0];
    expect(tags ? [...tags] : []).toEqual(["x-retry"]);
    expect(evict).not.toHaveBeenCalled();
  });
});
