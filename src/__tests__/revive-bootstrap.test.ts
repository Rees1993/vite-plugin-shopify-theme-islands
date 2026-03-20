import { describe, it, expect } from "bun:test";
import { createReviveBootstrapCompiler } from "../revive-bootstrap";
import { getIslandPathsForLoad } from "../discovery";

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
    expect(source).toContain(
      'import _directive0 from "/resolved/./src/directives/on-click.ts";',
    );
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
    expect(source).toContain(
      'import _directive0 from "/resolved/./src/directives/on-click.ts";',
    );
    expect(source).toContain("const payload = { islands, options, customDirectives };");
  });
});
