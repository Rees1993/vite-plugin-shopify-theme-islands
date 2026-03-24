import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createReviveBootstrapCompiler } from "../revive-bootstrap";
import { getIslandPathsForLoad } from "../discovery";
import { createRevivePluginSession } from "../revive-session";

describe("revive-bootstrap", () => {
  it("plans a semantic bootstrap artifact from resolved plugin state", async () => {
    const compiler = createReviveBootstrapCompiler(
      {
        resolveEntrypoint: async (entrypoint) => `/resolved/${entrypoint}`,
        toLoadPaths: getIslandPathsForLoad,
      },
      "/runtime.js",
    );

    const plan = await compiler.plan({
      root: "/project",
      directories: ["/islands/", "/components/"],
      islandFiles: new Set(["/project/src/widget.ts", "/project/src/other.js"]),
      customDirectives: [
        { name: "client:on-click", entrypoint: "./src/directives/on-click.ts" },
        { name: "client:hover", entrypoint: "./src/directives/hover.ts" },
      ],
      reviveOptions: {
        debug: true,
        retry: { retries: 2, delay: 500 },
        directiveTimeout: 100,
      },
    });

    expect(plan).toMatchObject({
      runtimePath: "/runtime.js",
      directoryGlobs: ["/islands/**/*.{ts,js}", "/components/**/*.{ts,js}"],
      islandPaths: ["/src/widget.ts", "/src/other.js"],
      customDirectives: [
        { name: "client:on-click", entrypoint: "/resolved/./src/directives/on-click.ts" },
        { name: "client:hover", entrypoint: "/resolved/./src/directives/hover.ts" },
      ],
      reviveOptions: {
        debug: true,
        retry: { retries: 2, delay: 500 },
        directiveTimeout: 100,
      },
    });
    const source = compiler.emit(plan);
    expect(source).toContain('import { revive as _islands } from "/runtime.js"');
    expect(source).toContain('import _directive0 from "/resolved/./src/directives/on-click.ts";');
    expect(source).toContain("const payload = { islands, options, customDirectives };");
    expect(source).toContain("export const { disconnect } = _islands(payload);");
  });

  it("renders the bootstrap source from a semantic plan", async () => {
    const compiler = createReviveBootstrapCompiler(
      {
        resolveEntrypoint: async (entrypoint) => `/resolved/${entrypoint}`,
        toLoadPaths: getIslandPathsForLoad,
      },
      "/runtime.js",
    );
    const plan = await compiler.plan({
      root: "/project",
      directories: ["/islands/"],
      islandFiles: new Set(["/project/src/widget.ts"]),
      customDirectives: [{ name: "client:on-click", entrypoint: "./src/directives/on-click.ts" }],
      reviveOptions: { debug: false },
    });

    const source = compiler.emit(plan);
    expect(source).toContain('import { revive as _islands } from "/runtime.js"');
    expect(source).toContain('import _directive0 from "/resolved/./src/directives/on-click.ts";');
    expect(source).toContain("const payload = { islands, options, customDirectives };");
  });

  describe("createRevivePluginSession", () => {
    let tmp: string;

    beforeEach(() => {
      tmp = mkdtempSync(join(tmpdir(), "revive-session-"));
    });

    afterEach(() => {
      rmSync(tmp, { recursive: true, force: true });
    });

    it("owns inventory state and emits the current revive artifact", async () => {
      const session = createRevivePluginSession({
        directories: ["/islands/"],
        directives: {},
        customDirectives: [{ name: "client:on-click", entrypoint: "./src/directives/on-click.ts" }],
        reviveOptions: { debug: false },
        debug: false,
        runtimePath: "/runtime.js",
        log() {},
      });

      session.configure({ root: tmp, aliases: [] });

      const islandsDir = join(tmp, "islands");
      mkdirSync(islandsDir);
      writeFileSync(
        join(islandsDir, "inside-widget.ts"),
        "export default class X extends HTMLElement {}",
      );
      writeFileSync(
        join(tmp, "outside-widget.ts"),
        'import Island from "vite-plugin-shopify-theme-islands/island";\nexport default class X extends Island(HTMLElement) {}',
      );

      session.buildStart();

      const addedFile = join(tmp, "watch-widget.ts");
      writeFileSync(
        addedFile,
        'import Island from "vite-plugin-shopify-theme-islands/island";\nexport default class X extends Island(HTMLElement) {}',
      );
      session.watchChange(addedFile, "create");

      const source = await session.load(async (entrypoint) => `/resolved/${entrypoint}`);
      expect(source).toContain('import.meta.glob("/islands/**/*.{ts,js}")');
      expect(source).toContain('import.meta.glob(["/outside-widget.ts","/watch-widget.ts"])');
      expect(source).toContain('import _directive0 from "/resolved/./src/directives/on-click.ts";');
      expect(source).toContain("const payload = { islands, options, customDirectives };");
    });
  });
});
