import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  createCleanupQueue,
  createRuntimeHarness,
  flush,
  mockIntersectionObserver,
} from "./harness";

describe("test harness", () => {
  const cleanups = createCleanupQueue();

  afterEach(() => {
    cleanups.cleanup({ resetDom: true });
  });

  it("removes tracked document listeners during cleanup", () => {
    const handler = mock((_event: Event) => {});
    cleanups.listen(document, "islands:test", handler as EventListener);

    document.dispatchEvent(new CustomEvent("islands:test"));
    expect(handler).toHaveBeenCalledTimes(1);

    cleanups.cleanup({ resetDom: true });
    document.dispatchEvent(new CustomEvent("islands:test"));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("disconnects tracked runtimes during cleanup", async () => {
    const loader = mock(async () => {});
    const runtime = createRuntimeHarness(cleanups);
    runtime.revive({ "/islands/harness-idle.ts": loader });

    await flush();
    expect(loader).not.toHaveBeenCalled();

    cleanups.cleanup({ resetDom: true });
    document.body.innerHTML = "<harness-idle></harness-idle>";

    await flush();
    expect(loader).not.toHaveBeenCalled();
  });

  it("restores mocked browser globals through tracked cleanup", () => {
    const original = globalThis.IntersectionObserver;

    cleanups.track(
      mockIntersectionObserver(
        class {
          observe() {}
          disconnect() {}
        } as unknown as typeof IntersectionObserver,
      ),
    );

    expect(globalThis.IntersectionObserver).not.toBe(original);

    cleanups.cleanup();

    expect(globalThis.IntersectionObserver).toBe(original);
  });
});
