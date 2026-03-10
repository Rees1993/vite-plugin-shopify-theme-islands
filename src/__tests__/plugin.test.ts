import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import shopifyThemeIslands from "../index";
import type { ShopifyThemeIslandsOptions } from "../index";
import type { ResolvedConfig } from "vite";

const VIRTUAL_ID = "vite-plugin-shopify-theme-islands/revive";
const RESOLVED_ID = "\0" + VIRTUAL_ID;

function makeConfig(aliases: ResolvedConfig["resolve"]["alias"] = []): ResolvedConfig {
  return { root: "/project", resolve: { alias: aliases } } as unknown as ResolvedConfig;
}

interface PluginUnderTest {
  resolveId(id: string): string | undefined;
  configResolved(config: ResolvedConfig): void;
  buildStart(): void;
  load(id: string): Promise<string | undefined>;
  transform(code: string, id: string): void;
  watchChange(id: string, ctx: { event: string }): void;
}

function makePlugin(opts?: ShopifyThemeIslandsOptions): PluginUnderTest {
  return shopifyThemeIslands(opts) as unknown as PluginUnderTest;
}

describe("plugin", () => {
  describe("resolveId", () => {
    it("resolves the virtual revive ID", () => {
      const plugin = makePlugin();
      expect(plugin.resolveId(VIRTUAL_ID)).toBe(RESOLVED_ID);
    });

    it("returns undefined for unknown IDs", () => {
      const plugin = makePlugin();
      expect(plugin.resolveId("some-other-module")).toBeUndefined();
    });
  });

  describe("load", () => {
    it("returns undefined for non-virtual IDs", async () => {
      const plugin = makePlugin();
      plugin.configResolved(makeConfig());
      expect(await plugin.load("not-the-virtual-id")).toBeUndefined();
    });

    it("generates import.meta.glob for a single directory", async () => {
      const plugin = makePlugin({ directories: ["/islands/"] });
      plugin.configResolved(makeConfig());
      const output = await plugin.load(RESOLVED_ID);
      expect(output).toContain('import.meta.glob("/islands/**/*.{ts,js}")');
      expect(output).toContain("import { revive as _islands }");
      expect(output).toContain("_islands(islands, options)");
    });

    it("generates import.meta.glob for multiple directories", async () => {
      const plugin = makePlugin({ directories: ["/islands/", "/components/"] });
      plugin.configResolved(makeConfig());
      const output = await plugin.load(RESOLVED_ID);
      expect(output).toContain('import.meta.glob("/islands/**/*.{ts,js}")');
      expect(output).toContain('import.meta.glob("/components/**/*.{ts,js}")');
    });

    it("includes default directive config in options", async () => {
      const plugin = makePlugin({ directories: ["/islands/"] });
      plugin.configResolved(makeConfig());
      const output = await plugin.load(RESOLVED_ID);
      expect(output).toContain('"attribute":"client:visible"');
      expect(output).toContain('"rootMargin":"200px"');
      expect(output).toContain('"threshold":0');
      expect(output).toContain('"attribute":"client:idle"');
      expect(output).toContain('"timeout":500');
      expect(output).toContain('"attribute":"client:media"');
      expect(output).toContain('"attribute":"client:defer"');
      expect(output).toContain('"delay":3000');
    });

    it("merges custom visible config with defaults", async () => {
      const plugin = makePlugin({
        directories: ["/islands/"],
        directives: { visible: { rootMargin: "0px" } },
      });
      plugin.configResolved(makeConfig());
      const output = await plugin.load(RESOLVED_ID);
      expect(output).toContain('"rootMargin":"0px"');
      expect(output).toContain('"attribute":"client:visible"'); // default preserved
    });

    it("includes custom directive attribute names in options", async () => {
      const plugin = makePlugin({
        directories: ["/islands/"],
        directives: {
          visible: { attribute: "data:visible" },
          media:   { attribute: "data:media" },
          idle:    { attribute: "data:idle" },
        },
      });
      plugin.configResolved(makeConfig());
      const output = await plugin.load(RESOLVED_ID);
      expect(output).toContain('"attribute":"data:visible"');
      expect(output).toContain('"attribute":"data:media"');
      expect(output).toContain('"attribute":"data:idle"');
    });

    it("resolves Vite string aliases in directory paths", async () => {
      const plugin = makePlugin({ directories: ["@islands/"] });
      plugin.configResolved(
        makeConfig([{ find: "@islands", replacement: "/project/frontend/js/islands" }])
      );
      const output = await plugin.load(RESOLVED_ID);
      expect(output).toContain("/project/frontend/js/islands/");
      expect(output).not.toContain("@islands");
    });

    it("resolves Vite regex aliases in directory paths", async () => {
      const plugin = makePlugin({ directories: ["@islands/"] });
      plugin.configResolved(
        makeConfig([{ find: /^@islands/, replacement: "/project/frontend/js/islands" }])
      );
      const output = await plugin.load(RESOLVED_ID);
      expect(output).toContain("/project/frontend/js/islands/");
    });

    it("generates directive imports and Map for custom directives", async () => {
      const plugin = makePlugin({
        directories: ["/islands/"],
        clientDirectives: [
          { name: "client:on-click", entrypoint: "./src/directives/on-click.ts" },
          { name: "client:hover",    entrypoint: "./src/directives/hover.ts" },
        ],
      });
      plugin.configResolved(makeConfig());
      const ctx = {
        resolve: async (id: string) => ({ id: `/resolved/${id}` }),
      };
      const output = await (plugin.load as (this: typeof ctx, id: string) => Promise<string | undefined>).call(ctx, RESOLVED_ID);
      expect(output).toContain('import _directive0 from "/resolved/./src/directives/on-click.ts"');
      expect(output).toContain('import _directive1 from "/resolved/./src/directives/hover.ts"');
      expect(output).toContain('"client:on-click"');
      expect(output).toContain('"client:hover"');
      expect(output).toContain('new Map([');
      expect(output).toContain('_islands(islands, options, customDirectives)');
    });

    it("omits customDirectives arg when no clientDirectives are configured", async () => {
      const plugin = makePlugin({ directories: ["/islands/"] });
      plugin.configResolved(makeConfig());
      const output = await plugin.load(RESOLVED_ID);
      expect(output).toContain("_islands(islands, options)");
      expect(output).not.toContain("customDirectives");
    });

    it("throws when a custom directive entrypoint cannot be resolved", async () => {
      const plugin = makePlugin({
        directories: ["/islands/"],
        clientDirectives: [{ name: "client:on-click", entrypoint: "./nonexistent.ts" }],
      });
      plugin.configResolved(makeConfig());
      const ctx = { resolve: async () => null };
      await expect(
        (plugin.load as (this: typeof ctx, id: string) => Promise<string | undefined>).call(ctx, RESOLVED_ID)
      ).rejects.toThrow("Cannot resolve");
    });
  });

  describe("normalizeDir (via load output)", () => {
    it("adds a trailing slash if missing", async () => {
      const plugin = makePlugin({ directories: ["/islands"] });
      plugin.configResolved(makeConfig());
      const output = await plugin.load(RESOLVED_ID);
      expect(output).toContain('"/islands/**/*.{ts,js}"');
    });

    it("does not double-up an existing trailing slash", async () => {
      const plugin = makePlugin({ directories: ["/islands/"] });
      plugin.configResolved(makeConfig());
      const output = await plugin.load(RESOLVED_ID);
      expect(output).not.toContain('"/islands//**/*.{ts,js}"');
      expect(output).toContain('"/islands/**/*.{ts,js}"');
    });
  });

  describe("scanForIslandFiles / buildStart", () => {
    let tmp: string;

    beforeEach(() => {
      tmp = mkdtempSync(join(tmpdir(), "islands-"));
    });

    afterEach(() => {
      rmSync(tmp, { recursive: true, force: true });
    });

    it("includes mixin files discovered outside the islands directory", async () => {
      writeFileSync(
        join(tmp, "my-widget.ts"),
        'import Island from "vite-plugin-shopify-theme-islands/island";\nexport default class MyWidget extends Island(HTMLElement) {}'
      );

      const plugin = makePlugin({ directories: ["/nonexistent/"] });
      plugin.configResolved({ root: tmp, resolve: { alias: [] } } as unknown as ResolvedConfig);
      plugin.buildStart();
      const output = await plugin.load(RESOLVED_ID);
      expect(output).toContain("my-widget.ts");
    });

    it("excludes mixin files already covered by a scanned directory", async () => {
      const islandsDir = join(tmp, "islands");
      mkdirSync(islandsDir);
      writeFileSync(
        join(islandsDir, "my-widget.ts"),
        'import Island from "vite-plugin-shopify-theme-islands/island";\nexport default class MyWidget extends Island(HTMLElement) {}'
      );

      const plugin = makePlugin({ directories: ["/islands/"] });
      plugin.configResolved({ root: tmp, resolve: { alias: [] } } as unknown as ResolvedConfig);
      plugin.buildStart();
      const output = await plugin.load(RESOLVED_ID);
      // Only the directory glob should appear — no separate mixin glob
      const globCount = (output?.match(/import\.meta\.glob/g) ?? []).length;
      expect(globCount).toBe(1);
    });

    it("skips unreadable files silently", () => {
      const plugin = makePlugin({ directories: ["/nonexistent/"] });
      plugin.configResolved({ root: tmp, resolve: { alias: [] } } as unknown as ResolvedConfig);
      expect(() => plugin.buildStart()).not.toThrow();
    });
  });
});
