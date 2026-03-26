import { afterEach, describe, expect, it, mock } from "bun:test";
import { createRuntimeSurface } from "../runtime-surface";

const cleanupCallbacks: Array<() => void> = [];

function trackCleanup<T extends () => void>(cleanup: T): T {
  cleanupCallbacks.push(cleanup);
  return cleanup;
}

describe("runtime-surface", () => {
  afterEach(() => {
    while (cleanupCallbacks.length > 0) {
      cleanupCallbacks.pop()?.();
    }
  });

  it("dispatches islands:load and islands:error through subscriptions", () => {
    const log = mock(() => {});
    const groupCollapsed = mock(() => {});
    const groupEnd = mock(() => {});
    const surface = createRuntimeSurface({
      target: document,
      console: { log, groupCollapsed, groupEnd },
    });
    const loadHandler = mock((_detail: { tag: string; duration: number; attempt: number }) => {});
    const errorHandler = mock((_detail: { tag: string; error: unknown; attempt: number }) => {});

    trackCleanup(surface.onLoad(loadHandler));
    trackCleanup(surface.onError(errorHandler));

    surface.dispatchLoad({ tag: "alpha-island", duration: 12, attempt: 1 });
    surface.dispatchError({ tag: "beta-island", error: new Error("boom"), attempt: 2 });

    expect(loadHandler).toHaveBeenCalledWith({
      tag: "alpha-island",
      duration: 12,
      attempt: 1,
    });
    expect(errorHandler).toHaveBeenCalledTimes(1);
    expect(errorHandler.mock.calls[0][0]).toMatchObject({
      tag: "beta-island",
      attempt: 2,
    });
  });

  it("unsubscribe cleanup removes listeners", () => {
    const surface = createRuntimeSurface({
      target: document,
      console: { log: mock(() => {}), groupCollapsed: mock(() => {}), groupEnd: mock(() => {}) },
    });
    const loadHandler = mock(() => {});
    const errorHandler = mock(() => {});

    const offLoad = trackCleanup(surface.onLoad(loadHandler));
    const offError = trackCleanup(surface.onError(errorHandler));
    offLoad();
    offError();

    surface.dispatchLoad({ tag: "alpha-island", duration: 12, attempt: 1 });
    surface.dispatchError({ tag: "beta-island", error: new Error("boom"), attempt: 2 });

    expect(loadHandler).not.toHaveBeenCalled();
    expect(errorHandler).not.toHaveBeenCalled();
  });

  it("creates a grouped logger when notes are buffered", () => {
    const log = mock(() => {});
    const groupCollapsed = mock(() => {});
    const groupEnd = mock(() => {});
    const surface = createRuntimeSurface({
      target: document,
      console: { log, groupCollapsed, groupEnd },
    });

    const logger = surface.createLogger("alpha-island", true);
    logger.note("waiting for client:visible");
    logger.note("waiting for client:interaction");
    logger.flush("triggered");

    expect(groupCollapsed).toHaveBeenCalledWith("[islands] <alpha-island> triggered");
    expect(log).toHaveBeenCalledWith("waiting for client:visible");
    expect(log).toHaveBeenCalledWith("waiting for client:interaction");
    expect(groupEnd).toHaveBeenCalledTimes(1);
  });

  it("creates a flat logger when no notes were buffered", () => {
    const log = mock(() => {});
    const groupCollapsed = mock(() => {});
    const groupEnd = mock(() => {});
    const surface = createRuntimeSurface({
      target: document,
      console: { log, groupCollapsed, groupEnd },
    });

    surface.createLogger("flat-island", true).flush("triggered");

    expect(log).toHaveBeenCalledWith("[islands]", "<flat-island> triggered");
    expect(groupCollapsed).not.toHaveBeenCalled();
    expect(groupEnd).not.toHaveBeenCalled();
  });

  it("begins and ends the ready log only when debug is enabled", () => {
    const log = mock(() => {});
    const groupCollapsed = mock(() => {});
    const groupEnd = mock(() => {});
    const surface = createRuntimeSurface({
      target: document,
      console: { log, groupCollapsed, groupEnd },
    });

    const endReadyLog = surface.beginReadyLog(2, true);
    expect(groupCollapsed).toHaveBeenCalledWith("[islands] ready — 2 island(s)");
    endReadyLog();
    expect(groupEnd).toHaveBeenCalledTimes(1);

    groupCollapsed.mockClear();
    groupEnd.mockClear();
    surface.beginReadyLog(2, false)();
    expect(groupCollapsed).not.toHaveBeenCalled();
    expect(groupEnd).not.toHaveBeenCalled();
  });
});
