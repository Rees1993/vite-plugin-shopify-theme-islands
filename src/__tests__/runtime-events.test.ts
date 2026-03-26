/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { onIslandError, onIslandLoad } from "../events";
import type { ClientDirective } from "../index";
import { createCleanupQueue, createRuntimeHarness, flush, installTimerDriver } from "./harness";

let cleanups = createCleanupQueue();
let runtimeHarness = createRuntimeHarness(cleanups);

async function advanceRetryDelay(timers: ReturnType<typeof installTimerDriver>, ms: number) {
  await flush(0);
  timers.advance(ms);
  await flush(0);
}

describe("runtime events and retries", () => {
  beforeEach(() => {
    cleanups = createCleanupQueue();
    runtimeHarness = createRuntimeHarness(cleanups);
    document.body.innerHTML = "";
  });

  afterEach(() => {
    cleanups.cleanup({ resetDom: true });
  });

  describe("retries", () => {
    it("retries specified number of times before succeeding", async () => {
      const timers = installTimerDriver(cleanups);
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});
      let callCount = 0;
      const loader = mock(async () => {
        callCount++;
        if (callCount < 3) throw new Error("network error");
      });

      document.body.innerHTML = "<retry-success></retry-success>";
      runtimeHarness.start(
        runtimeHarness.payload(
          { "/islands/retry-success.ts": loader },
          { retry: { retries: 2, delay: 10 } },
        ),
      );

      await advanceRetryDelay(timers, 10);
      await advanceRetryDelay(timers, 20);

      expect(loader).toHaveBeenCalledTimes(3);
      errorSpy.mockRestore();
    });

    it("exhausting retries clears queued allowing manual re-insertion", async () => {
      const timers = installTimerDriver(cleanups);
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});
      const loader = mock(async () => {
        throw new Error("always fails");
      });

      document.body.innerHTML = "<retry-exhaust></retry-exhaust>";
      runtimeHarness.start(
        runtimeHarness.payload(
          { "/islands/retry-exhaust.ts": loader },
          { retry: { retries: 1, delay: 10 } },
        ),
      );

      await advanceRetryDelay(timers, 10);
      expect(loader).toHaveBeenCalledTimes(2);

      document.body.appendChild(document.createElement("retry-exhaust"));
      await flush(0);
      await advanceRetryDelay(timers, 10);
      expect(loader).toHaveBeenCalledTimes(4);

      errorSpy.mockRestore();
    });

    it("islands:error fires on each retry attempt", async () => {
      const timers = installTimerDriver(cleanups);
      const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      const handler = mock((event: CustomEvent) => event);
      cleanups.listen(document, "islands:error", handler as unknown as EventListener);

      const loader = mock(() => Promise.reject(new Error("fail")));
      document.body.innerHTML = "<retry-ev></retry-ev>";
      runtimeHarness.start(
        runtimeHarness.payload(
          { "/islands/retry-ev.ts": loader },
          { retry: { retries: 2, delay: 10 } },
        ),
      );

      await advanceRetryDelay(timers, 10);
      await advanceRetryDelay(timers, 20);

      expect(handler).toHaveBeenCalledTimes(3);
      expect(handler.mock.calls[0]?.[0].detail).toMatchObject({ tag: "retry-ev", attempt: 1 });
      expect(handler.mock.calls[1]?.[0].detail).toMatchObject({ tag: "retry-ev", attempt: 2 });
      expect(handler.mock.calls[2]?.[0].detail).toMatchObject({ tag: "retry-ev", attempt: 3 });

      consoleSpy.mockRestore();
    });

    it("islands:load detail.attempt is 2 when first attempt fails and retry succeeds", async () => {
      const timers = installTimerDriver(cleanups);
      const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      const loadHandler = mock((event: CustomEvent) => event);
      cleanups.listen(document, "islands:load", loadHandler as unknown as EventListener);

      let callCount = 0;
      const loader = mock(async () => {
        callCount++;
        if (callCount === 1) throw new Error("first attempt fails");
      });

      document.body.innerHTML = "<retry-attempt-load></retry-attempt-load>";
      runtimeHarness.start(
        runtimeHarness.payload(
          { "/islands/retry-attempt-load.ts": loader },
          { retry: { retries: 1, delay: 10 } },
        ),
      );

      await advanceRetryDelay(timers, 10);

      expect(loadHandler).toHaveBeenCalledTimes(1);
      expect(loadHandler.mock.calls[0]?.[0].detail).toMatchObject({
        tag: "retry-attempt-load",
        attempt: 2,
      });

      consoleSpy.mockRestore();
    });

    it("retries: 0 (default) does not auto-retry — existing failure clears queued immediately", async () => {
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});
      const loader = mock(async () => {
        throw new Error("fail");
      });

      document.body.innerHTML = "<no-retry-default></no-retry-default>";
      runtimeHarness.start(runtimeHarness.payload({ "/islands/no-retry-default.ts": loader }));
      await flush();

      expect(loader).toHaveBeenCalledTimes(1);
      errorSpy.mockRestore();
    });
  });

  describe("DOM events", () => {
    it("islands:load fires after the module resolves", async () => {
      const handler = mock((event: CustomEvent) => event);
      cleanups.listen(document, "islands:load", handler as unknown as EventListener);

      document.body.innerHTML = "<load-ev></load-ev>";
      runtimeHarness.start(runtimeHarness.payload({ "/islands/load-ev.ts": mock(async () => {}) }));
      await flush();

      expect(handler).toHaveBeenCalledTimes(1);
      const detail = handler.mock.calls[0]?.[0].detail;
      expect(detail).toMatchObject({ tag: "load-ev", attempt: 1 });
      expect(typeof detail.duration).toBe("number");
      expect(detail.duration).toBeGreaterThanOrEqual(0);
    });

    it("islands:error fires on loader failure alongside console.error", async () => {
      const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      const handler = mock((event: CustomEvent) => event);
      cleanups.listen(document, "islands:error", handler as unknown as EventListener);
      const err = new Error("load failed");

      document.body.innerHTML = "<error-ev></error-ev>";
      runtimeHarness.start(
        runtimeHarness.payload({
          "/islands/error-ev.ts": mock(async () => {
            throw err;
          }),
        }),
      );

      await flush();
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0]?.[0].detail).toMatchObject({
        tag: "error-ev",
        error: err,
        attempt: 1,
      });
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("islands:error fires on custom directive failure", async () => {
      const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      const handler = mock((event: CustomEvent) => event);
      cleanups.listen(document, "islands:error", handler as unknown as EventListener);
      const err = new Error("directive failed");

      document.body.innerHTML = "<dir-err-ev client:on-click></dir-err-ev>";
      const customDirectives = new Map<string, ClientDirective>([
        [
          "client:on-click",
          mock(() => {
            throw err;
          }) as ClientDirective,
        ],
      ]);

      runtimeHarness.start(
        runtimeHarness.payload(
          { "/islands/dir-err-ev.ts": mock(async () => {}) },
          {},
          customDirectives,
        ),
      );

      await flush();
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0]?.[0].detail).toMatchObject({
        tag: "dir-err-ev",
        error: err,
        attempt: 1,
      });
      consoleSpy.mockRestore();
    });

    it("multiple independent listeners each receive the event", async () => {
      const handlerA = mock((event: CustomEvent) => event);
      const handlerB = mock((event: CustomEvent) => event);
      cleanups.listen(document, "islands:load", handlerA as unknown as EventListener);
      cleanups.listen(document, "islands:load", handlerB as unknown as EventListener);

      document.body.innerHTML = "<multi-listener></multi-listener>";
      runtimeHarness.start(
        runtimeHarness.payload({ "/islands/multi-listener.ts": mock(async () => {}) }),
      );

      await flush();
      expect(handlerA).toHaveBeenCalledTimes(1);
      expect(handlerB).toHaveBeenCalledTimes(1);
    });
  });

  describe("onIslandLoad / onIslandError helpers", () => {
    it("onIslandLoad receives detail directly and returns a cleanup function", async () => {
      const handler = mock((_detail: { tag: string; duration: number; attempt: number }) => {});
      cleanups.track(onIslandLoad(handler));

      document.body.innerHTML = "<helper-load></helper-load>";
      runtimeHarness.start(
        runtimeHarness.payload({ "/islands/helper-load.ts": mock(async () => {}) }),
      );
      await flush();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0]?.[0]).toMatchObject({ tag: "helper-load", attempt: 1 });
      expect(typeof handler.mock.calls[0]?.[0].duration).toBe("number");
    });

    it("onIslandLoad cleanup removes the listener", async () => {
      const handler = mock(() => {});
      const off = cleanups.track(onIslandLoad(handler));
      off();

      document.body.innerHTML = "<helper-off></helper-off>";
      runtimeHarness.start(
        runtimeHarness.payload({ "/islands/helper-off.ts": mock(async () => {}) }),
      );
      await flush();

      expect(handler).not.toHaveBeenCalled();
    });

    it("onIslandError receives detail directly and returns a cleanup function", async () => {
      const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      const handler = mock((_detail: { tag: string; error: unknown; attempt: number }) => {});
      const err = new Error("helper error");
      cleanups.track(onIslandError(handler));

      document.body.innerHTML = "<helper-err></helper-err>";
      runtimeHarness.start(
        runtimeHarness.payload({
          "/islands/helper-err.ts": mock(async () => {
            throw err;
          }),
        }),
      );

      await flush();
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0]?.[0]).toMatchObject({
        tag: "helper-err",
        error: err,
        attempt: 1,
      });
      consoleSpy.mockRestore();
    });

    it("onIslandError cleanup removes the listener", async () => {
      const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      const handler = mock(() => {});
      const off = cleanups.track(onIslandError(handler));
      off();

      document.body.innerHTML = "<helper-err-off></helper-err-off>";
      runtimeHarness.start(
        runtimeHarness.payload({
          "/islands/helper-err-off.ts": mock(async () => {
            throw new Error("should not reach handler");
          }),
        }),
      );

      await flush();
      expect(handler).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
