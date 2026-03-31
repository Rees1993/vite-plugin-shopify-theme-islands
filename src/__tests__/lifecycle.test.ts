/// <reference lib="dom" />
import { describe, expect, it, mock, afterEach } from "bun:test";
import { createIslandLifecycleCoordinator } from "../lifecycle";
import { createCleanupQueue, flush, mockMutationObserver } from "./harness";

describe("lifecycle", () => {
  const cleanups = createCleanupQueue();

  afterEach(() => {
    cleanups.cleanup({ resetDom: true });
  });

  it("walks initial DOM, defers children behind queued parents, and rewinds them after success", async () => {
    const lifecycle = createIslandLifecycleCoordinator({ retries: 0, retryDelay: 100 });
    const tags: string[] = [];
    const islandMap = new Map<string, () => Promise<unknown>>([
      ["parent-island", mock(async () => {})],
      ["child-island", mock(async () => {})],
    ]);

    document.body.innerHTML = `
      <parent-island>
        <child-island></child-island>
      </parent-island>
    `;

    const parent = document.querySelector("parent-island") as HTMLElement;
    const child = document.querySelector("child-island") as HTMLElement;

    cleanups.track(
      lifecycle.start({
        getRoot: () => document.body,
        islandMap,
        onActivate(tagName) {
          tags.push(tagName);
        },
      }).disconnect,
    );

    expect(tags).toEqual(["parent-island"]);
    expect(lifecycle.isQueued("parent-island")).toBe(true);
    expect(lifecycle.isQueued("child-island")).toBe(false);

    lifecycle.walk(child);
    expect(tags).toEqual(["parent-island"]);

    lifecycle.settleSuccess("parent-island");
    lifecycle.walk(parent);
    expect(tags).toEqual(["parent-island", "child-island"]);
  });

  it("activates islands added after start and stops after disconnect", async () => {
    const lifecycle = createIslandLifecycleCoordinator({ retries: 0, retryDelay: 100 });
    const tags: string[] = [];
    const islandMap = new Map<string, () => Promise<unknown>>([
      ["dynamic-island", mock(async () => {})],
    ]);
    let moCallback: MutationCallback | undefined;
    cleanups.track(
      mockMutationObserver(
        class {
          constructor(cb: MutationCallback) {
            moCallback = cb;
          }
          observe() {}
          disconnect() {}
        } as unknown as typeof MutationObserver,
      ),
    );

    document.body.innerHTML = "<root-shell></root-shell>";

    const disconnect = cleanups.track(
      lifecycle.start({
        getRoot: () => document.body,
        islandMap,
        onActivate(tagName) {
          tags.push(tagName);
        },
      }).disconnect,
    );

    const el = document.createElement("dynamic-island");
    document.body.appendChild(el);
    moCallback?.([{ addedNodes: [el] } as unknown as MutationRecord], {} as MutationObserver);
    await flush();
    expect(tags).toEqual(["dynamic-island"]);

    disconnect();
    const later = document.createElement("dynamic-island");
    document.body.appendChild(later);
    moCallback?.([{ addedNodes: [later] } as unknown as MutationRecord], {} as MutationObserver);
    await flush();
    expect(tags).toEqual(["dynamic-island"]);
  });

  it("resolves the root lazily and skips startup callbacks when disconnected before init", () => {
    const lifecycle = createIslandLifecycleCoordinator({ retries: 0, retryDelay: 100 });
    let domReadyHandler: (() => void) | undefined;
    let readyState = "loading";
    const rootCalls: string[] = [];
    const beforeWalk = mock(() => {});
    const afterWalk = mock(() => {});
    const originalReadyState = Object.getOwnPropertyDescriptor(document, "readyState");
    const originalAdd = document.addEventListener.bind(document);
    const originalRemove = document.removeEventListener.bind(document);
    const addSpy = mock((type: string, handler: EventListenerOrEventListenerObject) => {
      if (type === "DOMContentLoaded") domReadyHandler = handler as () => void;
    });
    const removeSpy = mock(() => {});

    Object.defineProperty(document, "readyState", {
      configurable: true,
      get: () => readyState,
    });
    document.addEventListener = addSpy as typeof document.addEventListener;
    document.removeEventListener = removeSpy as typeof document.removeEventListener;

    try {
      const disconnect = cleanups.track(
        lifecycle.start({
          getRoot: () => {
            rootCalls.push("called");
            return document.body;
          },
          islandMap: new Map(),
          onActivate() {},
          onBeforeInitialWalk: beforeWalk,
          onInitialWalkComplete: afterWalk,
        }).disconnect,
      );

      expect(rootCalls).toEqual([]);
      expect(beforeWalk).not.toHaveBeenCalled();
      expect(afterWalk).not.toHaveBeenCalled();

      disconnect();
      domReadyHandler?.();

      expect(rootCalls).toEqual([]);
      expect(beforeWalk).not.toHaveBeenCalled();
      expect(afterWalk).not.toHaveBeenCalled();

      readyState = "interactive";
      cleanups.track(
        lifecycle.start({
          getRoot: () => {
            rootCalls.push("called");
            return document.body;
          },
          islandMap: new Map(),
          onActivate() {},
          onBeforeInitialWalk: beforeWalk,
          onInitialWalkComplete: afterWalk,
        }).disconnect,
      );

      expect(rootCalls).toEqual(["called"]);
      expect(beforeWalk).toHaveBeenCalledTimes(1);
      expect(afterWalk).toHaveBeenCalledTimes(1);
    } finally {
      if (originalReadyState) {
        Object.defineProperty(document, "readyState", originalReadyState);
      }
      document.addEventListener = originalAdd;
      document.removeEventListener = originalRemove;
    }
  });

  it("schedules retry callbacks with exponential backoff from the lifecycle boundary", () => {
    type FakeTimer = { fn: () => void; delay: number; cleared: boolean };

    const timers: FakeTimer[] = [];
    const lifecycle = createIslandLifecycleCoordinator({
      retries: 2,
      retryDelay: 100,
      platform: {
        setTimeout(fn, delay) {
          const timer: FakeTimer = { fn, delay, cleared: false };
          timers.push(timer);
          return timer as unknown as ReturnType<typeof setTimeout>;
        },
        clearTimeout(timer) {
          (timer as unknown as FakeTimer).cleared = true;
        },
      },
    });
    const retry = mock(() => {});

    const first = lifecycle.settleFailure("retry-island", retry);
    const second = lifecycle.settleFailure("retry-island", retry);

    expect(first).toEqual({ attempt: 1, willRetry: true });
    expect(second).toEqual({ attempt: 2, willRetry: true });
    expect(timers.map((timer) => timer.delay)).toEqual([100, 200]);

    timers[0].fn();
    timers[1].fn();
    expect(retry).toHaveBeenCalledTimes(2);
  });

  it("clears pending retry timers on success and targeted clear", () => {
    type FakeTimer = { fn: () => void; delay: number; cleared: boolean };

    const timers: FakeTimer[] = [];
    const lifecycle = createIslandLifecycleCoordinator({
      retries: 2,
      retryDelay: 50,
      platform: {
        setTimeout(fn, delay) {
          const timer: FakeTimer = { fn, delay, cleared: false };
          timers.push(timer);
          return timer as unknown as ReturnType<typeof setTimeout>;
        },
        clearTimeout(timer) {
          (timer as unknown as FakeTimer).cleared = true;
        },
      },
    });

    lifecycle.settleFailure(
      "alpha-island",
      mock(() => {}),
    );
    lifecycle.settleFailure(
      "beta-island",
      mock(() => {}),
    );
    expect(timers).toHaveLength(2);

    const attempt = lifecycle.settleSuccess("alpha-island");
    expect(attempt).toBe(2);
    expect(timers[0].cleared).toBe(true);

    lifecycle.clear(["beta-island"]);
    expect(timers[1].cleared).toBe(true);
  });

  it("can clear all pending retries at once", () => {
    type FakeTimer = { fn: () => void; delay: number; cleared: boolean };

    const timers: FakeTimer[] = [];
    const lifecycle = createIslandLifecycleCoordinator({
      retries: 2,
      retryDelay: 50,
      platform: {
        setTimeout(fn, delay) {
          const timer: FakeTimer = { fn, delay, cleared: false };
          timers.push(timer);
          return timer as unknown as ReturnType<typeof setTimeout>;
        },
        clearTimeout(timer) {
          (timer as unknown as FakeTimer).cleared = true;
        },
      },
    });

    lifecycle.settleFailure(
      "alpha-island",
      mock(() => {}),
    );
    lifecycle.settleFailure(
      "beta-island",
      mock(() => {}),
    );
    lifecycle.clear();

    expect(timers.every((timer) => timer.cleared)).toBe(true);
  });
});
