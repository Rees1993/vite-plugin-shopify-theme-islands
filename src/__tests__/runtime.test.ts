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
    it("calls loader after idle via setTimeout fallback when requestIdleCallback is absent", async () => {
      // happy-dom does not implement requestIdleCallback, so the fallback (setTimeout 200ms) is used
      const loader = mock(async () => {});
      document.body.innerHTML = "<idle-widget client:idle></idle-widget>";
      revive({ "/islands/idle-widget.ts": loader });
      await new Promise<void>((r) => setTimeout(r, 250)); // wait past the 200ms fallback
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("calls loader via requestIdleCallback when available", async () => {
      let cb!: () => void;
      // With GlobalRegistrator, window === globalThis
      (window as any).requestIdleCallback = (fn: () => void) => { cb = fn; };

      const loader = mock(async () => {});
      document.body.innerHTML = "<idle-box client:idle></idle-box>";
      revive({ "/islands/idle-box.ts": loader });

      expect(loader).not.toHaveBeenCalled();
      cb();
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);

      delete (window as any).requestIdleCallback;
    });
  });

  describe("client:visible", () => {
    let trigger!: (entries: Partial<IntersectionObserverEntry>[]) => void;
    let originalIO: unknown;

    beforeEach(() => {
      originalIO = (globalThis as any).IntersectionObserver;
      (globalThis as any).IntersectionObserver = function (this: any, cb: any) {
        trigger = cb;
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
