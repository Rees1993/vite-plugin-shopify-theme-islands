import { describe, expect, it, mock } from "bun:test";
import type { IslandLoader } from "../contract";
import { createRootOwnershipCoordinator } from "../runtime-ownership";

describe("runtime-ownership", () => {
  it("clears only observed island tags when a subtree is unobserved", () => {
    const clear = mock((_tags?: Iterable<string>) => {});
    const startDisconnect = mock(() => {});
    const connectShopify = mock(() => mock(() => {}));
    const lifecycle = {
      start: mock(() => ({ disconnect: startDisconnect })),
      includeRoot: mock((_root: HTMLElement) => {}),
      excludeRoot: mock((_root: HTMLElement) => {}),
      walk: mock((_root: HTMLElement) => {}),
    };
    const session = {
      clear,
      discover: mock(() => {}),
      activate: mock(async () => {}),
    };

    const islandMap = new Map<string, IslandLoader>([
      ["alpha-island", async () => {}],
      ["beta-island", async () => {}],
    ]);
    const subtree = document.createElement("section");
    subtree.innerHTML = `
      <alpha-island></alpha-island>
      <plain-div></plain-div>
      <beta-widget></beta-widget>
    `;

    const runtime = createRootOwnershipCoordinator({
      islandMap,
      lifecycle,
      session,
      surface: { beginReadyLog: mock(() => () => {}) },
      debug: false,
      connectShopify,
    });

    runtime.unobserve(subtree);

    expect(connectShopify).toHaveBeenCalledTimes(1);
    expect(lifecycle.excludeRoot).toHaveBeenCalledWith(subtree);
    const tags = clear.mock.calls[0]?.[0];
    expect(tags ? [...tags] : []).toEqual(["alpha-island"]);
  });

  it("disconnects lifecycle, Shopify bridge, and session state for the document root", () => {
    const clear = mock((_tags?: Iterable<string>) => {});
    const startDisconnect = mock(() => {});
    const disconnectShopify = mock(() => {});
    const lifecycle = {
      start: mock(() => ({ disconnect: startDisconnect })),
      includeRoot: mock((_root: HTMLElement) => {}),
      excludeRoot: mock((_root: HTMLElement) => {}),
      walk: mock((_root: HTMLElement) => {}),
    };

    const runtime = createRootOwnershipCoordinator({
      islandMap: new Map<string, IslandLoader>(),
      lifecycle,
      session: {
        clear,
        discover: mock(() => {}),
        activate: mock(async () => {}),
      },
      surface: { beginReadyLog: mock(() => () => {}) },
      debug: true,
      connectShopify: mock(() => disconnectShopify),
    });

    runtime.disconnect();

    expect(lifecycle.excludeRoot).toHaveBeenCalledWith(document.body);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(startDisconnect).toHaveBeenCalledTimes(1);
    expect(disconnectShopify).toHaveBeenCalledTimes(1);
  });
});
