import { describe, it, expect } from "bun:test";
import { createReviveCompiler } from "../revive-compile";
import { getIslandPathsForLoad } from "../discovery";

describe("revive-compile", () => {
  describe("tagSource: registeredTag", () => {
    it("defaults to registeredTag mode when tagSource is omitted", async () => {
      const compiler = createReviveCompiler(
        {
          toLoadPaths: getIslandPathsForLoad,
          readFile: (path) =>
            path.endsWith("CartDrawer.ts")
              ? 'customElements.define("cart-drawer", CartDrawer)'
              : null,
        },
        "/runtime.js",
      );

      const seen: string[] = [];
      await compiler.plan({
        root: "/project",
        directories: ["/islands/"],
        directoryFiles: new Set(["/project/islands/CartDrawer.ts"]),
        islandFiles: new Set(),
        resolveTag: ({ defaultTag }) => {
          seen.push(defaultTag);
          return defaultTag;
        },
        reviveOptions: { debug: false },
      });

      expect(seen).toEqual(["cart-drawer"]);
    });

    it("does not count line-commented customElements.define as a Registered Tag", async () => {
      const compiler = createReviveCompiler(
        {
          toLoadPaths: getIslandPathsForLoad,
          readFile: () =>
            '// customElements.define("old-tag", CartDrawer)\ncustomElements.define("cart-drawer", CartDrawer)',
        },
        "/runtime.js",
      );

      const plan = await compiler.plan({
        root: "/project",
        directories: ["/islands/"],
        directoryFiles: new Set(["/project/islands/CartDrawer.ts"]),
        islandFiles: new Set(),
        reviveOptions: { debug: false },
      });

      expect(plan.resolvedTags).toEqual({ "/islands/CartDrawer.ts": "cart-drawer" });
    });

    it("does not count block-commented customElements.define as a Registered Tag", async () => {
      const compiler = createReviveCompiler(
        {
          toLoadPaths: getIslandPathsForLoad,
          readFile: () =>
            '/* customElements.define("old-tag", CartDrawer) */\ncustomElements.define("cart-drawer", CartDrawer)',
        },
        "/runtime.js",
      );

      const plan = await compiler.plan({
        root: "/project",
        directories: ["/islands/"],
        directoryFiles: new Set(["/project/islands/CartDrawer.ts"]),
        islandFiles: new Set(),
        reviveOptions: { debug: false },
      });

      expect(plan.resolvedTags).toEqual({ "/islands/CartDrawer.ts": "cart-drawer" });
    });

    it("does not count JSDoc-style customElements.define as a Registered Tag", async () => {
      const compiler = createReviveCompiler(
        {
          toLoadPaths: getIslandPathsForLoad,
          readFile: () =>
            '/**\n * @example customElements.define("old-tag", CartDrawer)\n */\ncustomElements.define("cart-drawer", CartDrawer)',
        },
        "/runtime.js",
      );

      const plan = await compiler.plan({
        root: "/project",
        directories: ["/islands/"],
        directoryFiles: new Set(["/project/islands/CartDrawer.ts"]),
        islandFiles: new Set(),
        reviveOptions: { debug: false },
      });

      expect(plan.resolvedTags).toEqual({ "/islands/CartDrawer.ts": "cart-drawer" });
    });

    it("does not count string-literal customElements.define text as a Registered Tag", async () => {
      const compiler = createReviveCompiler(
        {
          toLoadPaths: getIslandPathsForLoad,
          readFile: () =>
            'const example = \'customElements.define("old-tag", CartDrawer)\';\ncustomElements.define("cart-drawer", CartDrawer)',
        },
        "/runtime.js",
      );

      const plan = await compiler.plan({
        root: "/project",
        directories: ["/islands/"],
        directoryFiles: new Set(["/project/islands/CartDrawer.ts"]),
        islandFiles: new Set(),
        reviveOptions: { debug: false },
      });

      expect(plan.resolvedTags).toEqual({ "/islands/CartDrawer.ts": "cart-drawer" });
    });

    it("throws at compile when an Island file has multiple static customElements.define calls", async () => {
      const compiler = createReviveCompiler(
        {
          toLoadPaths: getIslandPathsForLoad,
          readFile: () =>
            'customElements.define("cart-drawer", CartDrawer); customElements.define("product-form", ProductForm)',
        },
        "/runtime.js",
      );

      await expect(
        compiler.plan({
          root: "/project",
          directories: ["/islands/"],
          directoryFiles: new Set(["/project/islands/CartDrawer.ts"]),
          islandFiles: new Set(),
          reviveOptions: { debug: false },
        }),
      ).rejects.toThrow("found 2 static customElements.define");
    });

    it("throws at compile when an Island file has no static customElements.define", async () => {
      const compiler = createReviveCompiler(
        { toLoadPaths: getIslandPathsForLoad, readFile: () => "export class CartDrawer {}" },
        "/runtime.js",
      );

      await expect(
        compiler.plan({
          root: "/project",
          directories: ["/islands/"],
          directoryFiles: new Set(["/project/islands/CartDrawer.ts"]),
          islandFiles: new Set(),
          reviveOptions: { debug: false },
        }),
      ).rejects.toThrow("no static customElements.define");
    });

    it("accepts a non-kebab-case filename when the Registered Tag is valid", async () => {
      const compiler = createReviveCompiler(
        {
          toLoadPaths: getIslandPathsForLoad,
          readFile: () => 'customElements.define("cart-drawer", CartDrawer)',
        },
        "/runtime.js",
      );

      const plan = await compiler.plan({
        root: "/project",
        directories: ["/islands/"],
        directoryFiles: new Set(["/project/islands/CartDrawer.ts"]),
        islandFiles: new Set(),
        reviveOptions: { debug: false },
      });

      expect(plan.resolvedTags).toEqual({ "/islands/CartDrawer.ts": "cart-drawer" });
    });

    it("reads the Registered Tag from window.customElements.define(...)", async () => {
      const compiler = createReviveCompiler(
        {
          toLoadPaths: getIslandPathsForLoad,
          readFile: () => 'window.customElements.define("cart-drawer", CartDrawer)',
        },
        "/runtime.js",
      );

      const plan = await compiler.plan({
        root: "/project",
        directories: ["/islands/"],
        directoryFiles: new Set(["/project/islands/CartDrawer.ts"]),
        islandFiles: new Set(),
        reviveOptions: { debug: false },
      });

      expect(plan.resolvedTags).toEqual({ "/islands/CartDrawer.ts": "cart-drawer" });
    });

    it("passes the Registered Tag as defaultTag to resolveTag", async () => {
      const seen: Array<{ filePath: string; defaultTag: string }> = [];
      const compiler = createReviveCompiler(
        {
          toLoadPaths: getIslandPathsForLoad,
          readFile: (path) =>
            path.endsWith("CartDrawer.ts")
              ? 'customElements.define("cart-drawer", CartDrawer)'
              : null,
        },
        "/runtime.js",
      );

      await compiler.plan({
        root: "/project",
        directories: ["/islands/"],
        directoryFiles: new Set(["/project/islands/CartDrawer.ts"]),
        islandFiles: new Set(),
        tagSource: "registeredTag",
        resolveTag: ({ filePath, defaultTag }) => {
          seen.push({ filePath, defaultTag });
          return defaultTag;
        },
        reviveOptions: { debug: false },
      });

      expect(seen).toEqual([{ filePath: "/islands/CartDrawer.ts", defaultTag: "cart-drawer" }]);
    });
  });

  describe("tagSource: filename", () => {
    it("warns when window.customElements.define tag disagrees with the filename-derived tag", async () => {
      const warnings: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => warnings.push(String(args[0]));

      const compiler = createReviveCompiler(
        {
          toLoadPaths: getIslandPathsForLoad,
          readFile: () => 'window.customElements.define("cart-drawer", CartDrawer)',
        },
        "/runtime.js",
      );

      try {
        await compiler.plan({
          root: "/project",
          directories: ["/islands/"],
          tagSource: "filename",
          directoryFiles: new Set(["/project/islands/product-form.ts"]),
          islandFiles: new Set(),
          reviveOptions: { debug: false },
        });
      } finally {
        console.warn = originalWarn;
      }

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("statically registers <cart-drawer>");
    });

    it("warns when the filename-derived tag disagrees with the Registered Tag", async () => {
      const warnings: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => warnings.push(String(args[0]));

      const compiler = createReviveCompiler(
        {
          toLoadPaths: getIslandPathsForLoad,
          readFile: () => 'customElements.define("cart-drawer", CartDrawer)',
        },
        "/runtime.js",
      );

      try {
        await compiler.plan({
          root: "/project",
          directories: ["/islands/"],
          tagSource: "filename",
          directoryFiles: new Set(["/project/islands/product-form.ts"]),
          islandFiles: new Set(),
          reviveOptions: { debug: false },
        });
      } finally {
        console.warn = originalWarn;
      }

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("statically registers <cart-drawer>");
    });

    it("ignores commented and string-literal define text when warning on mismatches", async () => {
      const warnings: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => warnings.push(String(args[0]));

      const compiler = createReviveCompiler(
        {
          toLoadPaths: getIslandPathsForLoad,
          readFile: () =>
            [
              '// customElements.define("commented-tag", ProductForm)',
              "const example = 'customElements.define(\"string-tag\", ProductForm)';",
              'customElements.define("cart-drawer", ProductForm)',
            ].join("\n"),
        },
        "/runtime.js",
      );

      try {
        await compiler.plan({
          root: "/project",
          directories: ["/islands/"],
          tagSource: "filename",
          directoryFiles: new Set(["/project/islands/product-form.ts"]),
          islandFiles: new Set(),
          reviveOptions: { debug: false },
        });
      } finally {
        console.warn = originalWarn;
      }

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("statically registers <cart-drawer>");
      expect(warnings[0]).not.toContain("commented-tag");
      expect(warnings[0]).not.toContain("string-tag");
    });

    it("suppresses the mismatch warning in registeredTag mode", async () => {
      const warnings: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => warnings.push(String(args[0]));

      const compiler = createReviveCompiler(
        {
          toLoadPaths: getIslandPathsForLoad,
          readFile: () => 'customElements.define("cart-drawer", CartDrawer)',
        },
        "/runtime.js",
      );

      try {
        await compiler.plan({
          root: "/project",
          directories: ["/islands/"],
          tagSource: "registeredTag",
          directoryFiles: new Set(["/project/islands/CartDrawer.ts"]),
          islandFiles: new Set(),
          reviveOptions: { debug: false },
        });
      } finally {
        console.warn = originalWarn;
      }

      expect(warnings).toHaveLength(0);
    });

    it("derives defaultTag from the filename, ignoring file content", async () => {
      const seen: string[] = [];
      const compiler = createReviveCompiler(
        {
          toLoadPaths: getIslandPathsForLoad,
          readFile: () => "export class ProductForm extends HTMLElement {}",
        },
        "/runtime.js",
      );

      await compiler.plan({
        root: "/project",
        directories: ["/islands/"],
        tagSource: "filename",
        directoryFiles: new Set(["/project/islands/product-form.ts"]),
        islandFiles: new Set(),
        resolveTag: ({ defaultTag }) => {
          seen.push(defaultTag);
          return defaultTag;
        },
        reviveOptions: { debug: false },
      });

      expect(seen).toEqual(["product-form"]);
    });
  });

  it("plans a semantic compile artifact from resolved plugin state", async () => {
    const seen: Array<{ filePath: string; defaultTag: string }> = [];
    const compiler = createReviveCompiler(
      {
        toLoadPaths: getIslandPathsForLoad,
      },
      "/runtime.js",
    );

    const plan = await compiler.plan(
      {
        root: "/project",
        directories: ["/islands/", "/components/"],
        tagSource: "filename",
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

  it("renders the compiled source from a semantic plan", async () => {
    const compiler = createReviveCompiler(
      {
        toLoadPaths: getIslandPathsForLoad,
      },
      "/runtime.js",
    );
    const plan = await compiler.plan(
      {
        root: "/project",
        directories: ["/islands/"],
        tagSource: "filename",
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

  it("compiles compiled source through one compiler operation", async () => {
    const compiler = createReviveCompiler(
      {
        toLoadPaths: getIslandPathsForLoad,
      },
      "/runtime.js",
    );

    const source = await compiler.compile(
      {
        root: "/project",
        directories: ["/islands/"],
        tagSource: "filename",
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
    const compiler = createReviveCompiler(
      {
        toLoadPaths: getIslandPathsForLoad,
      },
      "/runtime.js",
    );

    const plan = await compiler.plan(
      {
        root: "/project",
        directories: ["/islands/"],
        tagSource: "filename",
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
    const compiler = createReviveCompiler(
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
          tagSource: "filename",
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
