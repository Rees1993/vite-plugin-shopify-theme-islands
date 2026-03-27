import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRevivePipeline } from "../revive-pipeline";

describe("revive-pipeline", () => {
  let tmp = "";

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "revive-pipeline-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("compiles the virtual revive module from configured inventory state in one boundary", async () => {
    const islandsDir = join(tmp, "frontend/js/islands");
    const directivesDir = join(tmp, "src/directives");
    mkdirSync(islandsDir, { recursive: true });
    mkdirSync(directivesDir, { recursive: true });

    writeFileSync(
      join(islandsDir, "product-form.ts"),
      "export default class ProductForm extends HTMLElement {}",
    );
    writeFileSync(
      join(tmp, "src/upsell-card.ts"),
      'import Island from "vite-plugin-shopify-theme-islands/island";\nexport default class UpsellCard extends Island(HTMLElement) {}',
    );

    const pipeline = createRevivePipeline({
      rawDirectories: ["/frontend/js/islands/"],
      runtimePath: "/runtime.js",
      resolveTag: ({ filePath, defaultTag }) =>
        filePath.endsWith("product-form.ts")
          ? "product-form"
          : filePath.endsWith("upsell-card.ts")
            ? defaultTag
            : undefined,
      customDirectives: [{ name: "client:on-click", entrypoint: "./src/directives/on-click.ts" }],
      reviveOptions: { debug: true },
    });

    pipeline.configure({ root: tmp, aliases: [] });
    pipeline.scan();

    const source = await pipeline.compile(async (entrypoint) => `/resolved/${entrypoint}`);

    expect(source).toContain('import { revive as _islands } from "/runtime.js"');
    expect(source).toContain('import _directive0 from "/resolved/./src/directives/on-click.ts";');
    expect(source).toContain('import.meta.glob("/frontend/js/islands/**/*.{ts,js}")');
    expect(source).toContain('import.meta.glob(["/src/upsell-card.ts"])');
    expect(source).not.toContain("const resolvedTags = ");
    expect(source).toContain("const payload = { islands, options, customDirectives };");
  });
});
