/// <reference lib="dom" />
import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { revive } from "../runtime";

// Flush microtasks + a short timer tick so async directive chains resolve
const flush = () => new Promise<void>((r) => setTimeout(r, 50));

describe("revive", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  describe("islandMap", () => {
    it("warns and skips non-hyphenated filenames", () => {
      const spy = spyOn(console, "warn");
      revive({ "/islands/myisland.ts": async () => {} });
      expect(spy).toHaveBeenCalledWith(expect.stringContaining("must contain a hyphen"));
      spy.mockRestore();
    });

    it("loads an island that matches the tag name", async () => {
      const loader = mock(async () => {});
      document.body.innerHTML = "<my-island></my-island>";
      revive({ "/islands/my-island.ts": loader });
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("first matching loader wins for duplicate tag names", async () => {
      const first = mock(async () => {});
      const second = mock(async () => {});
      document.body.innerHTML = "<my-island></my-island>";
      revive({
        "/islands/my-island.ts": first,
        "/components/my-island.ts": second,
      });
      await flush();
      expect(first).toHaveBeenCalledTimes(1);
      expect(second).not.toHaveBeenCalled();
    });
  });

  describe("queued set", () => {
    it("prevents loading the same tag twice even when multiple elements exist", async () => {
      const loader = mock(async () => {});
      document.body.innerHTML = "<my-counter></my-counter><my-counter></my-counter>";
      revive({ "/islands/my-counter.ts": loader });
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
    });
  });

  describe("client:idle", () => {
    let originalRIC: unknown;

    beforeEach(() => {
      originalRIC = (window as any).requestIdleCallback;
    });

    afterEach(() => {
      if (originalRIC === undefined) delete (window as any).requestIdleCallback;
      else (window as any).requestIdleCallback = originalRIC;
    });

    it("calls loader after idle via setTimeout fallback when requestIdleCallback is absent", async () => {
      // happy-dom does not implement requestIdleCallback, so the fallback (setTimeout) is used
      const loader = mock(async () => {});
      document.body.innerHTML = "<idle-widget client:idle></idle-widget>";
      revive({ "/islands/idle-widget.ts": loader }, { directives: { idle: { timeout: 20 } } });
      await new Promise<void>((r) => setTimeout(r, 50));
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("respects custom idle timeout", async () => {
      const loader = mock(async () => {});
      document.body.innerHTML = "<idle-fast client:idle></idle-fast>";
      revive({ "/islands/idle-fast.ts": loader }, { directives: { idle: { timeout: 20 } } });
      await new Promise<void>((r) => setTimeout(r, 50));
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("calls loader via requestIdleCallback when available", async () => {
      let cb!: (opts?: { timeout: number }) => void;
      (window as any).requestIdleCallback = (fn: () => void) => { cb = fn; };

      const loader = mock(async () => {});
      document.body.innerHTML = "<idle-box client:idle></idle-box>";
      revive({ "/islands/idle-box.ts": loader });

      expect(loader).not.toHaveBeenCalled();
      cb();
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("passes timeout option to requestIdleCallback", () => {
      let capturedOpts: unknown;
      (window as any).requestIdleCallback = (_fn: () => void, opts: unknown) => { capturedOpts = opts; };

      document.body.innerHTML = "<idle-opts client:idle></idle-opts>";
      revive({ "/islands/idle-opts.ts": mock(async () => {}) }, { directives: { idle: { timeout: 300 } } });

      expect(capturedOpts).toEqual({ timeout: 300 });
    });
  });

  describe("client:visible", () => {
    let trigger!: (entries: Partial<IntersectionObserverEntry>[]) => void;
    let ioOptions: IntersectionObserverInit | undefined;
    let originalIO: unknown;

    beforeEach(() => {
      originalIO = (globalThis as any).IntersectionObserver;
      (globalThis as any).IntersectionObserver = function (this: any, cb: any, opts?: IntersectionObserverInit) {
        trigger = cb;
        ioOptions = opts;
        this.observe = () => {};
        this.disconnect = () => {};
      };
    });

    afterEach(() => {
      (globalThis as any).IntersectionObserver = originalIO;
    });

    it("does not load until the IntersectionObserver callback fires", async () => {
      const loader = mock(async () => {});
      document.body.innerHTML = "<lazy-section client:visible></lazy-section>";
      revive({ "/islands/lazy-section.ts": loader });

      expect(loader).not.toHaveBeenCalled();
      trigger([{ isIntersecting: true }]);
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("does not load when IntersectionObserver fires with isIntersecting false", async () => {
      const loader = mock(async () => {});
      document.body.innerHTML = "<off-screen client:visible></off-screen>";
      revive({ "/islands/off-screen.ts": loader });

      trigger([{ isIntersecting: false }]);
      await flush();
      expect(loader).not.toHaveBeenCalled();
    });

    it("passes 200px rootMargin to IntersectionObserver by default", () => {
      document.body.innerHTML = "<margin-default client:visible></margin-default>";
      revive({ "/islands/margin-default.ts": mock(async () => {}) });
      expect(ioOptions?.rootMargin).toBe("200px");
    });

    it("passes custom rootMargin to IntersectionObserver", () => {
      document.body.innerHTML = "<margin-custom client:visible></margin-custom>";
      revive({ "/islands/margin-custom.ts": mock(async () => {}) }, { directives: { visible: { rootMargin: "0px" } } });
      expect(ioOptions?.rootMargin).toBe("0px");
    });

    it("passes custom threshold to IntersectionObserver", () => {
      document.body.innerHTML = "<threshold-test client:visible></threshold-test>";
      revive({ "/islands/threshold-test.ts": mock(async () => {}) }, { directives: { visible: { threshold: 0.5 } } });
      expect(ioOptions?.threshold).toBe(0.5);
    });

    it("does not load when element is removed before becoming visible", async () => {
      const loader = mock(async () => {});
      const el = document.createElement("ghost-island");
      el.setAttribute("client:visible", "");
      document.body.appendChild(el);
      revive({ "/islands/ghost-island.ts": loader });

      document.body.removeChild(el);
      await flush();
      expect(loader).not.toHaveBeenCalled();
    });
  });

  describe("client:media", () => {
    let originalMatchMedia: typeof window.matchMedia;

    beforeEach(() => {
      originalMatchMedia = window.matchMedia;
    });

    afterEach(() => {
      (window as any).matchMedia = originalMatchMedia;
    });

    it("loads immediately when the media query already matches", async () => {
      (window as any).matchMedia = () => ({ matches: true, addEventListener: () => {} });

      const loader = mock(async () => {});
      document.body.innerHTML = '<media-panel client:media="(max-width: 768px)"></media-panel>';
      revive({ "/islands/media-panel.ts": loader });
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("waits for a change event when the query does not initially match", async () => {
      let changeHandler!: () => void;
      (window as any).matchMedia = () => ({
        matches: false,
        addEventListener: (_: string, h: () => void) => { changeHandler = h; },
      });

      const loader = mock(async () => {});
      document.body.innerHTML = '<media-panel client:media="(max-width: 768px)"></media-panel>';
      revive({ "/islands/media-panel.ts": loader });
      await flush();
      expect(loader).not.toHaveBeenCalled();

      changeHandler();
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
    });
  });

  describe("MutationObserver", () => {
    it("activates islands added to the DOM after init", async () => {
      const loader = mock(async () => {});
      revive({ "/islands/late-arrival.ts": loader });

      const el = document.createElement("late-arrival");
      document.body.appendChild(el);
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
    });
  });
});
