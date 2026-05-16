import { describe, expect, it } from "bun:test";
import { DEFAULT_DIRECTIVES } from "../contract";
import { resolveThemeIslandsConfig } from "../resolved-config";
import type { ShopifyThemeIslandsOptions } from "../options";

describe("resolved-config", () => {
  it("applies full defaults when options are omitted", () => {
    const config = resolveThemeIslandsConfig();
    expect(config.plugin.directives).toEqual(DEFAULT_DIRECTIVES);
    expect(config.plugin.debug).toBe(false);
    expect(config.runtimeOptions()).toEqual({
      directives: DEFAULT_DIRECTIVES,
      debug: false,
    });
  });

  it("exposes runtime options through one config operation", () => {
    const config = resolveThemeIslandsConfig({
      retry: { retries: 2, delay: 500 },
      directiveTimeout: 250,
      debug: true,
    });

    expect(config.runtimeOptions()).toEqual({
      directives: DEFAULT_DIRECTIVES,
      debug: true,
      retry: { retries: 2, delay: 500 },
      directiveTimeout: 250,
    });
  });

  it("merges partial directive options and preserves runtime projection", () => {
    const customDirectives = [{ name: "client:on-click", entrypoint: "./click.ts" }];
    const config = resolveThemeIslandsConfig({
      directives: {
        idle: { timeout: 100 },
        interaction: { events: ["focusin"] },
        custom: customDirectives,
      },
      debug: true,
      retry: { retries: 2, delay: 500 },
      directiveTimeout: 250,
    });

    expect(config.plugin.directives.visible).toEqual(DEFAULT_DIRECTIVES.visible);
    expect(config.plugin.directives.idle).toEqual({
      attribute: "client:idle",
      timeout: 100,
    });
    expect(config.plugin.directives.interaction?.events).toEqual(["focusin"]);
    expect(config.plugin.debug).toBe(true);
    expect(config.runtimeOptions()).toEqual({
      directives: {
        visible: DEFAULT_DIRECTIVES.visible,
        idle: { attribute: "client:idle", timeout: 100 },
        media: DEFAULT_DIRECTIVES.media,
        defer: DEFAULT_DIRECTIVES.defer,
        interaction: {
          attribute: "client:interaction",
          events: ["focusin"],
        },
      },
      debug: true,
      retry: { retries: 2, delay: 500 },
      directiveTimeout: 250,
    });
  });

  it("compiles compile input from inventory state through one config operation", () => {
    const resolveTag = ({ defaultTag }: { filePath: string; defaultTag: string }) => defaultTag;
    const customDirectives = [{ name: "client:on-click", entrypoint: "./click.ts" }];
    const config = resolveThemeIslandsConfig({
      resolveTag,
      directives: { custom: customDirectives },
      retry: { retries: 2, delay: 500 },
      debug: true,
    });

    expect(
      config.compileInputs({
        root: "/project",
        directories: ["/islands/"],
        directoryFiles: new Set(["/project/islands/product-form.ts"]),
        islandFiles: new Set(["/project/src/upsell-card.ts"]),
      }),
    ).toEqual({
      root: "/project",
      directories: ["/islands/"],
      directoryFiles: new Set(["/project/islands/product-form.ts"]),
      islandFiles: new Set(["/project/src/upsell-card.ts"]),
      tagSource: "registeredTag",
      resolveTag,
      customDirectives,
      reviveOptions: config.runtimeOptions(),
    });
  });

  it("rejects empty directories", () => {
    expect(() => resolveThemeIslandsConfig({ directories: [] })).toThrow(
      '"directories" must not be empty',
    );
  });

  it("rejects invalid visible thresholds", () => {
    expect(() =>
      resolveThemeIslandsConfig({ directives: { visible: { threshold: -0.1 } } }),
    ).toThrow('"directives.visible.threshold" must be between 0 and 1');
    expect(() =>
      resolveThemeIslandsConfig({ directives: { visible: { threshold: 1.1 } } }),
    ).toThrow('"directives.visible.threshold" must be between 0 and 1');
  });

  it("rejects invalid retry values", () => {
    expect(() => resolveThemeIslandsConfig({ retry: { retries: -1 } })).toThrow(
      '"retry.retries" must be >= 0',
    );
    expect(() => resolveThemeIslandsConfig({ retry: { delay: -1 } })).toThrow(
      '"retry.delay" must be >= 0',
    );
  });

  it("rejects duplicate and conflicting custom directive names", () => {
    expect(() =>
      resolveThemeIslandsConfig({
        directives: {
          custom: [
            { name: "client:hover", entrypoint: "./a.ts" },
            { name: "client:hover", entrypoint: "./b.ts" },
          ],
        },
      }),
    ).toThrow('Duplicate custom directive name: "client:hover"');

    expect(() =>
      resolveThemeIslandsConfig({
        directives: { custom: [{ name: "client:visible", entrypoint: "./a.ts" }] },
      }),
    ).toThrow("conflicts with a built-in directive");

    expect(() =>
      resolveThemeIslandsConfig({
        directives: {
          visible: { attribute: "data:visible" },
          custom: [{ name: "data:visible", entrypoint: "./a.ts" }],
        },
      }),
    ).toThrow("conflicts with a built-in directive");
  });

  it("rejects empty interaction event arrays", () => {
    expect(() =>
      resolveThemeIslandsConfig({
        directives: { interaction: { events: [] } },
      }),
    ).toThrow('"directives.interaction.events" must not be empty');
  });

  it("rejects unsupported interaction event names", () => {
    const options = {
      directives: {
        interaction: { events: ["mouseenter", "click"] },
      },
    } as unknown as ShopifyThemeIslandsOptions;

    expect(() => resolveThemeIslandsConfig(options)).toThrow(
      '"directives.interaction.events" contains unsupported event "click"',
    );
  });

  it("passes tagSource through compileInputs", () => {
    const config = resolveThemeIslandsConfig({ tagSource: "filename" });
    const inputs = config.compileInputs({
      root: "/project",
      directories: ["/islands/"],
      directoryFiles: new Set(),
      islandFiles: new Set(),
    });
    expect(inputs.tagSource).toBe("filename");
  });

  it("defaults tagSource to registeredTag when omitted", () => {
    const config = resolveThemeIslandsConfig();
    const inputs = config.compileInputs({
      root: "/project",
      directories: ["/islands/"],
      directoryFiles: new Set(),
      islandFiles: new Set(),
    });
    expect(inputs.tagSource).toBe("registeredTag");
  });

  it("rejects unknown tagSource values", () => {
    expect(() => resolveThemeIslandsConfig({ tagSource: "unknown" as "filename" })).toThrow(
      '"tagSource" must be "registeredTag" or "filename"',
    );
  });
});
