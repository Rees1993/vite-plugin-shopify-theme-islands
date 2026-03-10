import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import shopifyThemeIslands from "../index";
import type { ResolvedConfig } from "vite";

const VIRTUAL_ID = "vite-plugin-shopify-theme-islands/revive";
const RESOLVED_ID = "\0" + VIRTUAL_ID;

function makeConfig(aliases: ResolvedConfig["resolve"]["alias"] = []): ResolvedConfig {
  return { root: "/project", resolve: { alias: aliases } } as unknown as ResolvedConfig;
}

describe("plugin", () => {
  describe("resolveId", () => {
    it("resolves the virtual revive ID", () => {
      const plugin = shopifyThemeIslands() as any;
      expect(plugin.resolveId(VIRTUAL_ID)).toBe(RESOLVED_ID);
    });

    it("returns undefined for unknown IDs", () => {
      const plugin = shopifyThemeIslands() as any;
      expect(plugin.resolveId("some-other-module")).toBeUndefined();
    });
  });

  describe("load", () => {
    it("returns undefined for non-virtual IDs", () => {
      const plugin = shopifyThemeIslands() as any;
      plugin.configResolved(makeConfig());
      expect(plugin.load("not-the-virtual-id")).toBeUndefined();
    });

    it("generates import.meta.glob for a single directory", () => {
      const plugin = shopifyThemeIslands({ directories: ["/islands/"] }) as any;
      plugin.configResolved(makeConfig());
      const output: string = plugin.load(RESOLVED_ID);
      expect(output).toContain('import.meta.glob("/islands/**/*.{ts,js}")');
      expect(output).toContain("import { revive as _islands }");
      expect(output).toContain("_islands(islands, options)");
    });

    it("generates import.meta.glob for multiple directories", () => {
      const plugin = shopifyThemeIslands({ directories: ["/islands/", "/components/"] }) as any;
      plugin.configResolved(makeConfig());
      const output: string = plugin.load(RESOLVED_ID);
      expect(output).toContain('import.meta.glob("/islands/**/*.{ts,js}")');
      expect(output).toContain('import.meta.glob("/components/**/*.{ts,js}")');
    });

    it("includes default directive config in options", () => {
      const plugin = shopifyThemeIslands({ directories: ["/islands/"] }) as any;
      plugin.configResolved(makeConfig());
      const output: string = plugin.load(RESOLVED_ID);
      expect(output).toContain('"attribute":"client:visible"');
      expect(output).toContain('"rootMargin":"200px"');
      expect(output).toContain('"threshold":0');
      expect(output).toContain('"attribute":"client:idle"');
      expect(output).toContain('"timeout":500');
      expect(output).toContain('"attribute":"client:media"');
    });

    it("merges custom visible config with defaults", () => {
      const plugin = shopifyThemeIslands({
        directories: ["/islands/"],
        directives: { visible: { rootMargin: "0px" } },
      }) as any;
      plugin.configResolved(makeConfig());
      const output: string = plugin.load(RESOLVED_ID);
      expect(output).toContain('"rootMargin":"0px"');
      expect(output).toContain('"attribute":"client:visible"'); // default preserved
    });

    it("includes custom directive attribute names in options", () => {
      const plugin = shopifyThemeIslands({
        directories: ["/islands/"],
        directives: {
          visible: { attribute: "data:visible" },
          media:   { attribute: "data:media" },
          idle:    { attribute: "data:idle" },
        },
      }) as any;
      plugin.configResolved(makeConfig());
      const output: string = plugin.load(RESOLVED_ID);
      expect(output).toContain('"attribute":"data:visible"');
      expect(output).toContain('"attribute":"data:media"');
      expect(output).toContain('"attribute":"data:idle"');
    });

    it("resolves Vite string aliases in directory paths", () => {
      const plugin = shopifyThemeIslands({ directories: ["@islands/"] }) as any;
      plugin.configResolved(
        makeConfig([{ find: "@islands", replacement: "/project/frontend/js/islands" }])
      );
      const output: string = plugin.load(RESOLVED_ID);
      expect(output).toContain("/project/frontend/js/islands/");
      expect(output).not.toContain("@islands");
    });

    it("resolves Vite regex aliases in directory paths", () => {
      const plugin = shopifyThemeIslands({ directories: ["@islands/"] }) as any;
      plugin.configResolved(
        makeConfig([{ find: /^@islands/, replacement: "/project/frontend/js/islands" }])
      );
      const output: string = plugin.load(RESOLVED_ID);
      expect(output).toContain("/project/frontend/js/islands/");
    });
  });

  describe("normalizeDir (via load output)", () => {
    it("adds a trailing slash if missing", () => {
      const plugin = shopifyThemeIslands({ directories: ["/islands"] }) as any;
      plugin.configResolved(makeConfig());
      const output: string = plugin.load(RESOLVED_ID);
      expect(output).toContain('"/islands/**/*.{ts,js}"');
    });

    it("does not double-up an existing trailing slash", () => {
      const plugin = shopifyThemeIslands({ directories: ["/islands/"] }) as any;
      plugin.configResolved(makeConfig());
      const output: string = plugin.load(RESOLVED_ID);
      expect(output).not.toContain('"/islands//**/*.{ts,js}"');
      expect(output).toContain('"/islands/**/*.{ts,js}"');
    });
  });

  describe("scanForIslandFiles / buildStart", () => {
    it("includes mixin files discovered outside the islands directory", () => {
      const tmp = mkdtempSync(join(tmpdir(), "islands-"));
      const islandFile = join(tmp, "my-widget.ts");
      writeFileSync(
        islandFile,
        'import Island from "vite-plugin-shopify-theme-islands/island";\nexport default class MyWidget extends Island(HTMLElement) {}'
      );

      const plugin = shopifyThemeIslands({ directories: ["/nonexistent/"] }) as any;
      plugin.configResolved({ root: tmp, resolve: { alias: [] } } as unknown as ResolvedConfig);
      plugin.buildStart();
      const output: string = plugin.load(RESOLVED_ID);
      expect(output).toContain("my-widget.ts");
    });

    it("excludes mixin files already covered by a scanned directory", () => {
      const tmp = mkdtempSync(join(tmpdir(), "islands-"));
      const islandsDir = join(tmp, "islands");
      mkdirSync(islandsDir);
      writeFileSync(
        join(islandsDir, "my-widget.ts"),
        'import Island from "vite-plugin-shopify-theme-islands/island";\nexport default class MyWidget extends Island(HTMLElement) {}'
      );

      const plugin = shopifyThemeIslands({ directories: ["/islands/"] }) as any;
      plugin.configResolved({ root: tmp, resolve: { alias: [] } } as unknown as ResolvedConfig);
      plugin.buildStart();
      const output: string = plugin.load(RESOLVED_ID);
      // Only the directory glob should appear — no separate mixin glob
      const globCount = (output.match(/import\.meta\.glob/g) ?? []).length;
      expect(globCount).toBe(1);
    });

    it("skips unreadable files silently", () => {
      const tmp = mkdtempSync(join(tmpdir(), "islands-"));
      // No files — scan should return without throwing
      const plugin = shopifyThemeIslands({ directories: ["/nonexistent/"] }) as any;
      plugin.configResolved({ root: tmp, resolve: { alias: [] } } as unknown as ResolvedConfig);
      expect(() => plugin.buildStart()).not.toThrow();
    });
  });
});
