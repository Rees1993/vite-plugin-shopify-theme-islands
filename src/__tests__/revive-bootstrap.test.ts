import { describe, it, expect } from "bun:test";
import { createReviveBootstrapCompiler } from "../revive-bootstrap";
import { getIslandPathsForLoad } from "../discovery";

describe("revive-bootstrap", () => {
  it("plans a semantic bootstrap artifact from resolved plugin state", async () => {
    const seen: Array<{ filePath: string; defaultTag: string }> = [];
    const compiler = createReviveBootstrapCompiler(
      {
        toLoadPaths: getIslandPathsForLoad,
      },
      "/runtime.js",
    );

    const plan = await compiler.plan(
      {
        root: "/project",
        directories: ["/islands/", "/components/"],
        directoryFiles: new Set(["/project/islands/productForm.ts"]),
        islandFiles: new Set(["/project/src/widget.ts", "/project/src/other.js"]),
        resolveTag: ({ filePath, defaultTag }) => {
          seen.push({ filePath, defaultTag });
          if (filePath.endsWith("productForm.ts")) return "product-form";
          if (filePath.endsWith("other.js")) return false;
          return defaultTag;
        },
        customDirectives: [
          { name: "client:on-click", entrypoint: "./src/directives/on-click.ts" },
          { name: "client:hover", entrypoint: "./src/directives/hover.ts" },
        ],
        reviveOptions: {
          debug: true,
          retry: { retries: 2, delay: 500 },
          directiveTimeout: 100,
        },
      },
      { resolveEntrypoint: async (entrypoint) => `/resolved/${entrypoint}` },
    );

    expect(seen).toEqual([
      { filePath: "/islands/productForm.ts", defaultTag: "productForm" },
      { filePath: "/src/widget.ts", defaultTag: "widget" },
      { filePath: "/src/other.js", defaultTag: "other" },
    ]);
    expect(plan).toMatchObject({
      runtimePath: "/runtime.js",
      directoryGlobs: ["/islands/**/*.{ts,js}", "/components/**/*.{ts,js}"],
      islandPaths: ["/src/widget.ts", "/src/other.js"],
      resolvedTags: {
        "/islands/productForm.ts": "product-form",
        "/src/other.js": false,
      },
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
    expect(source).toContain(
      "const payload = { islands, options, customDirectives, resolvedTags };",
    );
    expect(source).toContain(
      'const resolvedTags = {"/islands/productForm.ts":"product-form","/src/other.js":false};',
    );
    expect(source).toContain('const runtimeKey = "__shopify_theme_islands_runtime__";');
    expect(source).toContain("const runtime = runtimeState.runtime ?? _islands(payload);");
    expect(source).toContain("import.meta.hot.accept();");
    expect(source).toContain("export const { disconnect, scan, observe, unobserve } = runtime;");
  });

  it("renders the bootstrap source from a semantic plan", async () => {
    const compiler = createReviveBootstrapCompiler(
      {
        toLoadPaths: getIslandPathsForLoad,
      },
      "/runtime.js",
    );
    const plan = await compiler.plan(
      {
        root: "/project",
        directories: ["/islands/"],
        directoryFiles: new Set<string>(),
        islandFiles: new Set(["/project/src/widget.ts"]),
        customDirectives: [{ name: "client:on-click", entrypoint: "./src/directives/on-click.ts" }],
        reviveOptions: { debug: false },
      },
      { resolveEntrypoint: async (entrypoint) => `/resolved/${entrypoint}` },
    );

    const source = compiler.emit(plan);
    expect(source).toContain('import { revive as _islands } from "/runtime.js"');
    expect(source).toContain('import _directive0 from "/resolved/./src/directives/on-click.ts";');
    expect(source).toContain("const payload = { islands, options, customDirectives };");
  });

  it("compiles bootstrap source through one compiler operation", async () => {
    const compiler = createReviveBootstrapCompiler(
      {
        toLoadPaths: getIslandPathsForLoad,
      },
      "/runtime.js",
    );

    const source = await compiler.compile(
      {
        root: "/project",
        directories: ["/islands/"],
        directoryFiles: new Set<string>(),
        islandFiles: new Set(["/project/src/widget.ts"]),
        customDirectives: [{ name: "client:on-click", entrypoint: "./src/directives/on-click.ts" }],
        reviveOptions: { debug: false },
      },
      { resolveEntrypoint: async (entrypoint) => `/resolved/${entrypoint}` },
    );

    expect(source).toContain('import { revive as _islands } from "/runtime.js"');
    expect(source).toContain('import _directive0 from "/resolved/./src/directives/on-click.ts";');
    expect(source).toContain("const payload = { islands, options, customDirectives };");
  });

  it("omits default-tag mappings when resolveTag returns defaultTag", async () => {
    const compiler = createReviveBootstrapCompiler(
      {
        toLoadPaths: getIslandPathsForLoad,
      },
      "/runtime.js",
    );

    const plan = await compiler.plan(
      {
        root: "/project",
        directories: ["/islands/"],
        directoryFiles: new Set(["/project/islands/productForm.ts"]),
        islandFiles: new Set(["/project/src/widget.ts"]),
        resolveTag: ({ defaultTag }) => defaultTag,
        reviveOptions: { debug: false },
      },
      { resolveEntrypoint: async (entrypoint) => `/resolved/${entrypoint}` },
    );

    expect(plan.resolvedTags).toBeNull();
  });

  it("throws when two discovered files resolve to the same final tag", async () => {
    const compiler = createReviveBootstrapCompiler(
      {
        toLoadPaths: getIslandPathsForLoad,
      },
      "/runtime.js",
    );

    await expect(
      compiler.plan(
        {
          root: "/project",
          directories: ["/islands/"],
          directoryFiles: new Set(["/project/islands/product-form.ts"]),
          islandFiles: new Set(["/project/src/productForm.ts"]),
          resolveTag: ({ filePath, defaultTag }) =>
            filePath.endsWith("productForm.ts") ? "product-form" : defaultTag,
          reviveOptions: { debug: false },
        },
        { resolveEntrypoint: async (entrypoint) => `/resolved/${entrypoint}` },
      ),
    ).rejects.toThrow("Multiple island entrypoints resolve to <product-form>");
  });
});
