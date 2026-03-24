import { describe, expect, it, mock } from "bun:test";
import { createActivationPipeline } from "../activation-pipeline";
import { DEFAULT_DIRECTIVES } from "../contract";

const flush = (ms = 20) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("activation-pipeline", () => {
  it("dispatches load and re-walks child islands after a successful activation", async () => {
    const dispatchLoad = mock((_detail: { tag: string; duration: number; attempt: number }) => {});
    const dispatchError = mock((_detail: { tag: string; error: unknown; attempt: number }) => {});
    const beginReadyLog = mock(() => () => {});
    const createLogger = mock(() => ({ note() {}, flush() {} }));
    const directiveOrchestrator = {
      run: mock(async () => false),
    };
    const lifecycle = {
      settleSuccess: mock(() => 2),
      settleFailure: mock(() => ({ retryDelayMs: null, attempt: 1 })),
      evict: mock(() => {}),
      isQueued: mock(() => false),
      initialWalkComplete: true,
      watchCancellable: mock(() => () => {}),
      walk: mock(() => {}),
      start: mock(() => ({ disconnect() {} })),
    };
    const pipeline = createActivationPipeline({
      directives: DEFAULT_DIRECTIVES,
      debug: false,
      directiveTimeout: 0,
      lifecycle,
      runtimeSurface: {
        dispatchLoad,
        dispatchError,
        onLoad: mock(() => () => {}),
        onError: mock(() => () => {}),
        createLogger,
        beginReadyLog,
      },
      directiveOrchestrator,
    });
    const el = document.createElement("success-island");
    el.appendChild(document.createElement("child-island"));
    const loader = mock(async () => {});

    await pipeline.activate("success-island", el, loader);
    await flush();

    expect(loader).toHaveBeenCalledTimes(1);
    expect(lifecycle.settleSuccess).toHaveBeenCalledWith("success-island");
    expect(dispatchLoad).toHaveBeenCalledTimes(1);
    expect(dispatchLoad.mock.calls[0][0]).toMatchObject({ tag: "success-island", attempt: 2 });
    expect(dispatchError).not.toHaveBeenCalled();
    expect(lifecycle.walk).toHaveBeenCalledWith(el);
  });

  it("dispatches directive errors and evicts the queued tag when a custom directive fails", async () => {
    const err = new Error("boom");
    const dispatchError = mock((_detail: { tag: string; error: unknown; attempt: number }) => {});
    const directiveOrchestrator = {
      run: mock(async (ctx) => {
        ctx.onError("client:broken", err);
        return true;
      }),
    };
    const lifecycle = {
      settleSuccess: mock(() => 1),
      settleFailure: mock(() => ({ retryDelayMs: null, attempt: 1 })),
      evict: mock(() => {}),
      isQueued: mock(() => false),
      initialWalkComplete: true,
      watchCancellable: mock(() => () => {}),
      walk: mock(() => {}),
      start: mock(() => ({ disconnect() {} })),
    };
    const pipeline = createActivationPipeline({
      directives: DEFAULT_DIRECTIVES,
      debug: false,
      directiveTimeout: 0,
      lifecycle,
      runtimeSurface: {
        dispatchLoad: mock(() => {}),
        dispatchError,
        onLoad: mock(() => () => {}),
        onError: mock(() => () => {}),
        createLogger: mock(() => ({ note() {}, flush() {} })),
        beginReadyLog: mock(() => () => {}),
      },
      directiveOrchestrator,
    });

    await pipeline.activate(
      "broken-island",
      document.createElement("broken-island"),
      mock(async () => {}),
    );

    expect(dispatchError).toHaveBeenCalledWith({
      tag: "broken-island",
      error: err,
      attempt: 1,
    });
    expect(lifecycle.evict).toHaveBeenCalledWith("broken-island");
  });

  it("owns the ready-log lifetime across initial walk and disconnect", () => {
    const endReadyLog = mock(() => {});
    const beginReadyLog = mock(() => endReadyLog);
    const pipeline = createActivationPipeline({
      directives: DEFAULT_DIRECTIVES,
      debug: true,
      directiveTimeout: 0,
      lifecycle: {
        settleSuccess: mock(() => 1),
        settleFailure: mock(() => ({ retryDelayMs: null, attempt: 1 })),
        evict: mock(() => {}),
        isQueued: mock(() => false),
        initialWalkComplete: false,
        watchCancellable: mock(() => () => {}),
        walk: mock(() => {}),
        start: mock(() => ({ disconnect() {} })),
      },
      runtimeSurface: {
        dispatchLoad: mock(() => {}),
        dispatchError: mock(() => {}),
        onLoad: mock(() => () => {}),
        onError: mock(() => () => {}),
        createLogger: mock(() => ({ note() {}, flush() {} })),
        beginReadyLog,
      },
    });

    pipeline.beginInitialWalk(2);
    expect(beginReadyLog).toHaveBeenCalledWith(2, true);
    pipeline.completeInitialWalk();
    expect(endReadyLog).toHaveBeenCalledTimes(1);

    beginReadyLog.mockClear();
    endReadyLog.mockClear();
    pipeline.beginInitialWalk(3);
    pipeline.disconnect();
    expect(beginReadyLog).toHaveBeenCalledWith(3, true);
    expect(endReadyLog).toHaveBeenCalledTimes(1);
  });
});
