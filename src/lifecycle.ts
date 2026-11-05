import { createCancellableWatchers } from "./cancellable-watchers.js";
import type { IslandLoader } from "./contract.js";

export interface IslandLifecycleStartInput {
  getRoot(): HTMLElement | null;
  islandMap: Map<string, IslandLoader>;
  onActivate(tagName: string, el: HTMLElement, loader: () => Promise<unknown>): void;
  isPending(tagName: string): boolean;
  onDiscover?(tagName: string, el: HTMLElement): void;
  onBeforeInitialWalk?: () => void;
  onInitialWalkComplete?: () => void;
}

export interface IslandLifecycle {
  excludeRoot(root: HTMLElement): void;
  includeRoot(root: HTMLElement): void;
  isObserved(el: Element): boolean;
  readonly initialWalkComplete: boolean;
  watchCancellable(el: Element, cancel: () => void): () => void;
  walk(root: HTMLElement): void;
  start(input: IslandLifecycleStartInput): { disconnect: () => void };
}

export function createIslandLifecycleCoordinator(): IslandLifecycle {
  const cancellableWatchers = createCancellableWatchers();
  let rootPolicies = new WeakMap<HTMLElement, "include" | "exclude">();
  let stopped = false;
  let initialWalkComplete = false;
  let walkImpl: ((root: HTMLElement) => void) | undefined;

  const isExcluded = (el: Element): boolean => {
    let current: Element | null = el;
    while (current) {
      const policy = rootPolicies.get(current as HTMLElement);
      if (policy) return policy === "exclude";
      current = current.parentElement;
    }
    return false;
  };

  const start = (input: IslandLifecycleStartInput): { disconnect: () => void } => {
    stopped = false;
    let disconnected = false;
    let initialized = false;

    const customElementFilter: NodeFilter = {
      acceptNode: (node) => {
        if (isExcluded(node as Element)) return NodeFilter.FILTER_SKIP;
        const tag = (node as Element).tagName.toLowerCase();
        if (!tag.includes("-")) return NodeFilter.FILTER_SKIP;
        if (!input.islandMap.has(tag)) return NodeFilter.FILTER_SKIP;
        return NodeFilter.FILTER_ACCEPT;
      },
    };

    const activate = (el: HTMLElement): void => {
      if (stopped || !el.isConnected || isExcluded(el)) return;
      const tagName = el.tagName.toLowerCase();
      const loader = input.islandMap.get(tagName);
      if (!loader) return;
      input.onDiscover?.(tagName, el);

      let ancestor = el.parentElement;
      while (ancestor) {
        if (input.isPending(ancestor.tagName.toLowerCase())) return;
        ancestor = ancestor.parentElement;
      }

      input.onActivate(tagName, el, loader);
    };

    const walk = (el: HTMLElement): void => {
      activate(el);
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT, customElementFilter);
      let node: Node | null;
      while ((node = walker.nextNode())) activate(node as HTMLElement);
    };
    walkImpl = walk;

    const handleAdditions = (mutations: MutationRecord[]): void => {
      for (const { addedNodes } of mutations) {
        for (const node of addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) walk(node as HTMLElement);
        }
      }
    };

    const observer = new MutationObserver((mutations) => {
      cancellableWatchers.cancelDetached(isExcluded);
      handleAdditions(mutations);
    });

    const init = (): void => {
      if (disconnected || initialized) return;
      const root = input.getRoot();
      if (!root) return;
      initialized = true;
      input.onBeforeInitialWalk?.();
      walk(root);
      initialWalkComplete = true;
      input.onInitialWalkComplete?.();
      observer.observe(root, { childList: true, subtree: true });
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
      init();
    }

    const disconnect = (): void => {
      disconnected = true;
      stopped = true;
      cancellableWatchers.cancelAll();
      rootPolicies = new WeakMap();
      document.removeEventListener("DOMContentLoaded", init);
      observer.disconnect();
    };

    return { disconnect };
  };

  return {
    excludeRoot(root) {
      rootPolicies.set(root, "exclude");
      cancellableWatchers.cancelInRoot(root, isExcluded);
    },
    includeRoot(root) {
      rootPolicies.set(root, "include");
    },
    isObserved(el) {
      return !stopped && el.isConnected && !isExcluded(el);
    },
    get initialWalkComplete() {
      return initialWalkComplete;
    },
    watchCancellable: cancellableWatchers.watch,
    walk(root) {
      walkImpl?.(root);
    },
    start,
  };
}
