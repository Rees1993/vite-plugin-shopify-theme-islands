import { describe, expect, it, mock } from "bun:test";
import type { IslandLoader } from "../contract";
import { createObservedRootSession, type ObservedRootSessionDeps } from "../runtime-ownership";

function makeSession(overrides?: Partial<Parameters<typeof createObservedRootSession>[0]>) {
  const startDisconnect = mock(() => {});
  const lifecycle = {
    start: mock(() => ({ disconnect: startDisconnect })),
    includeRoot: mock((_root: HTMLElement) => {}),
    excludeRoot: mock((_root: HTMLElement) => {}),
    walk: mock((_root: HTMLElement) => {}),
  };
  const session = {
    clear: mock((_tags?: Iterable<string>) => {}),
    discover: mock(() => {}),
    activate: mock(async () => {}),
  };
  const disconnectShopify = mock(() => {});
  const runtime = createObservedRootSession({
    islandMap: new Map<string, IslandLoader>(),
    lifecycle,
    session,
    surface: { beginReadyLog: mock(() => () => {}) },
    connectShopify: mock(() => disconnectShopify),
    ...overrides,
  });
  return { runtime, lifecycle, session, startDisconnect, disconnectShopify };
}

describe("ObservedRootSession", () => {
  describe("scan", () => {
    it("walks the given root via lifecycle", () => {
      const { runtime, lifecycle } = makeSession();
      const root = document.createElement("div");
      runtime.scan(root);
      expect(lifecycle.walk).toHaveBeenCalledWith(root);
    });

    it("defaults to document.body when no root given", () => {
      const { runtime, lifecycle } = makeSession();
      runtime.scan();
      expect(lifecycle.walk).toHaveBeenCalledWith(document.body);
    });

    it("is a no-op after disconnect", () => {
      const { runtime, lifecycle } = makeSession();
      runtime.disconnect();
      lifecycle.walk.mockClear();
      runtime.scan();
      expect(lifecycle.walk).not.toHaveBeenCalled();
    });

    it("is a no-op for null root", () => {
      const { runtime, lifecycle } = makeSession();
      runtime.scan(null);
      expect(lifecycle.walk).not.toHaveBeenCalled();
    });
  });

  describe("observe", () => {
    it("includes a non-body root and walks it", () => {
      const { runtime, lifecycle } = makeSession();
      const root = document.createElement("section");
      runtime.observe(root);
      expect(lifecycle.includeRoot).toHaveBeenCalledWith(root);
      expect(lifecycle.walk).toHaveBeenCalledWith(root);
    });

    it("only walks document.body (no includeRoot call)", () => {
      const { runtime, lifecycle } = makeSession();
      runtime.observe(document.body);
      expect(lifecycle.includeRoot).not.toHaveBeenCalled();
      expect(lifecycle.walk).toHaveBeenCalledWith(document.body);
    });

    it("defaults to document.body", () => {
      const { runtime, lifecycle } = makeSession();
      runtime.observe();
      expect(lifecycle.walk).toHaveBeenCalledWith(document.body);
    });

    it("is a no-op after disconnect", () => {
      const { runtime, lifecycle } = makeSession();
      runtime.disconnect();
      lifecycle.walk.mockClear();
      runtime.observe();
      expect(lifecycle.walk).not.toHaveBeenCalled();
    });
  });

  describe("unobserve", () => {
    it("clears tracked island tags when a subtree is unobserved", () => {
      const islandMap = new Map<string, IslandLoader>([
        ["alpha-island", async () => {}],
        ["beta-island", async () => {}],
      ]);
      const subtree = document.createElement("section");
      const alphaEl = document.createElement("alpha-island");
      const betaEl = document.createElement("beta-island");
      subtree.appendChild(alphaEl);
      document.body.appendChild(betaEl);

      let onDiscover: (tagName: string, element: HTMLElement) => void = () => {};
      const session = {
        clear: mock((_tags?: Iterable<string>) => {}),
        discover: mock(() => {}),
        activate: mock(async () => {}),
      };
      const startDisconnect = mock(() => {});
      const lifecycle: ObservedRootSessionDeps["lifecycle"] = {
        start: mock((opts) => {
          onDiscover = opts.onDiscover;
          return { disconnect: startDisconnect };
        }),
        includeRoot: mock(() => {}),
        excludeRoot: mock(() => {}),
        walk: mock(() => {}),
      };
      const runtime = createObservedRootSession({
        islandMap,
        lifecycle,
        session,
        surface: { beginReadyLog: mock(() => () => {}) },
        connectShopify: mock(() => mock(() => {})),
      });

      // Observe subtree and simulate discovery
      runtime.observe(subtree);
      onDiscover("alpha-island", alphaEl);
      onDiscover("beta-island", betaEl);

      runtime.unobserve(subtree);

      expect(lifecycle.excludeRoot).toHaveBeenCalledWith(subtree);
      const tags = session.clear.mock.calls[0]?.[0];
      expect(tags ? [...tags] : []).toEqual(["alpha-island"]);
    });

    it("does not forget tracked tags when the same subtree is observed twice", () => {
      const alphaEl = document.createElement("alpha-island");
      const subtree = document.createElement("section");
      subtree.appendChild(alphaEl);

      let onDiscover: (tagName: string, element: HTMLElement) => void = () => {};
      const session = {
        clear: mock((_tags?: Iterable<string>) => {}),
        discover: mock(() => {}),
        activate: mock(async () => {}),
      };
      const lifecycle: ObservedRootSessionDeps["lifecycle"] = {
        start: mock((opts) => {
          onDiscover = opts.onDiscover;
          return { disconnect: mock(() => {}) };
        }),
        includeRoot: mock(() => {}),
        excludeRoot: mock(() => {}),
        walk: mock(() => {}),
      };
      const runtime = createObservedRootSession({
        islandMap: new Map<string, IslandLoader>([["alpha-island", async () => {}]]),
        lifecycle,
        session,
        surface: { beginReadyLog: mock(() => () => {}) },
        connectShopify: mock(() => mock(() => {})),
      });

      runtime.observe(subtree);
      onDiscover("alpha-island", alphaEl);
      runtime.observe(subtree);
      runtime.unobserve(subtree);

      const tags = session.clear.mock.calls[0]?.[0];
      expect(tags ? [...tags] : []).toEqual(["alpha-island"]);
    });

    it("does not clear tags that are still owned by another observed root", () => {
      const shared = document.createElement("shared-island");
      const unique = document.createElement("unique-island");
      const parent = document.createElement("section");
      const child = document.createElement("div");
      parent.append(shared, child);
      child.appendChild(unique);

      let onDiscover: (tagName: string, element: HTMLElement) => void = () => {};
      const session = {
        clear: mock((_tags?: Iterable<string>) => {}),
        discover: mock(() => {}),
        activate: mock(async () => {}),
      };
      const lifecycle: ObservedRootSessionDeps["lifecycle"] = {
        start: mock((opts) => {
          onDiscover = opts.onDiscover;
          return { disconnect: mock(() => {}) };
        }),
        includeRoot: mock(() => {}),
        excludeRoot: mock(() => {}),
        walk: mock(() => {}),
      };
      const runtime = createObservedRootSession({
        islandMap: new Map<string, IslandLoader>([
          ["shared-island", async () => {}],
          ["unique-island", async () => {}],
        ]),
        lifecycle,
        session,
        surface: { beginReadyLog: mock(() => () => {}) },
        connectShopify: mock(() => mock(() => {})),
      });

      runtime.observe(parent);
      runtime.observe(child);
      onDiscover("shared-island", shared);
      onDiscover("unique-island", unique);

      runtime.unobserve(parent);

      const tags = session.clear.mock.calls[0]?.[0];
      expect(tags ? [...tags] : []).toEqual(["shared-island"]);
    });

    it("clears empty set when subtree was never observed", () => {
      const { runtime, lifecycle, session } = makeSession();
      const subtree = document.createElement("section");
      runtime.unobserve(subtree);
      expect(lifecycle.excludeRoot).toHaveBeenCalledWith(subtree);
      const tags = session.clear.mock.calls[0]?.[0];
      expect(tags ? [...tags] : []).toEqual([]);
    });

    it("tears down lifecycle and session for document.body but does not disconnect the Shopify bridge", () => {
      const { runtime, lifecycle, session, startDisconnect, disconnectShopify } = makeSession();
      runtime.unobserve(document.body);
      expect(lifecycle.excludeRoot).toHaveBeenCalledWith(document.body);
      expect(session.clear).toHaveBeenCalledTimes(1);
      expect(startDisconnect).toHaveBeenCalledTimes(1);
      expect(disconnectShopify).not.toHaveBeenCalled();
    });
  });

  describe("disconnect", () => {
    it("disconnects lifecycle, Shopify bridge, and session state for the document root", () => {
      const { runtime, lifecycle, session, startDisconnect, disconnectShopify } = makeSession();
      runtime.disconnect();
      expect(lifecycle.excludeRoot).toHaveBeenCalledWith(document.body);
      expect(session.clear).toHaveBeenCalledTimes(1);
      expect(startDisconnect).toHaveBeenCalledTimes(1);
      expect(disconnectShopify).toHaveBeenCalledTimes(1);
    });

    it("disconnects the Shopify bridge in addition to lifecycle and session", () => {
      const { runtime, disconnectShopify } = makeSession();
      runtime.disconnect();
      expect(disconnectShopify).toHaveBeenCalledTimes(1);
    });
  });
});
