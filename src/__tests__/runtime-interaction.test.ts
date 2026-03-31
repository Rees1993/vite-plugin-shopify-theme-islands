/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import {
  createRuntimeSuite,
  flush,
  installMutationDriver,
  installVisibilityDriver,
} from "./harness";

const suite = createRuntimeSuite();
let cleanups = suite.cleanups;
let runtimeHarness = suite.runtime;

describe("runtime interaction directives", () => {
  beforeEach(() => {
    suite.reset();
    cleanups = suite.cleanups;
    runtimeHarness = suite.runtime;
  });

  afterEach(() => {
    suite.cleanup();
  });

  describe("client:interaction", () => {
    it("loads on mouseenter", async () => {
      const loader = mock(async () => {});
      document.body.innerHTML = "<hover-island client:interaction></hover-island>";
      runtimeHarness.start(runtimeHarness.payload({ "/islands/hover-island.ts": loader }));
      await flush();
      expect(loader).not.toHaveBeenCalled();
      document.querySelector("hover-island")!.dispatchEvent(new Event("mouseenter"));
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("loads on touchstart", async () => {
      const loader = mock(async () => {});
      document.body.innerHTML = "<touch-island client:interaction></touch-island>";
      runtimeHarness.start(runtimeHarness.payload({ "/islands/touch-island.ts": loader }));
      await flush();
      document.querySelector("touch-island")!.dispatchEvent(new Event("touchstart"));
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("loads on focusin", async () => {
      const loader = mock(async () => {});
      document.body.innerHTML = "<focus-island client:interaction></focus-island>";
      runtimeHarness.start(runtimeHarness.payload({ "/islands/focus-island.ts": loader }));
      await flush();
      document.querySelector("focus-island")!.dispatchEvent(new Event("focusin"));
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("does not load before any event fires", async () => {
      const loader = mock(async () => {});
      document.body.innerHTML = "<no-fire-island client:interaction></no-fire-island>";
      runtimeHarness.start(runtimeHarness.payload({ "/islands/no-fire-island.ts": loader }));
      await flush();
      expect(loader).not.toHaveBeenCalled();
    });

    it("per-element value only fires on configured events", async () => {
      const loader = mock(async () => {});
      document.body.innerHTML =
        '<per-event-island client:interaction="mouseenter"></per-event-island>';
      runtimeHarness.start(runtimeHarness.payload({ "/islands/per-event-island.ts": loader }));
      await flush();
      const el = document.querySelector("per-event-island")!;
      el.dispatchEvent(new Event("touchstart"));
      await flush();
      expect(loader).not.toHaveBeenCalled();
      el.dispatchEvent(new Event("mouseenter"));
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("per-element value overrides global events config", async () => {
      const loader = mock(async () => {});
      document.body.innerHTML =
        '<override-events client:interaction="mouseenter"></override-events>';
      runtimeHarness.start(
        runtimeHarness.payload(
          { "/islands/override-events.ts": loader },
          { directives: { interaction: { events: ["focusin"] } } },
        ),
      );

      await flush();
      const el = document.querySelector("override-events")!;
      el.dispatchEvent(new Event("focusin"));
      await flush();
      expect(loader).not.toHaveBeenCalled();
      el.dispatchEvent(new Event("mouseenter"));
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("warns for mixed supported and unsupported tokens and uses only supported tokens", async () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      const loader = mock(async () => {});
      document.body.innerHTML =
        '<mixed-interaction client:interaction="mouseenter click"></mixed-interaction>';
      runtimeHarness.start(runtimeHarness.payload({ "/islands/mixed-interaction.ts": loader }));

      await flush();
      const el = document.querySelector("mixed-interaction")!;
      el.dispatchEvent(new Event("click"));
      await flush();
      expect(loader).not.toHaveBeenCalled();

      el.dispatchEvent(new Event("mouseenter"));
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("contains unsupported event token"),
      );
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("click"));
      warnSpy.mockRestore();
    });

    it("warns and falls back to default events when all tokens are unsupported", async () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      const loader = mock(async () => {});
      document.body.innerHTML =
        '<invalid-interaction client:interaction="click submit"></invalid-interaction>';
      runtimeHarness.start(runtimeHarness.payload({ "/islands/invalid-interaction.ts": loader }));

      await flush();
      const el = document.querySelector("invalid-interaction")!;
      el.dispatchEvent(new Event("click"));
      await flush();
      expect(loader).not.toHaveBeenCalled();

      el.dispatchEvent(new Event("touchstart"));
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("contains no supported event tokens"),
      );
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("click, submit"));
      warnSpy.mockRestore();
    });

    it("all-whitespace attribute value warns and falls back to default events", async () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      const loader = mock(async () => {});
      document.body.innerHTML = '<ws-interaction client:interaction="   "></ws-interaction>';
      runtimeHarness.start(runtimeHarness.payload({ "/islands/ws-interaction.ts": loader }));

      await flush();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("no valid event tokens"));
      document.querySelector("ws-interaction")!.dispatchEvent(new Event("touchstart"));
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });

    it("event listeners are removed after load", async () => {
      const loader = mock(async () => {});
      document.body.innerHTML = "<cleanup-island client:interaction></cleanup-island>";
      runtimeHarness.start(runtimeHarness.payload({ "/islands/cleanup-island.ts": loader }));

      await flush();
      const el = document.querySelector("cleanup-island")!;
      el.dispatchEvent(new Event("mouseenter"));
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);

      el.dispatchEvent(new Event("mouseenter"));
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("removes the interaction cancellation watcher after interaction fires", async () => {
      const mutations = installMutationDriver(cleanups);
      const loader = mock(async () => {});

      document.body.innerHTML = "<cleanup-cancel client:interaction></cleanup-cancel>";
      runtimeHarness.start(runtimeHarness.payload({ "/islands/cleanup-cancel.ts": loader }));

      await flush();
      const el = document.querySelector("cleanup-cancel")!;
      const removeSpy = spyOn(el, "removeEventListener");

      el.dispatchEvent(new Event("mouseenter"));
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
      const cleanupCalls = removeSpy.mock.calls.length;

      document.body.removeChild(el);
      mutations.remove(el);
      await flush();
      expect(removeSpy).toHaveBeenCalledTimes(cleanupCalls);

      removeSpy.mockRestore();
    });

    it("does not load when element is removed before interaction fires", async () => {
      const mutations = installMutationDriver(cleanups);
      const loader = mock(async () => {});

      document.body.innerHTML = "<cancel-interact client:interaction></cancel-interact>";
      runtimeHarness.start(runtimeHarness.payload({ "/islands/cancel-interact.ts": loader }));

      await flush();
      expect(loader).not.toHaveBeenCalled();

      const el = document.querySelector("cancel-interact")!;
      document.body.removeChild(el);
      mutations.remove(el);
      await flush();

      el.dispatchEvent(new Event("mouseenter"));
      await flush();
      expect(loader).not.toHaveBeenCalled();
    });

    it("combines with client:visible", async () => {
      const visibility = installVisibilityDriver(cleanups);
      const loader = mock(async () => {});

      document.body.innerHTML = "<combo-island client:visible client:interaction></combo-island>";
      runtimeHarness.start(runtimeHarness.payload({ "/islands/combo-island.ts": loader }));

      await flush();
      const el = document.querySelector("combo-island")!;
      el.dispatchEvent(new Event("mouseenter"));
      await flush();
      expect(loader).not.toHaveBeenCalled();

      visibility.trigger(el, true);
      await flush();
      expect(loader).not.toHaveBeenCalled();

      el.dispatchEvent(new Event("mouseenter"));
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("supports a custom attribute name", async () => {
      const loader = mock(async () => {});
      document.body.innerHTML = "<custom-attr-island data-lazy></custom-attr-island>";
      runtimeHarness.start(
        runtimeHarness.payload(
          { "/islands/custom-attr-island.ts": loader },
          { directives: { interaction: { attribute: "data-lazy" } } },
        ),
      );

      await flush();
      expect(loader).not.toHaveBeenCalled();
      document.querySelector("custom-attr-island")!.dispatchEvent(new Event("mouseenter"));
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
    });
  });
});
