/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { revive } from "../runtime";
import type { ClientDirective } from "../index";
import type { ReviveOptions } from "../contract";
import { createRuntimeSuite, flush, mockMutationObserver } from "./harness";

const suite = createRuntimeSuite();

function payload(
  islands: Record<string, () => Promise<unknown>>,
  options?: ReviveOptions,
  customDirectives?: Map<string, ClientDirective>,
) {
  return suite.runtime.payload(islands, options, customDirectives);
}

describe("runtime bootstrap", () => {
  beforeEach(() => {
    suite.reset();
  });

  afterEach(() => {
    suite.cleanup();
  });

  describe("plugin–runtime contract boundary (tracer bullet)", () => {
    it("revive(payload) activates islands by tag and applies options when given payload shape the plugin emits", async () => {
      const loader = mock(async () => {});
      document.body.innerHTML = "<product-form></product-form>";
      const payload = {
        islands: { "/frontend/js/islands/product-form.ts": loader } as Record<
          string,
          () => Promise<unknown>
        >,
        options: { directives: { idle: { timeout: 100 } } },
      };
      suite.runtime.track(revive(payload));
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("revive(payload) returns the singleton helper surface", () => {
      const runtime = suite.runtime.track(
        revive({
          islands: { "/frontend/js/islands/product-form.ts": async () => {} },
        }),
      );

      expect(runtime).toEqual({
        disconnect: expect.any(Function),
        scan: expect.any(Function),
        observe: expect.any(Function),
        unobserve: expect.any(Function),
      });
    });
  });

  describe("payload-only contract", () => {
    it("throws a helpful error when called with the removed legacy signature", () => {
      expect(() =>
        revive({ "/islands/my-widget.ts": async () => {} } as unknown as Parameters<
          typeof revive
        >[0]),
      ).toThrow(/requires a RevivePayload object/);
    });
  });

  describe("islandMap", () => {
    it("warns and skips non-hyphenated filenames", () => {
      const spy = spyOn(console, "warn");
      suite.runtime.start(payload({ "/islands/myisland.ts": async () => {} }));
      expect(spy).toHaveBeenCalledWith(expect.stringContaining("must contain a hyphen"));
      spy.mockRestore();
    });

    it("loads an island that matches the tag name", async () => {
      const loader = mock(async () => {});
      document.body.innerHTML = "<my-island></my-island>";
      suite.runtime.start(payload({ "/islands/my-island.ts": loader }));
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("throws when multiple payload entries resolve to the same tag name", () => {
      const first = mock(async () => {});
      const second = mock(async () => {});
      expect(() =>
        suite.runtime.start(
          payload({
            "/islands/my-island.ts": first,
            "/components/my-island.ts": second,
          }),
        ),
      ).toThrow("Multiple island entrypoints resolve to <my-island>");
    });
  });

  describe("queued set", () => {
    it("prevents loading the same tag twice even when multiple elements exist", async () => {
      const loader = mock(async () => {});
      document.body.innerHTML = "<my-counter></my-counter><my-counter></my-counter>";
      suite.runtime.start(payload({ "/islands/my-counter.ts": loader }));
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("removes tag from queued on load failure, allowing retry on re-insertion", async () => {
      const spy = spyOn(console, "error");
      let moCallback: MutationCallback | undefined;
      suite.cleanups.track(
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

      let callCount = 0;
      const loader = mock(async () => {
        callCount++;
        if (callCount === 1) throw new Error("network error");
      });

      document.body.innerHTML = "<retry-island></retry-island>";
      suite.runtime.start(payload({ "/islands/retry-island.ts": loader }));
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to load"),
        expect.any(Error),
      );

      const el2 = document.createElement("retry-island");
      moCallback!(
        [{ addedNodes: [el2], removedNodes: [] } as unknown as MutationRecord],
        {} as MutationObserver,
      );
      await flush();
      expect(loader).toHaveBeenCalledTimes(2);

      spy.mockRestore();
    });

    it("does not retry on re-insertion when load succeeds", async () => {
      let moCallback: MutationCallback | undefined;
      suite.cleanups.track(
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

      const loader = mock(async () => {});

      document.body.innerHTML = "<no-retry-island></no-retry-island>";
      suite.runtime.start(payload({ "/islands/no-retry-island.ts": loader }));
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);

      const el2 = document.createElement("no-retry-island");
      moCallback!(
        [{ addedNodes: [el2], removedNodes: [] } as unknown as MutationRecord],
        {} as MutationObserver,
      );
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
    });
  });
});
