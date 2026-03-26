import type { ActivationSession, ActivationCandidate } from "./activation-session.js";
import type { IslandLoader } from "./contract.js";
import type { IslandLifecycle } from "./lifecycle.js";
import type { RuntimeSurface } from "./runtime-surface.js";
import { connectShopifyLifecycle, type ShopifyLifecycleRuntime } from "./shopify-lifecycle.js";

interface RuntimeOwnershipRuntime {
  disconnect(): void;
  scan(root?: HTMLElement | null): void;
  observe(root?: HTMLElement | null): void;
  unobserve(root?: HTMLElement | null): void;
}

export interface RootOwnershipCoordinatorDeps {
  islandMap: Map<string, IslandLoader>;
  lifecycle: Pick<IslandLifecycle, "start" | "includeRoot" | "excludeRoot" | "walk">;
  session: Pick<ActivationSession, "discover" | "activate" | "clear">;
  surface: Pick<RuntimeSurface, "beginReadyLog">;
  debug: boolean;
  connectShopify?: (runtime: ShopifyLifecycleRuntime) => () => void;
}

function collectSubtreeTags(root: HTMLElement, islandMap: Map<string, IslandLoader>): Set<string> {
  const tags = new Set<string>();
  const collect = (el: Element) => {
    const tagName = el.tagName.toLowerCase();
    if (islandMap.has(tagName)) tags.add(tagName);
  };

  collect(root);
  for (const el of root.querySelectorAll("*")) collect(el);
  return tags;
}

export function createRootOwnershipCoordinator(
  deps: RootOwnershipCoordinatorDeps,
): RuntimeOwnershipRuntime {
  let disconnected = false;
  let endReadyLog: (() => void) | undefined;

  const disconnectLifecycle = deps.lifecycle.start({
    getRoot: () => document.body,
    islandMap: deps.islandMap,
    onDiscover: (tagName, element) => deps.session.discover(tagName, element),
    onActivate: (tagName, element, loader) => {
      void deps.session.activate({
        tagName,
        element,
        loader,
      } satisfies ActivationCandidate);
    },
    onBeforeInitialWalk: () => {
      endReadyLog = deps.surface.beginReadyLog(deps.islandMap.size, deps.debug);
    },
    onInitialWalkComplete: () => {
      endReadyLog?.();
      endReadyLog = undefined;
    },
  });

  const disconnectRoot = (root: HTMLElement | null = document.body): void => {
    if (root !== document.body) return;
    deps.lifecycle.excludeRoot(document.body);
    disconnected = true;
    deps.session.clear();
    endReadyLog?.();
    endReadyLog = undefined;
    disconnectLifecycle.disconnect();
  };

  const runtime: RuntimeOwnershipRuntime = {
    scan(root = document.body) {
      if (disconnected || !root) return;
      deps.lifecycle.walk(root);
    },

    observe(root = document.body) {
      if (disconnected || !root) return;
      if (root !== document.body) deps.lifecycle.includeRoot(root);
      deps.lifecycle.walk(root);
    },

    unobserve(root = document.body) {
      if (root && root !== document.body) {
        deps.session.clear(collectSubtreeTags(root, deps.islandMap));
        deps.lifecycle.excludeRoot(root);
        return;
      }
      disconnectRoot(root);
    },

    disconnect() {
      disconnectRoot(document.body);
    },
  };

  const disconnectShopify = (deps.connectShopify ?? connectShopifyLifecycle)(runtime);

  return {
    ...runtime,
    disconnect() {
      disconnectShopify();
      runtime.disconnect();
    },
  };
}
