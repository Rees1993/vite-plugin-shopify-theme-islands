import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import shopifyThemeIslands from "../index";
import type { ShopifyThemeIslandsOptions } from "../index";
import type { ResolvedConfig, ViteDevServer } from "vite";

const VIRTUAL_ID = "vite-plugin-shopify-theme-islands/revive";
const RESOLVED_ID = "\0" + VIRTUAL_ID;
const ISLAND_CONTENT =
  'import Island from "vite-plugin-shopify-theme-islands/island";\nexport default class X extends Island(HTMLElement) {}';

function makeConfig(aliases: ResolvedConfig["resolve"]["alias"] = []): ResolvedConfig {
  return { root: "/project", resolve: { alias: aliases } } as unknown as ResolvedConfig;
}

interface PluginUnderTest {
  resolveId(id: string): string | undefined;
  configResolved(config: ResolvedConfig): void;
  configureServer(server: ViteDevServer): void;
  buildStart(): void;
  load(id: string): Promise<string | undefined>;
  transform(code: string, id: string): void;
  watchChange(id: string, ctx: { event: string }): void;
}

function makePlugin(opts?: ShopifyThemeIslandsOptions): PluginUnderTest {
  return shopifyThemeIslands(opts) as unknown as PluginUnderTest;
}

describe("plugin", () => {
  describe("validateOptions", () => {
    it("surfaces config-policy validation errors during plugin creation", () => {
      expect(() => makePlugin({ directories: [] })).toThrow('"directories" must not be empty');
      expect(() =>
        makePlugin({
          directives: {
            interaction: { events: ["mouseenter", "click"] as unknown as never[] },
          },
        }),
      ).toThrow('"directives.interaction.events" contains unsupported event "click"');
    });
  });

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
      expect(output).toContain("export const { disconnect, scan, observe, unobserve } = runtime");
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

    it("includes retry config in options when set", async () => {
      const plugin = makePlugin({ directories: ["/islands/"], retry: { retries: 2, delay: 500 } });
      plugin.configResolved(makeConfig());
      const output = await plugin.load(RESOLVED_ID);
      expect(output).toContain('"retry"');
      expect(output).toContain('"retries":2');
      expect(output).toContain('"delay":500');
    });

    it("omits retry from options when not configured", async () => {
      const plugin = makePlugin({ directories: ["/islands/"] });
      plugin.configResolved(makeConfig());
      const output = await plugin.load(RESOLVED_ID);
      expect(output).not.toContain('"retry"');
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
          media: { attribute: "data:media" },
          idle: { attribute: "data:idle" },
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
        makeConfig([{ find: "@islands", replacement: "/project/frontend/js/islands" }]),
      );
      const output = await plugin.load(RESOLVED_ID);
      expect(output).toContain("/project/frontend/js/islands/");
      expect(output).not.toContain("@islands");
    });

    it("resolves more-specific string alias before shorter overlapping prefix", async () => {
      const plugin = makePlugin({ directories: ["@islands/"] });
      plugin.configResolved(
        makeConfig([
          { find: "@", replacement: "/project/src" },
          { find: "@islands", replacement: "/project/frontend/js/islands" },
        ]),
      );
      const output = await plugin.load(RESOLVED_ID);
      // "@islands" must win over "@" — would produce "/project/src/islands/" if wrong
      expect(output).toContain("/project/frontend/js/islands/");
      expect(output).not.toContain("/project/src/islands");
    });

    it("resolves Vite regex aliases in directory paths", async () => {
      const plugin = makePlugin({ directories: ["@islands/"] });
      plugin.configResolved(
        makeConfig([{ find: /^@islands/, replacement: "/project/frontend/js/islands" }]),
      );
      const output = await plugin.load(RESOLVED_ID);
      expect(output).toContain("/project/frontend/js/islands/");
    });

    it("generates directive imports and Map for custom directives", async () => {
      const plugin = makePlugin({
        directories: ["/islands/"],
        directives: {
          custom: [
            { name: "client:on-click", entrypoint: "./src/directives/on-click.ts" },
            { name: "client:hover", entrypoint: "./src/directives/hover.ts" },
          ],
        },
      });
      plugin.configResolved(makeConfig());
      const ctx = {
        resolve: async (id: string) => ({ id: `/resolved/${id}` }),
      };
      const output = await (
        plugin.load as (this: typeof ctx, id: string) => Promise<string | undefined>
      ).call(ctx, RESOLVED_ID);
      expect(output).toContain('import _directive0 from "/resolved/./src/directives/on-click.ts"');
      expect(output).toContain('import _directive1 from "/resolved/./src/directives/hover.ts"');
      expect(output).toContain('"client:on-click"');
      expect(output).toContain('"client:hover"');
      expect(output).toContain("new Map([");
      expect(output).toContain("export const { disconnect, scan, observe, unobserve } = runtime");
    });

    it("omits customDirectives arg when no custom directives are configured", async () => {
      const plugin = makePlugin({ directories: ["/islands/"] });
      plugin.configResolved(makeConfig());
      const output = await plugin.load(RESOLVED_ID);
      expect(output).toContain("export const { disconnect, scan, observe, unobserve } = runtime");
      expect(output).not.toContain("customDirectives");
    });

    it("throws when a custom directive entrypoint cannot be resolved", async () => {
      const plugin = makePlugin({
        directories: ["/islands/"],
        directives: { custom: [{ name: "client:on-click", entrypoint: "./nonexistent.ts" }] },
      });
      plugin.configResolved(makeConfig());
      const ctx = { resolve: async () => null };
      await expect(
        (plugin.load as (this: typeof ctx, id: string) => Promise<string | undefined>).call(
          ctx,
          RESOLVED_ID,
        ),
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
      writeFileSync(join(tmp, "my-widget.ts"), ISLAND_CONTENT);

      const plugin = makePlugin({ directories: ["/nonexistent/"] });
      plugin.configResolved({ root: tmp, resolve: { alias: [] } } as unknown as ResolvedConfig);
      plugin.buildStart();
      const output = await plugin.load(RESOLVED_ID);
      expect(output).toContain("my-widget.ts");
    });

    it("emits resolvedTags overrides when resolveTag is configured", async () => {
      const islandsDir = join(tmp, "islands");
      mkdirSync(islandsDir);
      writeFileSync(
        join(islandsDir, "productForm.ts"),
        "export default class ProductForm extends HTMLElement {}",
      );

      const plugin = makePlugin({
        directories: ["/islands/"],
        resolveTag: ({ filePath, defaultTag }) =>
          filePath.endsWith("productForm.ts") ? "product-form" : defaultTag,
      });
      plugin.configResolved({ root: tmp, resolve: { alias: [] } } as unknown as ResolvedConfig);
      plugin.buildStart();
      const output = await plugin.load(RESOLVED_ID);

      expect(output).toContain('const resolvedTags = {"/islands/productForm.ts":"product-form"};');
      expect(output).toContain("const payload = { islands, options, resolvedTags };");
    });

    it("emits false resolvedTags entries when resolveTag excludes a file", async () => {
      const islandsDir = join(tmp, "islands");
      mkdirSync(islandsDir);
      writeFileSync(
        join(islandsDir, "legacy-widget.ts"),
        "export default class LegacyWidget extends HTMLElement {}",
      );

      const plugin = makePlugin({
        directories: ["/islands/"],
        resolveTag: ({ filePath, defaultTag }) =>
          filePath.endsWith("legacy-widget.ts") ? false : defaultTag,
      });
      plugin.configResolved({ root: tmp, resolve: { alias: [] } } as unknown as ResolvedConfig);
      plugin.buildStart();
      const output = await plugin.load(RESOLVED_ID);

      expect(output).toContain('const resolvedTags = {"/islands/legacy-widget.ts":false};');
      expect(output).toContain("const payload = { islands, options, resolvedTags };");
    });

    it("excludes mixin files already covered by a scanned directory", async () => {
      const islandsDir = join(tmp, "islands");
      mkdirSync(islandsDir);
      writeFileSync(join(islandsDir, "my-widget.ts"), ISLAND_CONTENT);

      const plugin = makePlugin({ directories: ["/islands/"] });
      plugin.configResolved({ root: tmp, resolve: { alias: [] } } as unknown as ResolvedConfig);
      plugin.buildStart();
      const output = await plugin.load(RESOLVED_ID);
      // Only the directory glob should appear — no separate mixin glob
      const globCount = (output?.match(/import\.meta\.glob/g) ?? []).length;
      expect(globCount).toBe(1);
    });

    it("does not exclude sibling directories that only share the same prefix", async () => {
      const legacyDir = join(tmp, "islands-legacy");
      mkdirSync(legacyDir);
      writeFileSync(join(legacyDir, "legacy-widget.ts"), ISLAND_CONTENT);

      const plugin = makePlugin({ directories: ["/islands/"] });
      plugin.configResolved({ root: tmp, resolve: { alias: [] } } as unknown as ResolvedConfig);
      plugin.buildStart();
      const output = await plugin.load(RESOLVED_ID);
      expect(output).toContain("/islands-legacy/legacy-widget.ts");
    });

    it("warns when a file's resolved tag disagrees with a static customElements.define() tag", async () => {
      const islandsDir = join(tmp, "islands");
      mkdirSync(islandsDir);
      writeFileSync(
        join(islandsDir, "product-form.ts"),
        'class ProductForm extends HTMLElement {}\ncustomElements.define("x-product-form", ProductForm);',
      );
      const warn = spyOn(console, "warn").mockImplementation(mock(() => {}));

      try {
        const plugin = makePlugin({ directories: ["/islands/"] });
        plugin.configResolved({ root: tmp, resolve: { alias: [] } } as unknown as ResolvedConfig);
        plugin.buildStart();
        await plugin.load(RESOLVED_ID);

        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining(
            "resolves to <product-form> but statically registers <x-product-form>",
          ),
        );
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("/islands/product-form.ts"));
      } finally {
        warn.mockRestore();
      }
    });

    it("throws when a scanned file and a mixin file resolve to the same final tag", async () => {
      const islandsDir = join(tmp, "islands");
      const srcDir = join(tmp, "src");
      mkdirSync(islandsDir);
      mkdirSync(srcDir);
      writeFileSync(
        join(islandsDir, "product-form.ts"),
        "export default class ProductForm extends HTMLElement {}",
      );
      writeFileSync(join(srcDir, "product-form.ts"), ISLAND_CONTENT);

      const plugin = makePlugin({ directories: ["/islands/"] });
      plugin.configResolved({ root: tmp, resolve: { alias: [] } } as unknown as ResolvedConfig);
      plugin.buildStart();

      await expect(plugin.load(RESOLVED_ID)).rejects.toThrow(
        "Multiple island entrypoints resolve to <product-form>",
      );
    });
  });

  describe("watchChange", () => {
    let tmp: string;

    beforeEach(() => {
      tmp = mkdtempSync(join(tmpdir(), "islands-wc-"));
    });

    afterEach(() => {
      rmSync(tmp, { recursive: true, force: true });
    });

    function makeWatchPlugin(islandsDir = "/nonexistent/") {
      const plugin = makePlugin({ directories: [islandsDir] });
      plugin.configResolved({ root: tmp, resolve: { alias: [] } } as unknown as ResolvedConfig);
      plugin.buildStart();
      return plugin;
    }

    it("create event with island import outside directory adds file to islandFiles", async () => {
      const filePath = join(tmp, "watch-widget.ts");
      writeFileSync(filePath, ISLAND_CONTENT);
      const plugin = makeWatchPlugin();
      plugin.watchChange(filePath, { event: "create" });
      const output = await plugin.load(RESOLVED_ID);
      expect(output).toContain("watch-widget.ts");
    });

    it("create event for file inside scanned directory does not add to islandFiles", async () => {
      const islandsDir = join(tmp, "islands");
      mkdirSync(islandsDir);
      const filePath = join(islandsDir, "scanned-widget.ts");
      writeFileSync(filePath, ISLAND_CONTENT);
      const plugin = makeWatchPlugin("/islands/");
      plugin.watchChange(filePath, { event: "create" });
      const output = await plugin.load(RESOLVED_ID);
      // Only the directory glob — no second import.meta.glob for individual file
      const globCount = (output?.match(/import\.meta\.glob/g) ?? []).length;
      expect(globCount).toBe(1);
    });

    it("invalidates and reloads the revive module when the island set changes", () => {
      const invalidated: object[] = [];
      const reloaded: object[] = [];
      const reviveModule = {};
      const plugin = makeWatchPlugin();
      plugin.configureServer({
        moduleGraph: {
          getModuleById(id: string) {
            return id === RESOLVED_ID ? reviveModule : undefined;
          },
          invalidateModule(mod: object) {
            invalidated.push(mod);
          },
        },
        reloadModule(mod: object) {
          reloaded.push(mod);
          return Promise.resolve();
        },
      } as unknown as ViteDevServer);

      const filePath = join(tmp, "hmr-widget.ts");
      writeFileSync(filePath, ISLAND_CONTENT);
      plugin.watchChange(filePath, { event: "create" });

      expect(invalidated).toEqual([reviveModule]);
      expect(reloaded).toEqual([reviveModule]);
    });

    it("does not trigger a reload when the revive module is not in the graph", () => {
      let invalidated = false;
      let reloaded = false;
      const plugin = makeWatchPlugin();
      plugin.configureServer({
        moduleGraph: {
          getModuleById() {
            return undefined;
          },
          invalidateModule() {
            invalidated = true;
          },
        },
        reloadModule() {
          reloaded = true;
          return Promise.resolve();
        },
      } as unknown as ViteDevServer);

      const filePath = join(tmp, "hmr-widget.ts");
      writeFileSync(filePath, ISLAND_CONTENT);
      plugin.watchChange(filePath, { event: "create" });

      expect(invalidated).toBe(false);
      expect(reloaded).toBe(false);
    });
  });
});
