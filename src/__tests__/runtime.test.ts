/// <reference lib="dom" />
import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { revive } from "../runtime";
import { onIslandLoad, onIslandError } from "../events";
import type { ClientDirective, ClientDirectiveLoader } from "../index";

// Flush microtasks + a short timer tick so async directive chains resolve
const flush = (ms = 50) => new Promise<void>((r) => setTimeout(r, ms));

// A minimal IdleDeadline for triggering captured requestIdleCallback handlers
const IDLE_DEADLINE: IdleDeadline = { timeRemaining: () => 0, didTimeout: false };

// Helper to install a mock IntersectionObserver and return the real one for restoration
function mockIntersectionObserver(
  impl: new (
    cb: IntersectionObserverCallback,
    opts?: IntersectionObserverInit,
  ) => Pick<IntersectionObserver, "observe" | "disconnect">,
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
      let moCallback: MutationCallback | undefined;
      const OriginalMO = globalThis.MutationObserver;
      globalThis.MutationObserver = class {
        constructor(cb: MutationCallback) {
          moCallback = cb;
        }
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
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to load"),
        expect.any(Error),
      );

      // Simulate re-insertion via MutationObserver — queued was cleared on failure
      const el2 = document.createElement("retry-island");
      moCallback!(
        [{ addedNodes: [el2], removedNodes: [] } as unknown as MutationRecord],
        {} as MutationObserver,
      );
      await flush();
      expect(loader).toHaveBeenCalledTimes(2);

      globalThis.MutationObserver = OriginalMO;
      spy.mockRestore();
    });

    it("does not retry on re-insertion when load succeeds", async () => {
      let moCallback: MutationCallback | undefined;
      const OriginalMO = globalThis.MutationObserver;
      globalThis.MutationObserver = class {
        constructor(cb: MutationCallback) {
          moCallback = cb;
        }
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
      moCallback!(
        [{ addedNodes: [el2], removedNodes: [] } as unknown as MutationRecord],
        {} as MutationObserver,
      );
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
      originalRIC = "requestIdleCallback" in window ? window.requestIdleCallback : undefined;
    });

    afterEach(() => {
      if (originalRIC !== undefined) {
        window.requestIdleCallback = originalRIC;
      } else {
        Reflect.deleteProperty(window, "requestIdleCallback");
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

    it("calls loader via requestIdleCallback when available", async () => {
      let cb!: IdleRequestCallback;
      window.requestIdleCallback = (fn) => {
        cb = fn;
        return 0;
      };

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
      window.requestIdleCallback = (_fn, opts) => {
        capturedOpts = opts;
        return 0;
      };

      document.body.innerHTML = "<idle-opts client:idle></idle-opts>";
      revive(
        { "/islands/idle-opts.ts": mock(async () => {}) },
        { directives: { idle: { timeout: 300 } } },
      );

      expect(capturedOpts).toEqual({ timeout: 300 });
    });

    it("attribute value overrides global timeout per element", async () => {
      // global=5000ms but per-element="20" → should load within 80ms
      const loader = mock(async () => {});
      document.body.innerHTML = '<idle-per-el client:idle="20"></idle-per-el>';
      revive({ "/islands/idle-per-el.ts": loader }, { directives: { idle: { timeout: 5000 } } });
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
      originalIO = mockIntersectionObserver(
        class {
          observe = (): void => {};
          disconnect = (): void => {};
          constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) {
            trigger = cb;
            ioOptions = opts;
          }
        },
      );
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
      revive(
        { "/islands/margin-custom.ts": mock(async () => {}) },
        { directives: { visible: { rootMargin: "0px" } } },
      );
      expect(ioOptions?.rootMargin).toBe("0px");
    });

    it("passes custom threshold to IntersectionObserver", () => {
      document.body.innerHTML = "<threshold-test client:visible></threshold-test>";
      revive(
        { "/islands/threshold-test.ts": mock(async () => {}) },
        { directives: { visible: { threshold: 0.5 } } },
      );
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
      window.matchMedia = (_q) =>
        ({ matches: true, addEventListener: () => {} }) as unknown as MediaQueryList;

      const loader = mock(async () => {});
      document.body.innerHTML = '<media-panel client:media="(max-width: 768px)"></media-panel>';
      revive({ "/islands/media-panel.ts": loader });
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("waits for a change event when the query does not initially match", async () => {
      let changeHandler!: () => void;
      window.matchMedia = (_q) =>
        ({
          matches: false,
          addEventListener: (_: string, h: () => void) => {
            changeHandler = h;
          },
        }) as unknown as MediaQueryList;

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
      document.body.innerHTML = "<defer-novalue client:defer></defer-novalue>";
      revive({ "/islands/defer-novalue.ts": loader }, { directives: { defer: { delay: 20 } } });
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("respects custom attribute name", async () => {
      const loader = mock(async () => {});
      document.body.innerHTML = '<defer-custom data:defer="20"></defer-custom>';
      revive(
        { "/islands/defer-custom.ts": loader },
        { directives: { defer: { attribute: "data:defer" } } },
      );
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

    it('treats client:defer="0" as a zero ms delay, not the default', async () => {
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

  describe("child island cascade", () => {
    it("child island loads via cascade when parent resolves immediately", async () => {
      const parentLoader = mock(async () => {});
      const childLoader = mock(async () => {});

      document.body.innerHTML = `
        <parent-widget>
          <child-widget></child-widget>
        </parent-widget>
      `;

      revive({
        "/islands/parent-widget.ts": parentLoader,
        "/islands/child-widget.ts": childLoader,
      });

      await flush();
      expect(parentLoader).toHaveBeenCalledTimes(1);
      // Child activated via cascade after parent loaded, not directly
      expect(childLoader).toHaveBeenCalledTimes(1);
    });

    it("child island loads after parent loader resolves", async () => {
      let resolveParent!: () => void;
      const parentLoader = mock(
        () =>
          new Promise<void>((resolve) => {
            resolveParent = resolve;
          }),
      );
      const childLoader = mock(async () => {});

      document.body.innerHTML = `
        <parent-cascade>
          <child-cascade></child-cascade>
        </parent-cascade>
      `;

      revive({
        "/islands/parent-cascade.ts": parentLoader,
        "/islands/child-cascade.ts": childLoader,
      });

      await flush();
      expect(parentLoader).toHaveBeenCalledTimes(1);
      expect(childLoader).not.toHaveBeenCalled();

      resolveParent();
      await flush();
      expect(childLoader).toHaveBeenCalledTimes(1);
    });

    it("grandchild loads only after mid-child cascade resolves (three-level nesting)", async () => {
      let resolveGrandParent!: () => void;
      const grandParentLoader = mock(
        () =>
          new Promise<void>((resolve) => {
            resolveGrandParent = resolve;
          }),
      );
      const midChildLoader = mock(async () => {});
      const deepChildLoader = mock(async () => {});

      document.body.innerHTML = `
        <grand-parent>
          <mid-child>
            <deep-child></deep-child>
          </mid-child>
        </grand-parent>
      `;

      revive({
        "/islands/grand-parent.ts": grandParentLoader,
        "/islands/mid-child.ts": midChildLoader,
        "/islands/deep-child.ts": deepChildLoader,
      });

      await flush();
      expect(grandParentLoader).toHaveBeenCalledTimes(1);
      expect(midChildLoader).not.toHaveBeenCalled();
      expect(deepChildLoader).not.toHaveBeenCalled();

      resolveGrandParent();
      await flush();
      expect(midChildLoader).toHaveBeenCalledTimes(1);
      expect(deepChildLoader).toHaveBeenCalledTimes(1);
    });
  });

  describe("revive teardown", () => {
    it("returned disconnect() stops the MutationObserver — islands added after disconnect are not activated", async () => {
      const loader = mock(async () => {});
      const { disconnect } = revive({ "/islands/post-disconnect.ts": loader });

      disconnect();

      const el = document.createElement("post-disconnect");
      document.body.appendChild(el);
      await flush();
      expect(loader).not.toHaveBeenCalled();
    });

    it("disconnect() cancels pending retries — run() does not execute after teardown", async () => {
      const spy = spyOn(console, "error").mockImplementation(() => {});
      let callCount = 0;
      const loader = mock(async () => {
        callCount++;
        throw new Error("fail");
      });
      document.body.innerHTML = "<dc-retry></dc-retry>";
      const { disconnect } = revive(
        { "/islands/dc-retry.ts": loader },
        { retry: { retries: 3, delay: 100 } },
      );
      await flush(); // initial attempt fires and fails; first retry at 100ms not yet due
      expect(callCount).toBe(1);

      disconnect(); // cancel before any retry fires
      await flush(400); // wait long enough for retries to have fired if not cancelled
      expect(callCount).toBe(1); // no retries executed after disconnect
      spy.mockRestore();
    });
  });

  describe("client:media empty value", () => {
    it("warns and skips when client:media has an empty value", async () => {
      const spy = spyOn(console, "warn");
      const loader = mock(async () => {});
      document.body.innerHTML = '<empty-media client:media=""></empty-media>';
      revive({ "/islands/empty-media.ts": loader });
      await flush();
      expect(spy).toHaveBeenCalledWith(expect.stringContaining("has no value"));
      // Island still loads (media check is skipped, not the whole island)
      expect(loader).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });
  });

  describe("debug logging", () => {
    it("does not call console.groupCollapsed when debug is false (default)", () => {
      const groupCollapsed = spyOn(console, "groupCollapsed").mockImplementation(() => {});
      document.body.innerHTML = "<no-debug-island></no-debug-island>";
      revive({ "/islands/no-debug-island.ts": mock(async () => {}) });
      expect(groupCollapsed).not.toHaveBeenCalled();
      groupCollapsed.mockRestore();
    });

    it("wraps the init walk in a collapsed group with island count when debug: true", () => {
      const groupCollapsed = spyOn(console, "groupCollapsed").mockImplementation(() => {});
      const groupEnd = spyOn(console, "groupEnd").mockImplementation(() => {});
      document.body.innerHTML = "<dbg-init></dbg-init>";
      revive({ "/islands/dbg-init.ts": mock(async () => {}) }, { debug: true });
      expect(groupCollapsed).toHaveBeenCalledWith("[islands] ready — 1 island(s)");
      expect(groupEnd).toHaveBeenCalled();
      groupCollapsed.mockRestore();
      groupEnd.mockRestore();
    });

    it("logs waiting with directive names for islands that have directives during init", async () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const groupCollapsed = spyOn(console, "groupCollapsed").mockImplementation(() => {});
      const groupEnd = spyOn(console, "groupEnd").mockImplementation(() => {});
      document.body.innerHTML = '<dbg-waiting client:defer="500"></dbg-waiting>';
      revive({ "/islands/dbg-waiting.ts": mock(async () => {}) }, { debug: true });
      const waitingCalls = logSpy.mock.calls.filter((args) =>
        String(args[1]).includes("waiting ·"),
      );
      expect(waitingCalls).toHaveLength(1);
      expect(waitingCalls[0]).toEqual(["[islands]", '<dbg-waiting> waiting · client:defer="500"']);
      logSpy.mockRestore();
      groupCollapsed.mockRestore();
      groupEnd.mockRestore();
    });

    it("does not log waiting for islands with no directives", () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const groupCollapsed = spyOn(console, "groupCollapsed").mockImplementation(() => {});
      const groupEnd = spyOn(console, "groupEnd").mockImplementation(() => {});
      document.body.innerHTML = "<dbg-instant></dbg-instant>";
      revive({ "/islands/dbg-instant.ts": mock(async () => {}) }, { debug: true });
      const waitingCalls = logSpy.mock.calls.filter((args) =>
        String(args[1]).includes("waiting ·"),
      );
      expect(waitingCalls).toHaveLength(0);
      logSpy.mockRestore();
      groupCollapsed.mockRestore();
      groupEnd.mockRestore();
    });

    it("does not log waiting for islands added dynamically after init", async () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const groupCollapsed = spyOn(console, "groupCollapsed").mockImplementation(() => {});
      const groupEnd = spyOn(console, "groupEnd").mockImplementation(() => {});
      revive({ "/islands/dbg-dynamic.ts": mock(async () => {}) }, { debug: true });
      logSpy.mockClear();
      const el = document.createElement("dbg-dynamic");
      el.setAttribute("client:defer", "500");
      document.body.appendChild(el);
      await flush();
      const waitingCalls = logSpy.mock.calls.filter((args) =>
        String(args[1]).includes("waiting ·"),
      );
      expect(waitingCalls).toHaveLength(0);
      logSpy.mockRestore();
      groupCollapsed.mockRestore();
      groupEnd.mockRestore();
    });

    it("includes the outcome in the collapsed group label when intermediate notes were buffered", async () => {
      const groupCollapsed = spyOn(console, "groupCollapsed").mockImplementation(() => {});
      const groupEnd = spyOn(console, "groupEnd").mockImplementation(() => {});
      document.body.innerHTML = '<dbg-outcome client:defer="20"></dbg-outcome>';
      revive({ "/islands/dbg-outcome.ts": mock(async () => {}) }, { debug: true });
      await flush();
      const triggered = groupCollapsed.mock.calls.find((args) =>
        String(args[0]).includes("<dbg-outcome> triggered"),
      );
      expect(triggered).toBeDefined();
      groupCollapsed.mockRestore();
      groupEnd.mockRestore();
    });

    it("logs a flat line (no group) when an island fires with no intermediate waits", async () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const groupCollapsed = spyOn(console, "groupCollapsed").mockImplementation(() => {});
      const groupEnd = spyOn(console, "groupEnd").mockImplementation(() => {});
      document.body.innerHTML = "<dbg-flat></dbg-flat>";
      revive({ "/islands/dbg-flat.ts": mock(async () => {}) }, { debug: true });
      await flush();
      expect(logSpy).toHaveBeenCalledWith("[islands]", "<dbg-flat> triggered");
      // outcome is a flat log, not a group
      const triggeredGroup = groupCollapsed.mock.calls.find((args) =>
        String(args[0]).includes("<dbg-flat> triggered"),
      );
      expect(triggeredGroup).toBeUndefined();
      logSpy.mockRestore();
      groupCollapsed.mockRestore();
      groupEnd.mockRestore();
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
      const directiveFn = mock<ClientDirective>(() => {
        /* intentionally don't call load */
      });
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
      const customDirectives = new Map<string, ClientDirective>([
        ["client:on-click", mock<ClientDirective>(() => {})],
      ]);
      revive({ "/islands/no-attr-island.ts": loader }, {}, customDirectives);
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("built-ins gate before custom directive — client:visible must resolve first", async () => {
      let trigger!: IntersectionObserverCallback;
      const originalIO = mockIntersectionObserver(
        class {
          observe = (): void => {};
          disconnect = (): void => {};
          constructor(cb: IntersectionObserverCallback) {
            trigger = cb;
          }
        },
      );

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

    it("catches sync custom directive errors and allows retry on re-insertion", async () => {
      let moCallback: MutationCallback | undefined;
      const OriginalMO = globalThis.MutationObserver;
      globalThis.MutationObserver = class {
        constructor(cb: MutationCallback) {
          moCallback = cb;
        }
        observe() {}
        disconnect() {}
      } as unknown as typeof MutationObserver;

      const loader = mock(async () => {});
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});
      const unhandledSpy = mock(() => {});
      process.once("unhandledRejection", unhandledSpy);

      const directiveFn = mock<ClientDirective>(() => {
        throw new Error("directive failed");
      });

      document.body.innerHTML = "<broken-island client:on-click></broken-island>";
      const customDirectives = new Map<string, ClientDirective>([["client:on-click", directiveFn]]);
      revive({ "/islands/broken-island.ts": loader }, {}, customDirectives);

      await flush();
      expect(directiveFn).toHaveBeenCalledTimes(1);
      expect(loader).not.toHaveBeenCalled();
      expect(unhandledSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Custom directive client:on-click failed"),
        expect.any(Error),
      );

      const el2 = document.createElement("broken-island");
      el2.setAttribute("client:on-click", "");
      moCallback!(
        [{ addedNodes: [el2], removedNodes: [] } as unknown as MutationRecord],
        {} as MutationObserver,
      );
      await flush();
      expect(directiveFn).toHaveBeenCalledTimes(2);
      expect(loader).not.toHaveBeenCalled();
      expect(unhandledSpy).not.toHaveBeenCalled();

      process.off("unhandledRejection", unhandledSpy);
      globalThis.MutationObserver = OriginalMO;
      errorSpy.mockRestore();
    });

    it("does not warn about multiple custom directives — AND latch handles them", async () => {
      const spy = spyOn(console, "warn");
      const loads: ClientDirectiveLoader[] = [];
      const makeDir = (): ClientDirective => (load) => {
        loads.push(load);
      };
      document.body.innerHTML = "<no-warn-multi client:on-a client:on-b></no-warn-multi>";
      const customDirectives = new Map<string, ClientDirective>([
        ["client:on-a", makeDir()],
        ["client:on-b", makeDir()],
      ]);
      revive({ "/islands/no-warn-multi.ts": mock(async () => {}) }, {}, customDirectives);
      await flush();
      expect(spy).not.toHaveBeenCalledWith(expect.stringContaining("multiple custom directives"));
      spy.mockRestore();
    });

    it("catches async custom directive rejections and allows retry on re-insertion", async () => {
      let moCallback: MutationCallback | undefined;
      const OriginalMO = globalThis.MutationObserver;
      globalThis.MutationObserver = class {
        constructor(cb: MutationCallback) {
          moCallback = cb;
        }
        observe() {}
        disconnect() {}
      } as unknown as typeof MutationObserver;

      const loader = mock(async () => {});
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});
      const unhandledSpy = mock(() => {});
      process.once("unhandledRejection", unhandledSpy);

      const directiveFn = mock<ClientDirective>(async () => {
        throw new Error("async directive failed");
      });

      document.body.innerHTML = "<broken-async client:on-click></broken-async>";
      const customDirectives = new Map<string, ClientDirective>([["client:on-click", directiveFn]]);
      revive({ "/islands/broken-async.ts": loader }, {}, customDirectives);

      await flush();
      expect(directiveFn).toHaveBeenCalledTimes(1);
      expect(loader).not.toHaveBeenCalled();
      expect(unhandledSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Custom directive client:on-click failed"),
        expect.any(Error),
      );

      const el2 = document.createElement("broken-async");
      el2.setAttribute("client:on-click", "");
      moCallback!(
        [{ addedNodes: [el2], removedNodes: [] } as unknown as MutationRecord],
        {} as MutationObserver,
      );
      await flush();
      expect(directiveFn).toHaveBeenCalledTimes(2);
      expect(loader).not.toHaveBeenCalled();
      expect(unhandledSpy).not.toHaveBeenCalled();

      process.off("unhandledRejection", unhandledSpy);
      globalThis.MutationObserver = OriginalMO;
      errorSpy.mockRestore();
    });
  });

  describe("retries", () => {
    it("retries specified number of times before succeeding", async () => {
      const spy = spyOn(console, "error").mockImplementation(() => {});
      let callCount = 0;
      const loader = mock(async () => {
        callCount++;
        if (callCount < 3) throw new Error("network error");
      });
      document.body.innerHTML = "<retry-success></retry-success>";
      revive({ "/islands/retry-success.ts": loader }, { retry: { retries: 2, delay: 10 } });
      await flush(200);
      expect(loader).toHaveBeenCalledTimes(3); // initial + 2 retries
      spy.mockRestore();
    });

    it("exhausting retries clears queued allowing manual re-insertion", async () => {
      const spy = spyOn(console, "error").mockImplementation(() => {});
      let moCallback: MutationCallback | undefined;
      const OriginalMO = globalThis.MutationObserver;
      globalThis.MutationObserver = class {
        constructor(cb: MutationCallback) {
          moCallback = cb;
        }
        observe() {}
        disconnect() {}
      } as unknown as typeof MutationObserver;

      const loader = mock(async () => {
        throw new Error("always fails");
      });
      document.body.innerHTML = "<retry-exhaust></retry-exhaust>";
      revive({ "/islands/retry-exhaust.ts": loader }, { retry: { retries: 1, delay: 10 } });
      await flush(200);
      expect(loader).toHaveBeenCalledTimes(2); // initial + 1 retry

      // After exhaustion, queued is cleared — re-insertion triggers a fresh activation
      const el2 = document.createElement("retry-exhaust");
      moCallback!(
        [{ addedNodes: [el2], removedNodes: [] } as unknown as MutationRecord],
        {} as MutationObserver,
      );
      await flush(200);
      expect(loader).toHaveBeenCalledTimes(4); // 2 more (initial + 1 retry again)

      globalThis.MutationObserver = OriginalMO;
      spy.mockRestore();
    });

    it("islands:error fires on each retry attempt", async () => {
      const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      const handler = mock((e: CustomEvent) => e);
      document.addEventListener("islands:error", handler);

      const loader = mock(() => Promise.reject(new Error("fail")));
      document.body.innerHTML = "<retry-ev></retry-ev>";
      revive({ "/islands/retry-ev.ts": loader }, { retry: { retries: 2, delay: 10 } });

      await flush(200); // wait for initial attempt + 2 retries (10ms + 20ms delays)

      // islands:error should fire on the initial attempt + each retry = 3 total
      expect(handler).toHaveBeenCalledTimes(3);
      expect(handler.mock.calls[0][0].detail).toMatchObject({ tag: "retry-ev", attempt: 1 });
      expect(handler.mock.calls[1][0].detail).toMatchObject({ tag: "retry-ev", attempt: 2 });
      expect(handler.mock.calls[2][0].detail).toMatchObject({ tag: "retry-ev", attempt: 3 });

      document.removeEventListener("islands:error", handler);
      consoleSpy.mockRestore();
    });

    it("islands:load detail.attempt is 2 when first attempt fails and retry succeeds", async () => {
      const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      const loadHandler = mock((e: CustomEvent) => e);
      document.addEventListener("islands:load", loadHandler);
      let callCount = 0;
      const loader = mock(async () => {
        callCount++;
        if (callCount === 1) throw new Error("first attempt fails");
      });
      document.body.innerHTML = "<retry-attempt-load></retry-attempt-load>";
      revive({ "/islands/retry-attempt-load.ts": loader }, { retry: { retries: 1, delay: 10 } });
      await flush(200);
      expect(loadHandler).toHaveBeenCalledTimes(1);
      expect(loadHandler.mock.calls[0][0].detail).toMatchObject({
        tag: "retry-attempt-load",
        attempt: 2,
      });
      document.removeEventListener("islands:load", loadHandler);
      consoleSpy.mockRestore();
    });

    it("retries: 0 (default) does not auto-retry — existing failure clears queued immediately", async () => {
      const spy = spyOn(console, "error").mockImplementation(() => {});
      const loader = mock(async () => {
        throw new Error("fail");
      });
      document.body.innerHTML = "<no-retry-default></no-retry-default>";
      revive({ "/islands/no-retry-default.ts": loader });
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });
  });

  describe("DOM events", () => {
    it("islands:load fires after the module resolves", async () => {
      const handler = mock((e: CustomEvent) => e);
      document.addEventListener("islands:load", handler);
      document.body.innerHTML = "<load-ev></load-ev>";
      revive({ "/islands/load-ev.ts": mock(async () => {}) });
      await flush();
      expect(handler).toHaveBeenCalledTimes(1);
      const detail = handler.mock.calls[0][0].detail;
      expect(detail).toMatchObject({ tag: "load-ev", attempt: 1 });
      expect(typeof detail.duration).toBe("number");
      expect(detail.duration).toBeGreaterThanOrEqual(0);
      document.removeEventListener("islands:load", handler);
    });

    it("islands:error fires on loader failure alongside console.error", async () => {
      const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      const handler = mock((e: CustomEvent) => e);
      document.addEventListener("islands:error", handler);
      const err = new Error("load failed");
      document.body.innerHTML = "<error-ev></error-ev>";
      revive({
        "/islands/error-ev.ts": mock(async () => {
          throw err;
        }),
      });
      await flush();
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].detail).toMatchObject({
        tag: "error-ev",
        error: err,
        attempt: 1,
      });
      expect(consoleSpy).toHaveBeenCalled();
      document.removeEventListener("islands:error", handler);
      consoleSpy.mockRestore();
    });

    it("islands:error fires on custom directive failure", async () => {
      const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      const handler = mock((e: CustomEvent) => e);
      document.addEventListener("islands:error", handler);
      const err = new Error("directive failed");
      document.body.innerHTML = "<dir-err-ev client:on-click></dir-err-ev>";
      const customDirectives = new Map<string, ClientDirective>([
        [
          "client:on-click",
          mock<ClientDirective>(() => {
            throw err;
          }),
        ],
      ]);
      revive({ "/islands/dir-err-ev.ts": mock(async () => {}) }, {}, customDirectives);
      await flush();
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].detail).toMatchObject({
        tag: "dir-err-ev",
        error: err,
        attempt: 1,
      });
      document.removeEventListener("islands:error", handler);
      consoleSpy.mockRestore();
    });

    it("multiple independent listeners each receive the event", async () => {
      const handlerA = mock((e: CustomEvent) => e);
      const handlerB = mock((e: CustomEvent) => e);
      document.addEventListener("islands:load", handlerA);
      document.addEventListener("islands:load", handlerB);
      document.body.innerHTML = "<multi-listener></multi-listener>";
      revive({ "/islands/multi-listener.ts": mock(async () => {}) });
      await flush();
      expect(handlerA).toHaveBeenCalledTimes(1);
      expect(handlerB).toHaveBeenCalledTimes(1);
      document.removeEventListener("islands:load", handlerA);
      document.removeEventListener("islands:load", handlerB);
    });
  });

  describe("onIslandLoad / onIslandError helpers", () => {
    it("onIslandLoad receives detail directly and returns a cleanup function", async () => {
      const handler = mock((_detail: { tag: string; duration: number; attempt: number }) => {});
      const off = onIslandLoad(handler);
      document.body.innerHTML = "<helper-load></helper-load>";
      revive({ "/islands/helper-load.ts": mock(async () => {}) });
      await flush();
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toMatchObject({ tag: "helper-load", attempt: 1 });
      expect(typeof handler.mock.calls[0][0].duration).toBe("number");
      off();
    });

    it("onIslandLoad cleanup removes the listener", async () => {
      const handler = mock(() => {});
      const off = onIslandLoad(handler);
      off();
      document.body.innerHTML = "<helper-off></helper-off>";
      revive({ "/islands/helper-off.ts": mock(async () => {}) });
      await flush();
      expect(handler).not.toHaveBeenCalled();
    });

    it("onIslandError receives detail directly and returns a cleanup function", async () => {
      const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      const handler = mock((_detail: { tag: string; error: unknown; attempt: number }) => {});
      const err = new Error("helper error");
      const off = onIslandError(handler);
      document.body.innerHTML = "<helper-err></helper-err>";
      revive({
        "/islands/helper-err.ts": mock(async () => {
          throw err;
        }),
      });
      await flush();
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toMatchObject({ tag: "helper-err", error: err, attempt: 1 });
      off();
      consoleSpy.mockRestore();
    });

    it("onIslandError cleanup removes the listener", async () => {
      const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      const handler = mock(() => {});
      const off = onIslandError(handler);
      off();
      document.body.innerHTML = "<helper-err-off></helper-err-off>";
      revive({
        "/islands/helper-err-off.ts": mock(async () => {
          throw new Error("should not reach handler");
        }),
      });
      await flush();
      expect(handler).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("multiple custom directives (AND latch)", () => {
    it("loads only after both custom directives call load()", async () => {
      const loader = mock(async () => {});
      let loadA!: ClientDirectiveLoader;
      let loadB!: ClientDirectiveLoader;
      const directiveA = mock<ClientDirective>((load) => {
        loadA = load;
      });
      const directiveB = mock<ClientDirective>((load) => {
        loadB = load;
      });
      document.body.innerHTML = "<and-island client:on-a client:on-b></and-island>";
      const customDirectives = new Map<string, ClientDirective>([
        ["client:on-a", directiveA],
        ["client:on-b", directiveB],
      ]);
      revive({ "/islands/and-island.ts": loader }, {}, customDirectives);
      await flush();
      expect(loader).not.toHaveBeenCalled();

      await loadA();
      await flush();
      expect(loader).not.toHaveBeenCalled(); // only A has fired

      await loadB();
      await flush();
      expect(loader).toHaveBeenCalledTimes(1); // both fired
    });

    it("island loads exactly once even when load() is called more than once", async () => {
      const loader = mock(async () => {});
      let loadA!: ClientDirectiveLoader;
      let loadB!: ClientDirectiveLoader;
      document.body.innerHTML = "<idem-island client:on-a client:on-b></idem-island>";
      const customDirectives = new Map<string, ClientDirective>([
        [
          "client:on-a",
          (load) => {
            loadA = load;
          },
        ],
        [
          "client:on-b",
          (load) => {
            loadB = load;
          },
        ],
      ]);
      revive({ "/islands/idem-island.ts": loader }, {}, customDirectives);
      await flush();

      await loadA();
      await loadB();
      await loadA(); // extra call — fired is already true, ignored
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("three directives — all must call load() before island loads", async () => {
      const loader = mock(async () => {});
      const loads: ClientDirectiveLoader[] = [];
      const makeDir = (): ClientDirective => (load) => {
        loads.push(load);
      };
      document.body.innerHTML = "<three-island client:on-a client:on-b client:on-c></three-island>";
      const customDirectives = new Map<string, ClientDirective>([
        ["client:on-a", makeDir()],
        ["client:on-b", makeDir()],
        ["client:on-c", makeDir()],
      ]);
      revive({ "/islands/three-island.ts": loader }, {}, customDirectives);
      await flush();
      expect(loader).not.toHaveBeenCalled();

      await loads[0]();
      await loads[1]();
      await flush();
      expect(loader).not.toHaveBeenCalled();

      await loads[2]();
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("surviving directive cannot trigger load after sibling directive fails", async () => {
      const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      const loader = mock(async () => {});
      let loadB!: ClientDirectiveLoader;
      document.body.innerHTML = "<abort-latch client:on-a client:on-b></abort-latch>";
      const customDirectives = new Map<string, ClientDirective>([
        [
          "client:on-a",
          mock<ClientDirective>(() => {
            throw new Error("directive A failed");
          }),
        ],
        [
          "client:on-b",
          (load) => {
            loadB = load;
          },
        ],
      ]);
      revive({ "/islands/abort-latch.ts": loader }, {}, customDirectives);
      await flush();
      expect(loader).not.toHaveBeenCalled(); // A failed → latch aborted

      await loadB(); // B calls load() — but aborted is true, should be ignored
      await flush();
      expect(loader).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    describe("client:interaction", () => {
      it("loads on mouseenter (default events)", async () => {
        const loader = mock(async () => {});
        document.body.innerHTML = "<hover-island client:interaction></hover-island>";
        revive({ "/islands/hover-island.ts": loader });
        await flush();
        expect(loader).not.toHaveBeenCalled();
        document.querySelector("hover-island")!.dispatchEvent(new Event("mouseenter"));
        await flush();
        expect(loader).toHaveBeenCalledTimes(1);
      });

      it("loads on touchstart (default events)", async () => {
        const loader = mock(async () => {});
        document.body.innerHTML = "<touch-island client:interaction></touch-island>";
        revive({ "/islands/touch-island.ts": loader });
        await flush();
        expect(loader).not.toHaveBeenCalled();
        document.querySelector("touch-island")!.dispatchEvent(new Event("touchstart"));
        await flush();
        expect(loader).toHaveBeenCalledTimes(1);
      });

      it("loads on focusin (default events)", async () => {
        const loader = mock(async () => {});
        document.body.innerHTML = "<focus-island client:interaction></focus-island>";
        revive({ "/islands/focus-island.ts": loader });
        await flush();
        expect(loader).not.toHaveBeenCalled();
        document.querySelector("focus-island")!.dispatchEvent(new Event("focusin"));
        await flush();
        expect(loader).toHaveBeenCalledTimes(1);
      });

      it("does not load before any event fires", async () => {
        const loader = mock(async () => {});
        document.body.innerHTML = "<no-fire-island client:interaction></no-fire-island>";
        revive({ "/islands/no-fire-island.ts": loader });
        await flush();
        expect(loader).not.toHaveBeenCalled();
      });

      it("per-element value 'mouseenter' only fires on mouseenter, not touchstart", async () => {
        const loader = mock(async () => {});
        document.body.innerHTML =
          '<per-event-island client:interaction="mouseenter"></per-event-island>';
        revive({ "/islands/per-event-island.ts": loader });
        await flush();
        const el = document.querySelector("per-event-island")!;
        el.dispatchEvent(new Event("touchstart"));
        await flush();
        expect(loader).not.toHaveBeenCalled();
        el.dispatchEvent(new Event("mouseenter"));
        await flush();
        expect(loader).toHaveBeenCalledTimes(1);
      });

      it("per-element value 'mouseenter focusin' fires on either event", async () => {
        const loader = mock(async () => {});
        document.body.innerHTML =
          '<multi-event-island client:interaction="mouseenter focusin"></multi-event-island>';
        revive({ "/islands/multi-event-island.ts": loader });
        await flush();
        const el = document.querySelector("multi-event-island")!;
        el.dispatchEvent(new Event("focusin"));
        await flush();
        expect(loader).toHaveBeenCalledTimes(1);
      });

      it("empty attribute uses global default events", async () => {
        const loader = mock(async () => {});
        document.body.innerHTML = '<empty-interaction client:interaction=""></empty-interaction>';
        revive({ "/islands/empty-interaction.ts": loader });
        await flush();
        const el = document.querySelector("empty-interaction")!;
        el.dispatchEvent(new Event("touchstart"));
        await flush();
        expect(loader).toHaveBeenCalledTimes(1);
      });

      it("unknown token warns and is skipped, valid tokens still work", async () => {
        const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
        const loader = mock(async () => {});
        document.body.innerHTML =
          '<warn-interaction client:interaction="mouseenter"></warn-interaction>';
        revive(
          { "/islands/warn-interaction.ts": loader },
          {
            directives: {
              interaction: {
                events: ["mouseenter"],
              },
            },
          },
        );
        await flush();
        document.querySelector("warn-interaction")!.dispatchEvent(new Event("mouseenter"));
        await flush();
        expect(loader).toHaveBeenCalledTimes(1);
        warnSpy.mockRestore();
      });

      it("event listeners removed after load (does not fire twice)", async () => {
        const loader = mock(async () => {});
        document.body.innerHTML = "<cleanup-island client:interaction></cleanup-island>";
        revive({ "/islands/cleanup-island.ts": loader });
        await flush();
        const el = document.querySelector("cleanup-island")!;
        el.dispatchEvent(new Event("mouseenter"));
        await flush();
        expect(loader).toHaveBeenCalledTimes(1);
        // Fire again — listener should be gone
        el.dispatchEvent(new Event("mouseenter"));
        await flush();
        expect(loader).toHaveBeenCalledTimes(1);
      });

      it("does not load when element removed before interaction fires", async () => {
        let moCallback: MutationCallback | undefined;
        const OriginalMO = globalThis.MutationObserver;
        globalThis.MutationObserver = class {
          constructor(cb: MutationCallback) {
            moCallback = cb;
          }
          observe() {}
          disconnect() {}
        } as unknown as typeof MutationObserver;

        const loader = mock(async () => {});
        document.body.innerHTML = "<cancel-interact client:interaction></cancel-interact>";
        revive({ "/islands/cancel-interact.ts": loader });
        await flush();
        expect(loader).not.toHaveBeenCalled();

        // Simulate removal
        const el = document.querySelector("cancel-interact")!;
        document.body.removeChild(el);
        moCallback!(
          [{ addedNodes: [], removedNodes: [el] } as unknown as MutationRecord],
          {} as MutationObserver,
        );
        await flush();

        // Fire interaction on removed element — should not load
        el.dispatchEvent(new Event("mouseenter"));
        await flush();
        expect(loader).not.toHaveBeenCalled();

        globalThis.MutationObserver = OriginalMO;
      });

      it("combines with client:visible — interaction fires only after visible resolves", async () => {
        let ioCallback: IntersectionObserverCallback | undefined;
        let ioInstance: { observe: ReturnType<typeof mock>; disconnect: ReturnType<typeof mock> };
        const origIO = globalThis.IntersectionObserver;
        globalThis.IntersectionObserver = class {
          observe: ReturnType<typeof mock>;
          disconnect: ReturnType<typeof mock>;
          constructor(cb: IntersectionObserverCallback) {
            ioCallback = cb;
            this.observe = mock(() => {});
            this.disconnect = mock(() => {});
            ioInstance = this as typeof ioInstance;
          }
        } as unknown as typeof IntersectionObserver;

        const loader = mock(async () => {});
        document.body.innerHTML = "<combo-island client:visible client:interaction></combo-island>";
        revive({ "/islands/combo-island.ts": loader });
        await flush();

        // Interaction fires before visible — should not load
        document.querySelector("combo-island")!.dispatchEvent(new Event("mouseenter"));
        await flush();
        expect(loader).not.toHaveBeenCalled();

        // Now visible resolves
        const el = document.querySelector("combo-island")!;
        ioCallback!(
          [{ isIntersecting: true, target: el } as unknown as IntersectionObserverEntry],
          {} as IntersectionObserver,
        );
        await flush();
        expect(loader).not.toHaveBeenCalled(); // still waiting for interaction

        // Now fire interaction
        el.dispatchEvent(new Event("mouseenter"));
        await flush();
        expect(loader).toHaveBeenCalledTimes(1);

        globalThis.IntersectionObserver = origIO;
      });

      it("custom attribute name via directives.interaction.attribute", async () => {
        const loader = mock(async () => {});
        document.body.innerHTML = "<custom-attr-island data-lazy></custom-attr-island>";
        revive(
          { "/islands/custom-attr-island.ts": loader },
          { directives: { interaction: { attribute: "data-lazy" } } },
        );
        await flush();
        expect(loader).not.toHaveBeenCalled();
        document.querySelector("custom-attr-island")!.dispatchEvent(new Event("mouseenter"));
        await flush();
        expect(loader).toHaveBeenCalledTimes(1);
      });
    });

    it("debug log names all matched directives when multiple are present", async () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const groupCollapsed = spyOn(console, "groupCollapsed").mockImplementation(() => {});
      const groupEnd = spyOn(console, "groupEnd").mockImplementation(() => {});
      document.body.innerHTML = "<multi-dbg client:on-a client:on-b></multi-dbg>";
      const customDirectives = new Map<string, ClientDirective>([
        [
          "client:on-a",
          (load) => {
            load();
          },
        ],
        [
          "client:on-b",
          (load) => {
            load();
          },
        ],
      ]);
      revive({ "/islands/multi-dbg.ts": mock(async () => {}) }, { debug: true }, customDirectives);
      await flush();
      const dispatchCall = logSpy.mock.calls.find(
        (args) =>
          String(args[1]).includes("dispatching to custom directives") &&
          String(args[1]).includes("client:on-a") &&
          String(args[1]).includes("client:on-b"),
      );
      expect(dispatchCall).toBeDefined();
      logSpy.mockRestore();
      groupCollapsed.mockRestore();
      groupEnd.mockRestore();
    });
  });
});
