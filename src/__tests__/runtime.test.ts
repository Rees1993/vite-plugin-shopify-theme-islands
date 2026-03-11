/// <reference lib="dom" />
import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { revive } from "../runtime";
import type { ClientDirective } from "../index";

// Flush microtasks + a short timer tick so async directive chains resolve
const flush = (ms = 50) => new Promise<void>((r) => setTimeout(r, ms));

// A minimal IdleDeadline for triggering captured requestIdleCallback handlers
const IDLE_DEADLINE: IdleDeadline = { timeRemaining: () => 0, didTimeout: false };

// Helper to install a mock IntersectionObserver and return the real one for restoration
function mockIntersectionObserver(
  impl: new (cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) => Pick<IntersectionObserver, "observe" | "disconnect">
): typeof IntersectionObserver {
  const original = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = impl as unknown as typeof IntersectionObserver;
  return original;
}

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

    it("removes tag from queued on load failure, allowing retry on re-insertion", async () => {
      const spy = spyOn(console, "error");
      let moCallback: MutationObserverCallback | undefined;
      const OriginalMO = globalThis.MutationObserver;
      globalThis.MutationObserver = class {
        constructor(cb: MutationObserverCallback) { moCallback = cb; }
        observe() {}
        disconnect() {}
      } as unknown as typeof MutationObserver;

      let callCount = 0;
      const loader = mock(async () => {
        callCount++;
        if (callCount === 1) throw new Error("network error");
      });

      document.body.innerHTML = "<retry-island></retry-island>";
      revive({ "/islands/retry-island.ts": loader });
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(expect.stringContaining("Failed to load"), expect.any(Error));

      // Simulate re-insertion via MutationObserver — queued was cleared on failure
      const el2 = document.createElement("retry-island");
      moCallback!([{ addedNodes: [el2], removedNodes: [] } as unknown as MutationRecord], {} as MutationObserver);
      await flush();
      expect(loader).toHaveBeenCalledTimes(2);

      globalThis.MutationObserver = OriginalMO;
      spy.mockRestore();
    });

    it("does not retry on re-insertion when load succeeds", async () => {
      let moCallback: MutationObserverCallback | undefined;
      const OriginalMO = globalThis.MutationObserver;
      globalThis.MutationObserver = class {
        constructor(cb: MutationObserverCallback) { moCallback = cb; }
        observe() {}
        disconnect() {}
      } as unknown as typeof MutationObserver;

      const loader = mock(async () => {});

      document.body.innerHTML = "<no-retry-island></no-retry-island>";
      revive({ "/islands/no-retry-island.ts": loader });
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);

      // Simulate re-insertion — queued still has tagName, so load is blocked
      const el2 = document.createElement("no-retry-island");
      moCallback!([{ addedNodes: [el2], removedNodes: [] } as unknown as MutationRecord], {} as MutationObserver);
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);

      globalThis.MutationObserver = OriginalMO;
    });
  });

  describe("client:idle", () => {
    type RIC = typeof window.requestIdleCallback;
    let originalRIC: RIC | undefined;

    beforeEach(() => {
      // happy-dom doesn't implement requestIdleCallback, so it's undefined at runtime
      originalRIC = 'requestIdleCallback' in window ? window.requestIdleCallback : undefined;
    });

    afterEach(() => {
      if (originalRIC !== undefined) {
        window.requestIdleCallback = originalRIC;
      } else {
        Reflect.deleteProperty(window, 'requestIdleCallback');
      }
    });

    it("calls loader after idle via setTimeout fallback when requestIdleCallback is absent", async () => {
      // happy-dom does not implement requestIdleCallback, so the fallback (setTimeout) is used
      const loader = mock(async () => {});
      document.body.innerHTML = "<idle-widget client:idle></idle-widget>";
      revive({ "/islands/idle-widget.ts": loader }, { directives: { idle: { timeout: 20 } } });
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("respects custom idle timeout", async () => {
      const loader = mock(async () => {});
      document.body.innerHTML = "<idle-fast client:idle></idle-fast>";
      revive({ "/islands/idle-fast.ts": loader }, { directives: { idle: { timeout: 20 } } });
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("calls loader via requestIdleCallback when available", async () => {
      let cb!: IdleRequestCallback;
      window.requestIdleCallback = (fn) => { cb = fn; return 0; };

      const loader = mock(async () => {});
      document.body.innerHTML = "<idle-box client:idle></idle-box>";
      revive({ "/islands/idle-box.ts": loader });

      expect(loader).not.toHaveBeenCalled();
      cb(IDLE_DEADLINE);
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("passes timeout option to requestIdleCallback", () => {
      let capturedOpts: IdleRequestOptions | undefined;
      window.requestIdleCallback = (_fn, opts) => { capturedOpts = opts; return 0; };

      document.body.innerHTML = "<idle-opts client:idle></idle-opts>";
      revive({ "/islands/idle-opts.ts": mock(async () => {}) }, { directives: { idle: { timeout: 300 } } });

      expect(capturedOpts).toEqual({ timeout: 300 });
    });

    it("attribute value overrides global timeout per element", async () => {
      // global=5000ms but per-element="20" → should load within 80ms
      const loader = mock(async () => {});
      document.body.innerHTML = '<idle-per-el client:idle="20"></idle-per-el>';
      revive(
        { "/islands/idle-per-el.ts": loader },
        { directives: { idle: { timeout: 5000 } } },
      );
      await flush(80);
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("empty attribute value falls back to global timeout", async () => {
      const loader = mock(async () => {});
      document.body.innerHTML = "<idle-per-el-default client:idle></idle-per-el-default>";
      revive(
        { "/islands/idle-per-el-default.ts": loader },
        { directives: { idle: { timeout: 20 } } },
      );
      await flush(80);
      expect(loader).toHaveBeenCalledTimes(1);
    });
  });

  describe("client:visible", () => {
    let trigger!: IntersectionObserverCallback;
    let ioOptions: IntersectionObserverInit | undefined;
    let originalIO: typeof IntersectionObserver;

    beforeEach(() => {
      originalIO = mockIntersectionObserver(class {
        observe = (): void => {};
        disconnect = (): void => {};
        constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) {
          trigger = cb;
          ioOptions = opts;
        }
      });
    });

    afterEach(() => {
      globalThis.IntersectionObserver = originalIO;
    });

    it("does not load until the IntersectionObserver callback fires", async () => {
      const loader = mock(async () => {});
      document.body.innerHTML = "<lazy-section client:visible></lazy-section>";
      revive({ "/islands/lazy-section.ts": loader });

      expect(loader).not.toHaveBeenCalled();
      trigger([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("does not load when IntersectionObserver fires with isIntersecting false", async () => {
      const loader = mock(async () => {});
      document.body.innerHTML = "<off-screen client:visible></off-screen>";
      revive({ "/islands/off-screen.ts": loader });

      trigger([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
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

    it("attribute value overrides global rootMargin per element", () => {
      document.body.innerHTML = '<vis-override client:visible="0px"></vis-override>';
      revive(
        { "/islands/vis-override.ts": mock(async () => {}) },
        { directives: { visible: { rootMargin: "200px" } } },
      );
      expect(ioOptions?.rootMargin).toBe("0px");
    });

    it("empty attribute value falls back to global rootMargin", () => {
      document.body.innerHTML = "<vis-fallback client:visible></vis-fallback>";
      revive(
        { "/islands/vis-fallback.ts": mock(async () => {}) },
        { directives: { visible: { rootMargin: "100px" } } },
      );
      expect(ioOptions?.rootMargin).toBe("100px");
    });
  });

  describe("client:media", () => {
    let originalMatchMedia: typeof window.matchMedia;

    beforeEach(() => {
      originalMatchMedia = window.matchMedia;
    });

    afterEach(() => {
      window.matchMedia = originalMatchMedia;
    });

    it("loads immediately when the media query already matches", async () => {
      window.matchMedia = (_q) => ({ matches: true, addEventListener: () => {} } as unknown as MediaQueryList);

      const loader = mock(async () => {});
      document.body.innerHTML = '<media-panel client:media="(max-width: 768px)"></media-panel>';
      revive({ "/islands/media-panel.ts": loader });
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("waits for a change event when the query does not initially match", async () => {
      let changeHandler!: () => void;
      window.matchMedia = (_q) => ({
        matches: false,
        addEventListener: (_: string, h: () => void) => { changeHandler = h; },
      } as unknown as MediaQueryList);

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

  describe("client:defer", () => {
    it("loads after the specified delay", async () => {
      const loader = mock(async () => {});
      document.body.innerHTML = '<defer-widget client:defer="20"></defer-widget>';
      revive({ "/islands/defer-widget.ts": loader });
      await flush(); // 50ms — past the 20ms delay
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("does not load before the delay has elapsed", async () => {
      const loader = mock(async () => {});
      document.body.innerHTML = '<defer-slow client:defer="500"></defer-slow>';
      revive({ "/islands/defer-slow.ts": loader });
      await flush(); // 50ms — well before 500ms
      expect(loader).not.toHaveBeenCalled();
    });

    it("uses configured fallback delay when attribute has no value", async () => {
      const loader = mock(async () => {});
      document.body.innerHTML = '<defer-novalue client:defer></defer-novalue>';
      revive({ "/islands/defer-novalue.ts": loader }, { directives: { defer: { delay: 20 } } });
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("respects custom attribute name", async () => {
      const loader = mock(async () => {});
      document.body.innerHTML = '<defer-custom data:defer="20"></defer-custom>';
      revive({ "/islands/defer-custom.ts": loader }, { directives: { defer: { attribute: "data:defer" } } });
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("falls back to configured delay and warns when attribute value is not a valid number", async () => {
      const spy = spyOn(console, "warn");
      const loader = mock(async () => {});
      document.body.innerHTML = '<defer-nan client:defer="abc"></defer-nan>';
      revive({ "/islands/defer-nan.ts": loader }, { directives: { defer: { delay: 20 } } });
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(expect.stringContaining("invalid"));
      spy.mockRestore();
    });

    it("treats client:defer=\"0\" as a zero ms delay, not the default", async () => {
      const loader = mock(async () => {});
      document.body.innerHTML = '<defer-zero client:defer="0"></defer-zero>';
      revive({ "/islands/defer-zero.ts": loader });
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("waits for both defer and idle when combined", async () => {
      const loader = mock(async () => {});
      document.body.innerHTML = '<defer-combo client:defer="20" client:idle></defer-combo>';
      revive({ "/islands/defer-combo.ts": loader }, { directives: { idle: { timeout: 20 } } });
      await flush(80);
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

  describe("custom directives", () => {
    it("calls the directive function with loader, options, and element", async () => {
      const directiveFn = mock<ClientDirective>((_load, _opts, _el) => {});
      document.body.innerHTML = "<click-island client:on-click></click-island>";
      const customDirectives = new Map<string, ClientDirective>([["client:on-click", directiveFn]]);
      revive({ "/islands/click-island.ts": mock(async () => {}) }, {}, customDirectives);
      await flush();
      expect(directiveFn).toHaveBeenCalledTimes(1);
      const [loadArg, optsArg, elArg] = directiveFn.mock.calls[0];
      expect(typeof loadArg).toBe("function");
      expect(optsArg).toEqual({ name: "client:on-click", value: "" });
      expect(elArg.tagName.toLowerCase()).toBe("click-island");
    });

    it("passes attribute value in options", async () => {
      const directiveFn = mock<ClientDirective>((_load, _opts, _el) => {});
      document.body.innerHTML = '<val-island client:on-click="submit"></val-island>';
      const customDirectives = new Map<string, ClientDirective>([["client:on-click", directiveFn]]);
      revive({ "/islands/val-island.ts": mock(async () => {}) }, {}, customDirectives);
      await flush();
      expect(directiveFn.mock.calls[0][1].value).toBe("submit");
    });

    it("does not auto-load when a custom directive matches — directive owns the load call", async () => {
      const directiveFn = mock<ClientDirective>(() => { /* intentionally don't call load */ });
      const loader = mock(async () => {});
      document.body.innerHTML = "<no-auto-load client:on-click></no-auto-load>";
      const customDirectives = new Map<string, ClientDirective>([["client:on-click", directiveFn]]);
      revive({ "/islands/no-auto-load.ts": loader }, {}, customDirectives);
      await flush();
      expect(loader).not.toHaveBeenCalled();
      expect(directiveFn).toHaveBeenCalledTimes(1);
    });

    it("calls load immediately when no custom directive attribute matches", async () => {
      const loader = mock(async () => {});
      document.body.innerHTML = "<no-attr-island></no-attr-island>";
      const customDirectives = new Map<string, ClientDirective>([["client:on-click", mock<ClientDirective>(() => {})]]);
      revive({ "/islands/no-attr-island.ts": loader }, {}, customDirectives);
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("built-ins gate before custom directive — client:visible must resolve first", async () => {
      let trigger!: IntersectionObserverCallback;
      const originalIO = mockIntersectionObserver(class {
        observe = (): void => {};
        disconnect = (): void => {};
        constructor(cb: IntersectionObserverCallback) { trigger = cb; }
      });

      const directiveFn = mock<ClientDirective>(() => {});
      document.body.innerHTML = "<gated-island client:visible client:on-click></gated-island>";
      const customDirectives = new Map<string, ClientDirective>([["client:on-click", directiveFn]]);
      revive({ "/islands/gated-island.ts": mock(async () => {}) }, {}, customDirectives);
      await flush();

      expect(directiveFn).not.toHaveBeenCalled();
      trigger([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
      await flush();
      expect(directiveFn).toHaveBeenCalledTimes(1);

      globalThis.IntersectionObserver = originalIO;
    });
  });

});
