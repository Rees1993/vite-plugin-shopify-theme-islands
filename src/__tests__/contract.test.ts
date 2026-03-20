/**
 * Boundary tests for the Plugin ↔ Runtime contract.
 *
 * Tests verify behavior through the contract’s public interface only:
 * key→tag semantics, options normalization, and payload → island map.
 * No Vite or DOM required.
 */
import { describe, it, expect } from "bun:test";
import {
  defaultKeyToTag,
  buildIslandMap,
  normalizeReviveOptions,
  DEFAULT_DIRECTIVES,
  type RevivePayload,
} from "../contract";
import { DEFAULT_INTERACTION_EVENTS } from "../interaction-events";

describe("contract", () => {
  describe("key→tag (path-like keys become tag names)", () => {
    it("path-like keys yield tag = last segment with extension stripped", () => {
      expect(defaultKeyToTag("/frontend/js/islands/product-form.ts").tag).toBe("product-form");
      expect(defaultKeyToTag("/islands/my-counter.js").tag).toBe("my-counter");
    });

    it("keys whose filename has no hyphen are marked skip so they are excluded from the map", () => {
      const r = defaultKeyToTag("/islands/myisland.ts");
      expect(r.tag).toBe("myisland");
      expect(r.skip).toBe(true);
    });

    it("keys whose filename contains a hyphen are included", () => {
      expect(defaultKeyToTag("/islands/my-island.ts").skip).toBe(false);
    });
  });

  describe("options normalization (defaults applied when options omitted or partial)", () => {
    it("undefined options receive full defaults for directives, retry, and debug", () => {
      const opts = normalizeReviveOptions(undefined);
      expect(opts.directives.visible.attribute).toBe("client:visible");
      expect(opts.directives.visible.rootMargin).toBe("200px");
      expect(opts.directives.idle.timeout).toBe(500);
      expect(opts.directives.interaction.events).toEqual(DEFAULT_INTERACTION_EVENTS);
      expect(opts.retry.retries).toBe(0);
      expect(opts.retry.delay).toBe(1000);
      expect(opts.debug).toBe(false);
    });

    it("partial options are merged with defaults so runtime never sees missing fields", () => {
      const opts = normalizeReviveOptions({
        directives: { idle: { timeout: 100 } },
        debug: true,
      });
      expect(opts.directives.visible.attribute).toBe("client:visible");
      expect(opts.directives.idle.timeout).toBe(100);
      expect(opts.debug).toBe(true);
    });

    it("options built from DEFAULT_DIRECTIVES (plugin merge with no overrides) normalize to same directives as undefined", () => {
      const fromPlugin = normalizeReviveOptions({ directives: DEFAULT_DIRECTIVES });
      const fromUndefined = normalizeReviveOptions(undefined);
      expect(fromPlugin.directives).toEqual(fromUndefined.directives);
    });
  });

  describe("payload → island map (buildIslandMap)", () => {
    it("payload with path-like island keys produces tag→loader map for valid tags", () => {
      const loader = async () => ({});
      const payload: RevivePayload = {
        islands: {
          "/islands/product-form.ts": loader,
          "/islands/cart-drawer.js": loader,
        },
        options: {},
      };
      const map = buildIslandMap(payload);
      expect(map.size).toBe(2);
      expect(map.get("product-form")).toBe(loader);
      expect(map.get("cart-drawer")).toBe(loader);
    });

    it("keys that do not yield a hyphenated tag are excluded from the map", () => {
      const loader = async () => ({});
      const payload: RevivePayload = {
        islands: {
          "/islands/valid-island.ts": loader,
          "/islands/invalid.ts": loader,
        },
        options: {},
      };
      const map = buildIslandMap(payload);
      expect(map.size).toBe(1);
      expect(map.has("valid-island")).toBe(true);
      expect(map.has("invalid")).toBe(false);
    });

    it("first key wins when multiple keys yield the same tag name", () => {
      const first = async () => ({});
      const second = async () => ({});
      const payload: RevivePayload = {
        islands: {
          "/islands/my-island.ts": first,
          "/components/my-island.js": second,
        },
        options: {},
      };
      const map = buildIslandMap(payload);
      expect(map.get("my-island")).toBe(first);
    });
  });
});
