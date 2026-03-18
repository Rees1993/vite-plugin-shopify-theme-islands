import { describe, it, expect } from "bun:test";
import { buildReviveModuleSource } from "../revive-module";

describe("revive-module", () => {
  describe("buildReviveModuleSource", () => {
    it("emits module that imports runtime and exports disconnect from _islands(payload)", () => {
      const out = buildReviveModuleSource({
        runtimePath: "/path/to/runtime.js",
        directiveImportLines: [],
        islandsObjectExpr: "Object.assign({}, {})",
        customDirectivesMapLines: null,
        reviveOptions: { debug: false },
      });
      expect(out).toContain('import { revive as _islands } from "/path/to/runtime.js"');
      expect(out).toContain("const payload = { islands, options };");
      expect(out).toContain("export const { disconnect } = _islands(payload);");
    });

    it("includes islands and options in payload", () => {
      const out = buildReviveModuleSource({
        runtimePath: "/r.js",
        directiveImportLines: [],
        islandsObjectExpr: "Object.assign({}, __GLOB__)",
        customDirectivesMapLines: null,
        reviveOptions: { debug: true, retry: { retries: 2 } },
      });
      expect(out).toContain("const islands = Object.assign({}, __GLOB__);");
      expect(out).toContain('"debug":true');
      expect(out).toContain('"retries":2');
    });

    it("includes customDirectives and Map when customDirectivesMapLines provided", () => {
      const out = buildReviveModuleSource({
        runtimePath: "/r.js",
        directiveImportLines: ['import _d0 from "/dir/hash.js";'],
        islandsObjectExpr: "{}",
        customDirectivesMapLines: ['  ["client:hash", _d0]'],
        reviveOptions: {},
      });
      expect(out).toContain('import _d0 from "/dir/hash.js";');
      expect(out).toContain("const customDirectives = new Map([");
      expect(out).toContain('  ["client:hash", _d0]');
      expect(out).toContain("const payload = { islands, options, customDirectives };");
    });

    it("omits customDirectives from payload when customDirectivesMapLines is empty", () => {
      const out = buildReviveModuleSource({
        runtimePath: "/r.js",
        directiveImportLines: [],
        islandsObjectExpr: "{}",
        customDirectivesMapLines: [],
        reviveOptions: {},
      });
      expect(out).toContain("const payload = { islands, options };");
      expect(out).not.toContain("customDirectives");
    });
  });
});
