/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { ReviveOptions } from "../contract";
import {
  createRuntimeSuite,
  flush,
  installIdleDriver,
  installMediaDriver,
  installMutationDriver,
  installTimerDriver,
  installVisibilityDriver,
  mockRequestIdleCallback,
} from "./harness";

const suite = createRuntimeSuite();
let cleanups = suite.cleanups;
let runtimeHarness = suite.runtime;

const IDLE_DEADLINE: IdleDeadline = { timeRemaining: () => 0, didTimeout: false };

function payload(islands: Record<string, () => Promise<unknown>>, options?: ReviveOptions) {
  return suite.runtime.payload(islands, options);
}

describe("runtime built-in directives", () => {
  beforeEach(() => {
    suite.reset();
    cleanups = suite.cleanups;
    runtimeHarness = suite.runtime;
  });

  afterEach(() => {
    suite.cleanup();
  });

  describe("client:idle", () => {
    it("calls loader after idle via setTimeout fallback when requestIdleCallback is absent", async () => {
      const timers = installTimerDriver(suite.cleanups);
      suite.cleanups.track(mockRequestIdleCallback());
      const loader = mock(async () => {});

      document.body.innerHTML = "<idle-widget client:idle></idle-widget>";
      suite.runtime.start(
        payload({ "/islands/idle-widget.ts": loader }, { directives: { idle: { timeout: 20 } } }),
      );

      timers.advance(19);
      await flush(0);
      expect(loader).not.toHaveBeenCalled();

      timers.advance(1);
      await flush(0);
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("calls loader via requestIdleCallback when available", async () => {
      const idle = installIdleDriver(suite.cleanups);
      const loader = mock(async () => {});

      document.body.innerHTML = "<idle-box client:idle></idle-box>";
      suite.runtime.start(payload({ "/islands/idle-box.ts": loader }));

      expect(loader).not.toHaveBeenCalled();
      idle.flush(IDLE_DEADLINE);
      await flush(0);
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("passes timeout option to requestIdleCallback", () => {
      const idle = installIdleDriver(suite.cleanups);

      document.body.innerHTML = "<idle-opts client:idle></idle-opts>";
      suite.runtime.start(
        payload(
          { "/islands/idle-opts.ts": mock(async () => {}) },
          { directives: { idle: { timeout: 300 } } },
        ),
      );

      expect(idle.lastOptions).toEqual({ timeout: 300 });
    });

    it("attribute value overrides global timeout per element", async () => {
      const timers = installTimerDriver(suite.cleanups);
      suite.cleanups.track(mockRequestIdleCallback());
      const loader = mock(async () => {});

      document.body.innerHTML = '<idle-per-el client:idle="20"></idle-per-el>';
      suite.runtime.start(
        payload({ "/islands/idle-per-el.ts": loader }, { directives: { idle: { timeout: 5000 } } }),
      );

      timers.advance(19);
      await flush(0);
      expect(loader).not.toHaveBeenCalled();

      timers.advance(1);
      await flush(0);
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("empty attribute value falls back to global timeout", async () => {
      const timers = installTimerDriver(suite.cleanups);
      suite.cleanups.track(mockRequestIdleCallback());
      const loader = mock(async () => {});

      document.body.innerHTML = "<idle-per-el-default client:idle></idle-per-el-default>";
      suite.runtime.start(
        payload(
          { "/islands/idle-per-el-default.ts": loader },
          { directives: { idle: { timeout: 20 } } },
        ),
      );

      timers.advance(19);
      await flush(0);
      expect(loader).not.toHaveBeenCalled();

      timers.advance(1);
      await flush(0);
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("falls back to configured timeout and warns when the attribute value is not a strict integer", async () => {
      const timers = installTimerDriver(suite.cleanups);
      suite.cleanups.track(mockRequestIdleCallback());
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      const loader = mock(async () => {});

      document.body.innerHTML = '<idle-invalid client:idle="20ms"></idle-invalid>';
      suite.runtime.start(
        payload(
          { "/islands/idle-invalid.ts": loader },
          { directives: { idle: { timeout: 5000 } } },
        ),
      );

      timers.advance(80);
      await flush(0);

      expect(loader).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("invalid client:idle value"));

      warnSpy.mockRestore();
    });
  });

  describe("client:visible", () => {
    it("does not load until the IntersectionObserver callback fires", async () => {
      const visibility = installVisibilityDriver(cleanups);
      const loader = mock(async () => {});

      document.body.innerHTML = "<lazy-section client:visible></lazy-section>";
      runtimeHarness.start(payload({ "/islands/lazy-section.ts": loader }));

      expect(loader).not.toHaveBeenCalled();
      visibility.trigger(document.querySelector("lazy-section")!, true);
      await flush(0);
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("does not load when IntersectionObserver fires with isIntersecting false", async () => {
      const visibility = installVisibilityDriver(cleanups);
      const loader = mock(async () => {});

      document.body.innerHTML = "<off-screen client:visible></off-screen>";
      runtimeHarness.start(payload({ "/islands/off-screen.ts": loader }));

      visibility.trigger(document.querySelector("off-screen")!, false);
      await flush(0);
      expect(loader).not.toHaveBeenCalled();
    });

    it("passes 200px rootMargin to IntersectionObserver by default", () => {
      const visibility = installVisibilityDriver(cleanups);

      document.body.innerHTML = "<margin-default client:visible></margin-default>";
      runtimeHarness.start(payload({ "/islands/margin-default.ts": mock(async () => {}) }));

      expect(visibility.options?.rootMargin).toBe("200px");
    });

    it("passes custom rootMargin to IntersectionObserver", () => {
      const visibility = installVisibilityDriver(cleanups);

      document.body.innerHTML = "<margin-custom client:visible></margin-custom>";
      runtimeHarness.start(
        payload(
          { "/islands/margin-custom.ts": mock(async () => {}) },
          { directives: { visible: { rootMargin: "0px" } } },
        ),
      );

      expect(visibility.options?.rootMargin).toBe("0px");
    });

    it("passes custom threshold to IntersectionObserver", () => {
      const visibility = installVisibilityDriver(cleanups);

      document.body.innerHTML = "<threshold-test client:visible></threshold-test>";
      runtimeHarness.start(
        payload(
          { "/islands/threshold-test.ts": mock(async () => {}) },
          { directives: { visible: { threshold: 0.5 } } },
        ),
      );

      expect(visibility.options?.threshold).toBe(0.5);
    });

    it("does not load when element is removed before becoming visible", async () => {
      const loader = mock(async () => {});
      const el = document.createElement("ghost-island");
      el.setAttribute("client:visible", "");
      document.body.appendChild(el);

      runtimeHarness.start(payload({ "/islands/ghost-island.ts": loader }));

      document.body.removeChild(el);
      await flush(0);
      expect(loader).not.toHaveBeenCalled();
    });

    it("removes the visible cancellation watcher after visibility resolves", async () => {
      const visibility = installVisibilityDriver(cleanups);
      const mutations = installMutationDriver(cleanups);
      const loader = mock(async () => {});

      document.body.innerHTML = "<cleanup-visible client:visible></cleanup-visible>";
      runtimeHarness.start(payload({ "/islands/cleanup-visible.ts": loader }));

      const el = document.querySelector("cleanup-visible")!;
      visibility.trigger(el, true);
      await flush(0);
      expect(loader).toHaveBeenCalledTimes(1);
      expect(visibility.disconnect).toHaveBeenCalledTimes(1);

      document.body.removeChild(el);
      mutations.remove(el);
      await flush(0);
      expect(visibility.disconnect).toHaveBeenCalledTimes(1);
    });

    it("attribute value overrides global rootMargin per element", () => {
      const visibility = installVisibilityDriver(cleanups);

      document.body.innerHTML = '<vis-override client:visible="0px"></vis-override>';
      runtimeHarness.start(
        payload(
          { "/islands/vis-override.ts": mock(async () => {}) },
          { directives: { visible: { rootMargin: "200px" } } },
        ),
      );

      expect(visibility.options?.rootMargin).toBe("0px");
    });

    it("empty attribute value falls back to global rootMargin", () => {
      const visibility = installVisibilityDriver(cleanups);

      document.body.innerHTML = "<vis-fallback client:visible></vis-fallback>";
      runtimeHarness.start(
        payload(
          { "/islands/vis-fallback.ts": mock(async () => {}) },
          { directives: { visible: { rootMargin: "100px" } } },
        ),
      );

      expect(visibility.options?.rootMargin).toBe("100px");
    });
  });

  describe("client:media", () => {
    it("loads immediately when the media query already matches", async () => {
      const media = installMediaDriver(cleanups);
      const loader = mock(async () => {});
      const query = "(max-width: 768px)";
      media.setMatches(query, true);

      document.body.innerHTML = `<media-panel client:media="${query}"></media-panel>`;
      runtimeHarness.start(payload({ "/islands/media-panel.ts": loader }));

      await flush(0);
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("waits for a change event when the query does not initially match", async () => {
      const media = installMediaDriver(cleanups);
      const loader = mock(async () => {});
      const query = "(max-width: 768px)";

      document.body.innerHTML = `<media-panel client:media="${query}"></media-panel>`;
      runtimeHarness.start(payload({ "/islands/media-panel.ts": loader }));

      await flush(0);
      expect(loader).not.toHaveBeenCalled();

      media.dispatchChange(query, true);
      await flush(0);
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("does not load after subtree unobserve even if the media query later matches", async () => {
      const media = installMediaDriver(cleanups);
      const loader = mock(async () => {});
      const query = "(max-width: 768px)";

      document.body.innerHTML = `<div id="alpha"><media-panel client:media="${query}"></media-panel></div>`;
      const alphaRoot = document.getElementById("alpha") as HTMLElement;
      const runtime = runtimeHarness.start(payload({ "/islands/media-panel.ts": loader }));
      await flush(0);

      runtime.unobserve(alphaRoot);
      media.dispatchChange(query, true);
      await flush(0);

      expect(loader).not.toHaveBeenCalled();
    });

    it("warns and skips when client:media has an empty value", async () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      const loader = mock(async () => {});

      document.body.innerHTML = '<empty-media client:media=""></empty-media>';
      runtimeHarness.start(payload({ "/islands/empty-media.ts": loader }));

      await flush(0);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("has no value"));
      expect(loader).toHaveBeenCalledTimes(1);

      warnSpy.mockRestore();
    });
  });

  describe("client:defer", () => {
    it("loads after the specified delay", async () => {
      const timers = installTimerDriver(cleanups);
      const loader = mock(async () => {});

      document.body.innerHTML = '<defer-widget client:defer="20"></defer-widget>';
      runtimeHarness.start(payload({ "/islands/defer-widget.ts": loader }));

      timers.advance(19);
      await flush(0);
      expect(loader).not.toHaveBeenCalled();

      timers.advance(1);
      await flush(0);
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("does not load before the delay has elapsed", async () => {
      const timers = installTimerDriver(cleanups);
      const loader = mock(async () => {});

      document.body.innerHTML = '<defer-slow client:defer="500"></defer-slow>';
      runtimeHarness.start(payload({ "/islands/defer-slow.ts": loader }));

      timers.advance(50);
      await flush(0);
      expect(loader).not.toHaveBeenCalled();
    });

    it("uses configured fallback delay when attribute has no value", async () => {
      const timers = installTimerDriver(cleanups);
      const loader = mock(async () => {});

      document.body.innerHTML = "<defer-novalue client:defer></defer-novalue>";
      runtimeHarness.start(
        payload({ "/islands/defer-novalue.ts": loader }, { directives: { defer: { delay: 20 } } }),
      );

      timers.advance(20);
      await flush(0);
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("respects custom attribute name", async () => {
      const timers = installTimerDriver(cleanups);
      const loader = mock(async () => {});

      document.body.innerHTML = '<defer-custom data:defer="20"></defer-custom>';
      runtimeHarness.start(
        payload(
          { "/islands/defer-custom.ts": loader },
          { directives: { defer: { attribute: "data:defer" } } },
        ),
      );

      timers.advance(20);
      await flush(0);
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("falls back to configured delay and warns when attribute value is not a valid number", async () => {
      const timers = installTimerDriver(cleanups);
      const spy = spyOn(console, "warn").mockImplementation(() => {});
      const loader = mock(async () => {});

      document.body.innerHTML = '<defer-nan client:defer="abc"></defer-nan>';
      runtimeHarness.start(
        payload({ "/islands/defer-nan.ts": loader }, { directives: { defer: { delay: 20 } } }),
      );

      timers.advance(20);
      await flush(0);
      expect(loader).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(expect.stringContaining("invalid"));
      spy.mockRestore();
    });

    it("treats suffix junk as invalid and falls back to the configured delay", async () => {
      const timers = installTimerDriver(cleanups);
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      const loader = mock(async () => {});

      document.body.innerHTML = '<defer-strict client:defer="20ms"></defer-strict>';
      runtimeHarness.start(
        payload({ "/islands/defer-strict.ts": loader }, { directives: { defer: { delay: 5000 } } }),
      );

      timers.advance(80);
      await flush(0);

      expect(loader).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("invalid client:defer value"));

      warnSpy.mockRestore();
    });

    it('treats client:defer="0" as a zero ms delay, not the default', async () => {
      const timers = installTimerDriver(cleanups);
      const loader = mock(async () => {});

      document.body.innerHTML = '<defer-zero client:defer="0"></defer-zero>';
      runtimeHarness.start(payload({ "/islands/defer-zero.ts": loader }));

      timers.advance(0);
      await flush(0);
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("waits for both defer and idle when combined", async () => {
      const timers = installTimerDriver(cleanups);
      const idle = installIdleDriver(cleanups);
      const loader = mock(async () => {});

      document.body.innerHTML = '<defer-combo client:defer="20" client:idle></defer-combo>';
      runtimeHarness.start(
        payload({ "/islands/defer-combo.ts": loader }, { directives: { idle: { timeout: 20 } } }),
      );

      idle.flush(IDLE_DEADLINE);
      await flush(0);
      expect(loader).not.toHaveBeenCalled();

      timers.advance(20);
      await flush(0);
      expect(loader).toHaveBeenCalledTimes(1);
    });
  });
});
