import { describe, expect, it } from "bun:test";
import { DEFAULT_DIRECTIVES } from "../contract";
import { resolveThemeIslandsPolicy } from "../config-policy";
import type { ShopifyThemeIslandsOptions } from "../options";

describe("config-policy", () => {
  it("applies full defaults when options are omitted", () => {
    const policy = resolveThemeIslandsPolicy();
    expect(policy.plugin.directives).toEqual(DEFAULT_DIRECTIVES);
    expect(policy.plugin.customDirectives).toEqual([]);
    expect(policy.plugin.debug).toBe(false);
    expect(policy.runtime).toEqual({
      directives: DEFAULT_DIRECTIVES,
      debug: false,
    });
  });

  it("merges partial directive options and preserves runtime projection", () => {
    const customDirectives = [{ name: "client:on-click", entrypoint: "./click.ts" }];
    const policy = resolveThemeIslandsPolicy({
      directives: {
        idle: { timeout: 100 },
        interaction: { events: ["focusin"] },
        custom: customDirectives,
      },
      debug: true,
      retry: { retries: 2, delay: 500 },
      directiveTimeout: 250,
    });

    expect(policy.plugin.directives.visible).toEqual(DEFAULT_DIRECTIVES.visible);
    expect(policy.plugin.directives.idle).toEqual({
      attribute: "client:idle",
      timeout: 100,
    });
    expect(policy.plugin.directives.interaction?.events).toEqual(["focusin"]);
    expect(policy.plugin.customDirectives).toBe(customDirectives);
    expect(policy.plugin.debug).toBe(true);
    expect(policy.runtime).toEqual({
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

  it("exposes a bootstrap-ready view of the resolved policy", () => {
    const resolveTag = ({ defaultTag }: { filePath: string; defaultTag: string }) => defaultTag;
    const customDirectives = [{ name: "client:on-click", entrypoint: "./click.ts" }];

    const policy = resolveThemeIslandsPolicy({
      resolveTag,
      directives: { custom: customDirectives },
      retry: { retries: 2, delay: 500 },
      debug: true,
    });

    expect(policy.bootstrap).toEqual({
      resolveTag,
      customDirectives,
      reviveOptions: policy.runtime,
    });
  });

  it("rejects empty directories", () => {
    expect(() => resolveThemeIslandsPolicy({ directories: [] })).toThrow(
      '"directories" must not be empty',
    );
  });

  it("rejects invalid visible thresholds", () => {
    expect(() =>
      resolveThemeIslandsPolicy({ directives: { visible: { threshold: -0.1 } } }),
    ).toThrow('"directives.visible.threshold" must be between 0 and 1');
    expect(() =>
      resolveThemeIslandsPolicy({ directives: { visible: { threshold: 1.1 } } }),
    ).toThrow('"directives.visible.threshold" must be between 0 and 1');
  });

  it("rejects invalid retry values", () => {
    expect(() => resolveThemeIslandsPolicy({ retry: { retries: -1 } })).toThrow(
      '"retry.retries" must be >= 0',
    );
    expect(() => resolveThemeIslandsPolicy({ retry: { delay: -1 } })).toThrow(
      '"retry.delay" must be >= 0',
    );
  });

  it("rejects duplicate and conflicting custom directive names", () => {
    expect(() =>
      resolveThemeIslandsPolicy({
        directives: {
          custom: [
            { name: "client:hover", entrypoint: "./a.ts" },
            { name: "client:hover", entrypoint: "./b.ts" },
          ],
        },
      }),
    ).toThrow('Duplicate custom directive name: "client:hover"');

    expect(() =>
      resolveThemeIslandsPolicy({
        directives: { custom: [{ name: "client:visible", entrypoint: "./a.ts" }] },
      }),
    ).toThrow("conflicts with a built-in directive");

    expect(() =>
      resolveThemeIslandsPolicy({
        directives: {
          visible: { attribute: "data:visible" },
          custom: [{ name: "data:visible", entrypoint: "./a.ts" }],
        },
      }),
    ).toThrow("conflicts with a built-in directive");
  });

  it("rejects empty interaction event arrays", () => {
    expect(() =>
      resolveThemeIslandsPolicy({
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

    expect(() => resolveThemeIslandsPolicy(options)).toThrow(
      '"directives.interaction.events" contains unsupported event "click"',
    );
  });
});
