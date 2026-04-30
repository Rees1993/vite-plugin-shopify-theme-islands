import { createCancellableWatchers } from "./cancellable-watchers.js";
import type { IslandLoader } from "./contract.js";
import { createRetryScheduler, type RetryPlatform } from "./retry-scheduler.js";

export interface IslandLifecycleStartInput {
  getRoot(): HTMLElement | null;
  islandMap: Map<string, IslandLoader>;
  onActivate(tagName: string, el: HTMLElement, loader: () => Promise<unknown>): void;
  onDiscover?(tagName: string, el: HTMLElement): void;
  onBeforeInitialWalk?: () => void;
  onInitialWalkComplete?: () => void;
}

export interface IslandLifecycle {
  excludeRoot(root: HTMLElement): void;
  includeRoot(root: HTMLElement): void;
  isObserved(el: Element): boolean;
  settleSuccess(tag: string): number;
  settleFailure(tag: string, retry: () => void): { willRetry: boolean; attempt: number };
  evict(tag: string): void;
  clear(tags?: Iterable<string>): void;
  isQueued(tag: string): boolean;
  readonly initialWalkComplete: boolean;
  watchCancellable(el: Element, cancel: () => void): () => void;
  walk(root: HTMLElement): void;
  start(input: IslandLifecycleStartInput): { disconnect: () => void };
}

export interface IslandLifecyclePlatform extends RetryPlatform {}

export function createIslandLifecycleCoordinator(opts: {
  retries: number;
  retryDelay: number;
  platform?: IslandLifecyclePlatform;
}): IslandLifecycle {
  const queued = new Set<string>();
  const loaded = new Set<string>();
  const retryScheduler = createRetryScheduler({
    retries: opts.retries,
    retryDelay: opts.retryDelay,
    platform: opts.platform,
  });
  const cancellableWatchers = createCancellableWatchers();
  const excludedRoots = new Set<HTMLElement>();
  let initialWalkComplete = false;
  let walkImpl: ((root: HTMLElement) => void) | undefined;

  const isExcluded = (el: Element): boolean => {
    for (const root of excludedRoots) {
      if (el === root || root.contains(el)) return true;
    }
    return false;
  };

  const queue = (tag: string): boolean => {
    if (queued.has(tag) || loaded.has(tag)) return false;
    queued.add(tag);
    return true;
  };

  const settleSuccess = (tag: string): number => {
    const attempt = retryScheduler.attemptOf(tag);
    retryScheduler.cancel(tag);
    queued.delete(tag);
    loaded.add(tag);
    return attempt;
  };

  const settleFailure = (
    tag: string,
    retry: () => void,
  ): { willRetry: boolean; attempt: number } => {
    const result = retryScheduler.scheduleRetry(tag, retry);
    if (!result.willRetry) queued.delete(tag);
    return result;
  };

  const evict = (tag: string): void => {
    retryScheduler.cancel(tag);
    queued.delete(tag);
  };

  const clear = (tags?: Iterable<string>): void => {
    if (tags) {
      for (const tag of tags) evict(tag);
      return;
    }

    retryScheduler.cancelAll();
    queued.clear();
  };

  const isQueued = (tag: string): boolean => queued.has(tag);

  const start = (input: IslandLifecycleStartInput): { disconnect: () => void } => {
    let disconnected = false;
    let initialized = false;

    const customElementFilter: NodeFilter = {
      acceptNode: (node) => {
        if (isExcluded(node as Element)) return NodeFilter.FILTER_REJECT;
        const tag = (node as Element).tagName.toLowerCase();
        if (!tag.includes("-")) return NodeFilter.FILTER_SKIP;
        if (!input.islandMap.has(tag)) return NodeFilter.FILTER_SKIP;
        return NodeFilter.FILTER_ACCEPT;
      },
    };

    const activate = (el: HTMLElement): void => {
      if (isExcluded(el)) return;
      const tagName = el.tagName.toLowerCase();
      const loader = input.islandMap.get(tagName);
      if (!loader) return;
      input.onDiscover?.(tagName, el);

      let ancestor = el.parentElement;
      while (ancestor) {
        if (isQueued(ancestor.tagName.toLowerCase())) return;
        ancestor = ancestor.parentElement;
      }

      if (!queue(tagName)) return;
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
      cancellableWatchers.cancelDetached();
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
      document.removeEventListener("DOMContentLoaded", init);
      observer.disconnect();
    };

    return { disconnect };
  };

  return {
    excludeRoot(root) {
      excludedRoots.add(root);
      cancellableWatchers.cancelInRoot(root);
    },
    includeRoot(root) {
      excludedRoots.delete(root);
    },
    isObserved(el) {
      return !isExcluded(el);
    },
    settleSuccess,
    settleFailure,
    evict,
    clear,
    isQueued,
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
