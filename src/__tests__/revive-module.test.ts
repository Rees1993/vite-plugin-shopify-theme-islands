import { describe, it, expect } from "bun:test";
import { buildReviveModuleSource } from "../revive-module";

describe("revive-module", () => {
  describe("buildReviveModuleSource", () => {
    it("emits module that imports runtime and exports the revive helper surface from _islands(payload)", () => {
      const out = buildReviveModuleSource({
        runtimePath: "/path/to/runtime.js",
        directoryGlobs: ["/islands/**/*.{ts,js}"],
        reviveOptions: { debug: false },
      });
      expect(out).toContain('import { revive as _islands } from "/path/to/runtime.js"');
      expect(out).toContain('import.meta.glob("/islands/**/*.{ts,js}")');
      expect(out).toContain("const payload = { islands, options };");
      expect(out).toContain('const runtimeKey = "__shopify_theme_islands_runtime__";');
      expect(out).toContain("const runtime = runtimeState.runtime ?? _islands(payload);");
      expect(out).toContain("import.meta.hot.accept();");
      expect(out).toContain("import.meta.hot.dispose(() => {");
      expect(out).toContain("export const { disconnect, scan, observe, unobserve } = runtime;");
    });

    it("guards the shared runtime singleton so multiple imports and HMR disposal do not tear down a newer runtime", () => {
      const out = buildReviveModuleSource({
        runtimePath: "/path/to/runtime.js",
        directoryGlobs: ["/islands/**/*.{ts,js}"],
        reviveOptions: { debug: false },
      });

      expect(out).toContain('const runtimeKey = "__shopify_theme_islands_runtime__";');
      expect(out).toContain("const runtimeState = (globalThis[runtimeKey] ??= {});");
      expect(out).toContain("const runtime = runtimeState.runtime ?? _islands(payload);");
      expect(out).toContain("runtimeState.runtime = runtime;");
      expect(out).toContain("if (runtimeState.runtime === runtime) {");
      expect(out).toContain("runtime.disconnect();");
      expect(out).toContain("delete runtimeState.runtime;");
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
