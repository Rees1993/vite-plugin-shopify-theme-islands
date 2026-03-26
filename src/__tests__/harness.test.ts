import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  createCleanupQueue,
  createRuntimeHarness,
  createRuntimeSuite,
  installIdleDriver,
  installMediaDriver,
  installMutationDriver,
  installTimerDriver,
  installVisibilityDriver,
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

  it("removes tracked custom event listeners during cleanup", () => {
    const handler = mock((event: CustomEvent<{ tag: string }>) => event.detail.tag);
    cleanups.listenCustomEvent<{ tag: string }>(document, "islands:load", handler);

    document.dispatchEvent(new CustomEvent("islands:load", { detail: { tag: "alpha" } }));
    expect(handler).toHaveBeenCalledTimes(1);

    cleanups.cleanup({ resetDom: true });
    document.dispatchEvent(new CustomEvent("islands:load", { detail: { tag: "beta" } }));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("disconnects tracked runtimes during cleanup", async () => {
    const loader = mock(async () => {});
    const runtime = createRuntimeHarness(cleanups);
    runtime.start(runtime.payload({ "/islands/harness-idle.ts": loader }));

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

  it("builds a payload and starts a tracked runtime with the 2.0 contract", async () => {
    const loader = mock(async () => {});
    document.body.innerHTML = "<payload-island></payload-island>";

    const runtime = createRuntimeHarness(cleanups);
    const started = runtime.start(
      runtime.payload(
        { "/islands/payload-island.ts": loader },
        { directives: { defer: { delay: 0 } } },
      ),
    );

    await flush();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(started.disconnect).toEqual(expect.any(Function));
  });

  it("drives idle callbacks explicitly", () => {
    const idle = installIdleDriver(cleanups);
    let called = 0;

    window.requestIdleCallback?.(
      () => {
        called++;
      },
      { timeout: 25 },
    );

    expect(called).toBe(0);
    expect(idle.lastOptions).toEqual({ timeout: 25 });
    idle.flush();
    expect(called).toBe(1);
  });

  it("drives idle callbacks explicitly without options", () => {
    const idle = installIdleDriver(cleanups);
    let called = 0;

    window.requestIdleCallback?.(() => {
      called++;
    });

    expect(called).toBe(0);
    expect(idle.lastOptions).toBeUndefined();
    idle.flush();
    expect(called).toBe(1);
  });

  it("drives visibility callbacks explicitly", () => {
    const visibility = installVisibilityDriver(cleanups);
    let observed = false;
    let visible = false;

    const observer = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? false;
    });
    const target = document.createElement("visible-box");
    observer.observe(target);
    observed = true;

    expect(observed).toBe(true);
    expect(visibility.options?.rootMargin).toBeUndefined();

    visibility.trigger(target, true);
    expect(visible).toBe(true);
    expect(visibility.disconnect).not.toHaveBeenCalled();
  });

  it("drives media query listeners explicitly", () => {
    const media = installMediaDriver(cleanups);
    let matched = false;
    const query = "(max-width: 768px)";

    const mql = window.matchMedia(query);
    mql.addEventListener("change", (event) => {
      matched = event.matches;
    });

    media.dispatchChange(query, true);
    expect(matched).toBe(true);
  });

  it("primes media query match state before listeners fire", () => {
    const media = installMediaDriver(cleanups);
    const query = "(prefers-reduced-motion: reduce)";

    media.setMatches(query, true);

    expect(window.matchMedia(query).matches).toBe(true);
  });

  it("advances scheduled timers explicitly", () => {
    const timers = installTimerDriver(cleanups);
    const callback = mock(() => {});

    setTimeout(callback, 25);
    expect(timers.pendingCount()).toBe(1);

    timers.advance(24);
    expect(callback).not.toHaveBeenCalled();

    timers.advance(1);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(timers.pendingCount()).toBe(0);
  });

  it("drives mutation callbacks explicitly", () => {
    const mutations = installMutationDriver(cleanups);
    const callback = mock((_records: MutationRecord[]) => {});
    const observer = new MutationObserver((records) => {
      callback(records);
    });

    observer.observe(document.body, { childList: true });

    const node = document.createElement("late-island");
    mutations.add(node);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]?.[0][0]?.addedNodes[0]).toBe(node);
  });

  it("resets runtime suite state without repeating per-file boilerplate", async () => {
    const suite = createRuntimeSuite();
    suite.reset();

    const loader = mock(async () => {});
    document.body.innerHTML = "<suite-island></suite-island>";
    suite.runtime.start(suite.runtime.payload({ "/islands/suite-island.ts": loader }));

    await flush();
    expect(loader).toHaveBeenCalledTimes(1);

    suite.cleanup();
    expect(document.body.innerHTML).toBe("");
  });
});
