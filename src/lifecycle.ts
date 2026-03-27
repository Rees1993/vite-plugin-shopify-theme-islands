import type { IslandLoader } from "./contract.js";

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

export interface IslandLifecyclePlatform {
  setTimeout(fn: () => void, delay: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
}

export function createIslandLifecycleCoordinator(opts: {
  retries: number;
  retryDelay: number;
  platform?: IslandLifecyclePlatform;
}): IslandLifecycle {
  const queued = new Set<string>();
  const loaded = new Set<string>();
  const retryCount = new Map<string, number>();
  const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const cancellableElements = new Map<Element, Set<() => void>>();
  const excludedRoots = new Set<HTMLElement>();
  const platform = opts.platform ?? globalThis;
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

  const clearRetryTimer = (tag: string): void => {
    const timer = retryTimers.get(tag);
    if (timer === undefined) return;
    platform.clearTimeout(timer);
    retryTimers.delete(tag);
  };

  const settleSuccess = (tag: string): number => {
    const attempt = (retryCount.get(tag) ?? 0) + 1;
    clearRetryTimer(tag);
    queued.delete(tag);
    loaded.add(tag);
    retryCount.delete(tag);
    return attempt;
  };

  const settleFailure = (tag: string, retry: () => void): { willRetry: boolean; attempt: number } => {
    const attempt = (retryCount.get(tag) ?? 0) + 1;
    if (attempt <= opts.retries) {
      retryCount.set(tag, attempt);
      clearRetryTimer(tag);
      const timer = platform.setTimeout(() => {
        retryTimers.delete(tag);
        retry();
      }, opts.retryDelay * 2 ** (attempt - 1));
      retryTimers.set(tag, timer);
      return { willRetry: true, attempt };
    }

    clearRetryTimer(tag);
    retryCount.delete(tag);
    queued.delete(tag);
    return { willRetry: false, attempt };
  };

  const evict = (tag: string): void => {
    clearRetryTimer(tag);
    retryCount.delete(tag);
    queued.delete(tag);
  };

  const clear = (tags?: Iterable<string>): void => {
    if (tags) {
      for (const tag of tags) evict(tag);
      return;
    }

    for (const timer of retryTimers.values()) platform.clearTimeout(timer);
    retryTimers.clear();
    retryCount.clear();
    queued.clear();
  };

  const isQueued = (tag: string): boolean => queued.has(tag);

  const watchCancellable = (el: Element, cancel: () => void): (() => void) => {
    const cancels = cancellableElements.get(el) ?? new Set<() => void>();
    cancels.add(cancel);
    cancellableElements.set(el, cancels);
    return () => {
      const activeCancels = cancellableElements.get(el);
      if (!activeCancels) return;
      activeCancels.delete(cancel);
      if (activeCancels.size === 0) cancellableElements.delete(el);
    };
  };

  const cancelDetached = (): void => {
    if (cancellableElements.size === 0) return;
    for (const [el, cancels] of cancellableElements) {
      if (!el.isConnected) {
        cancellableElements.delete(el);
        for (const cancel of cancels) cancel();
      }
    }
  };

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
      cancelDetached();
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
      for (const [el, cancels] of cancellableElements) {
        if (el === root || root.contains(el)) {
          cancellableElements.delete(el);
          for (const cancel of cancels) cancel();
        }
      }
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
    watchCancellable,
    walk(root) {
      walkImpl?.(root);
    },
    start,
  };
}
