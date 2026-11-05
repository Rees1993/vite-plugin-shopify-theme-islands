import type { IslandLoader } from "./contract.js";
import type { IslandLifecycle } from "./lifecycle.js";
import { connectShopifyLifecycle, type ShopifyLifecycleRuntime } from "./shopify-lifecycle.js";

/** Runtime control verb semantics for Observed roots. */
export interface ObservedRootSession {
  disconnect(): void;
  scan(root?: HTMLElement | null): void;
  observe(root?: HTMLElement | null): void;
  unobserve(root?: HTMLElement | null): void;
}

interface OwnershipActivationCandidate {
  tagName: string;
  element: HTMLElement;
  loader: IslandLoader;
}

interface OwnershipSession {
  discover(tagName: string, element: HTMLElement): void;
  activate(candidate: OwnershipActivationCandidate): Promise<void>;
  isPending(tagName: string): boolean;
  clear(): void;
}

export interface ObservedRootSessionDeps {
  islandMap: Map<string, IslandLoader>;
  lifecycle: Pick<IslandLifecycle, "start" | "includeRoot" | "excludeRoot" | "walk">;
  session: OwnershipSession;
  surface: { beginReadyLog(islandCount: number): () => void };
  connectShopify?: (runtime: ShopifyLifecycleRuntime) => () => void;
}

export function createObservedRootSession(deps: ObservedRootSessionDeps): ObservedRootSession {
  let disconnected = false;
  let endReadyLog: (() => void) | undefined;
  const disconnectLifecycle = deps.lifecycle.start({
    getRoot: () => document.body,
    islandMap: deps.islandMap,
    isPending: (tag) => deps.session.isPending(tag),
    onDiscover: (tagName, element) => {
      deps.session.discover(tagName, element);
    },
    onActivate: (tagName, element, loader) => {
      void deps.session.activate({
        tagName,
        element,
        loader,
      } satisfies OwnershipActivationCandidate);
    },
    onBeforeInitialWalk: () => {
      endReadyLog = deps.surface.beginReadyLog(deps.islandMap.size);
    },
    onInitialWalkComplete: () => {
      endReadyLog?.();
      endReadyLog = undefined;
    },
  });

  const disconnectRoot = (root: HTMLElement | null = document.body): void => {
    if (disconnected || root !== document.body) return;
    deps.lifecycle.excludeRoot(document.body);
    disconnected = true;
    deps.session.clear();
    endReadyLog?.();
    endReadyLog = undefined;
    disconnectLifecycle.disconnect();
  };

  const runtime: ObservedRootSession = {
    scan(root = document.body) {
      if (disconnected || !root) return;
      deps.lifecycle.walk(root);
    },

    observe(root = document.body) {
      if (disconnected || !root) return;
      if (root !== document.body) {
        deps.lifecycle.includeRoot(root);
      }
      deps.lifecycle.walk(root);
    },

    unobserve(root = document.body) {
      if (disconnected) return;
      if (root && root !== document.body) {
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
