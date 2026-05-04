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
  clear(tagNames?: Iterable<string>): void;
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
  const membershipByRoot = new Map<HTMLElement, Map<HTMLElement, string>>();

  const tagsStillObservedOutside = (ignoredRoot: HTMLElement): Set<string> => {
    const tags = new Set<string>();
    for (const [root, membership] of membershipByRoot) {
      if (root === ignoredRoot) continue;
      for (const tagName of membership.values()) tags.add(tagName);
    }
    return tags;
  };

  const disconnectLifecycle = deps.lifecycle.start({
    getRoot: () => document.body,
    islandMap: deps.islandMap,
    onDiscover: (tagName, element) => {
      for (const [root, membership] of membershipByRoot) {
        if (root.contains(element)) membership.set(element, tagName);
      }
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
    if (root !== document.body) return;
    deps.lifecycle.excludeRoot(document.body);
    disconnected = true;
    membershipByRoot.clear();
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
        membershipByRoot.set(root, membershipByRoot.get(root) ?? new Map());
        deps.lifecycle.includeRoot(root);
      }
      deps.lifecycle.walk(root);
    },

    unobserve(root = document.body) {
      if (root && root !== document.body) {
        const membership = membershipByRoot.get(root);
        const retainedTags = tagsStillObservedOutside(root);
        const tagsToClear = new Set<string>();
        for (const tagName of membership?.values() ?? []) {
          if (!retainedTags.has(tagName)) tagsToClear.add(tagName);
        }
        membershipByRoot.delete(root);
        deps.lifecycle.excludeRoot(root);
        deps.session.clear(tagsToClear);
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
