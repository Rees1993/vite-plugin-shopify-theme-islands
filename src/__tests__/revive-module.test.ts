import { describe, it, expect } from "bun:test";
import { buildReviveModuleSource } from "../revive-module";

describe("revive-module", () => {
  describe("buildReviveModuleSource", () => {
    it("emits module that imports runtime and exports disconnect from _islands(payload)", () => {
      const out = buildReviveModuleSource({
        runtimePath: "/path/to/runtime.js",
        directoryGlobs: ["/islands/**/*.{ts,js}"],
        reviveOptions: { debug: false },
      });
      expect(out).toContain('import { revive as _islands } from "/path/to/runtime.js"');
      expect(out).toContain('import.meta.glob("/islands/**/*.{ts,js}")');
      expect(out).toContain("const payload = { islands, options };");
      expect(out).toContain("export const { disconnect } = _islands(payload);");
    });

    it("includes islands and options in payload", () => {
      const out = buildReviveModuleSource({
        runtimePath: "/r.js",
        directoryGlobs: ["/islands/**/*.{ts,js}"],
        islandPaths: ["/src/widget.ts"],
        reviveOptions: { debug: true, retry: { retries: 2 } },
      });
      expect(out).toContain('import.meta.glob("/islands/**/*.{ts,js}")');
      expect(out).toContain('import.meta.glob(["/src/widget.ts"])');
      expect(out).toContain('"debug":true');
      expect(out).toContain('"retries":2');
    });

    it("includes customDirectives and Map when customDirectives are provided", () => {
      const out = buildReviveModuleSource({
        runtimePath: "/r.js",
        directoryGlobs: ["/islands/**/*.{ts,js}"],
        customDirectives: [{ name: "client:hash", entrypoint: "/dir/hash.js" }],
        reviveOptions: {},
      });
      expect(out).toContain('import _directive0 from "/dir/hash.js";');
      expect(out).toContain("const customDirectives = new Map([");
      expect(out).toContain('  ["client:hash", _directive0]');
      expect(out).toContain("const payload = { islands, options, customDirectives };");
    });

    it("omits customDirectives from payload when customDirectives is empty", () => {
      const out = buildReviveModuleSource({
        runtimePath: "/r.js",
        directoryGlobs: ["/islands/**/*.{ts,js}"],
        customDirectives: [],
        reviveOptions: {},
      });
      expect(out).toContain("const payload = { islands, options };");
      expect(out).not.toContain("customDirectives");
    });
  });
});
