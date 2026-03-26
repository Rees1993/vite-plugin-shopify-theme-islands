import { mock } from "bun:test";
import { revive, type ReviveRuntime } from "../runtime";
import type { ReviveOptions, RevivePayload } from "../contract";
import type { ClientDirective } from "../index";

const REAL_SET_TIMEOUT = globalThis.setTimeout.bind(globalThis);

export interface CleanupQueue {
  track<T extends () => void>(cleanup: T): T;
  trackRuntime<T extends ReviveRuntime>(runtime: T): T;
  listen(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ): EventListenerOrEventListenerObject;
  listenCustomEvent<T>(
    target: EventTarget,
    type: string,
    listener: (event: CustomEvent<T>) => void,
    options?: AddEventListenerOptions | boolean,
  ): (event: CustomEvent<T>) => void;
  cleanup(options?: { resetDom?: boolean }): void;
}

export function createCleanupQueue(): CleanupQueue {
  const cleanups: Array<() => void> = [];

  return {
    track<T extends () => void>(cleanup: T): T {
      cleanups.push(cleanup);
      return cleanup;
    },

    trackRuntime<T extends ReviveRuntime>(runtime: T): T {
      cleanups.push(() => runtime.disconnect());
      return runtime;
    },

    listen(
      target: EventTarget,
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: AddEventListenerOptions | boolean,
    ): EventListenerOrEventListenerObject {
      target.addEventListener(type, listener, options);
      cleanups.push(() => target.removeEventListener(type, listener, options));
      return listener;
    },

    listenCustomEvent<T>(
      target: EventTarget,
      type: string,
      listener: (event: CustomEvent<T>) => void,
      options?: AddEventListenerOptions | boolean,
    ): (event: CustomEvent<T>) => void {
      const wrapped: EventListener = (event) => listener(event as CustomEvent<T>);
      target.addEventListener(type, wrapped, options);
      cleanups.push(() => target.removeEventListener(type, wrapped, options));
      return listener;
    },

    cleanup(options?: { resetDom?: boolean }): void {
      while (cleanups.length > 0) {
        cleanups.pop()?.();
      }
      if (options?.resetDom) {
        document.body.innerHTML = "";
      }
    },
  };
}

export function createRuntimeHarness(cleanups: CleanupQueue) {
  return {
    payload(
      islands: Record<string, () => Promise<unknown>>,
      options?: ReviveOptions,
      customDirectives?: Map<string, ClientDirective>,
    ): RevivePayload {
      return { islands, options, customDirectives };
    },

    start(payload: RevivePayload): ReviveRuntime {
      return cleanups.trackRuntime(revive(payload));
    },

    track<T extends ReviveRuntime>(runtime: T): T {
      return cleanups.trackRuntime(runtime);
    },
  };
}

export interface RuntimeSuite {
  get cleanups(): CleanupQueue;
  get runtime(): ReturnType<typeof createRuntimeHarness>;
  reset(): void;
  cleanup(): void;
}

export function createRuntimeSuite(): RuntimeSuite {
  let cleanups = createCleanupQueue();
  let runtime = createRuntimeHarness(cleanups);

  return {
    get cleanups(): CleanupQueue {
      return cleanups;
    },
    get runtime(): ReturnType<typeof createRuntimeHarness> {
      return runtime;
    },
    reset(): void {
      cleanups = createCleanupQueue();
      runtime = createRuntimeHarness(cleanups);
      document.body.innerHTML = "";
    },
    cleanup(): void {
      cleanups.cleanup({ resetDom: true });
    },
  };
}

export const flush = (ms = 20) => new Promise<void>((resolve) => REAL_SET_TIMEOUT(resolve, ms));

export interface IdleDriver {
  flush(deadline?: IdleDeadline): void;
  get lastOptions(): IdleRequestOptions | undefined;
  pendingCount(): number;
}

export function installIdleDriver(cleanups: CleanupQueue): IdleDriver {
  const callbacks: IdleRequestCallback[] = [];
  let options: IdleRequestOptions | undefined;
  cleanups.track(
    mockRequestIdleCallback((callback, nextOptions) => {
      callbacks.push(callback);
      options = nextOptions;
      return callbacks.length;
    }),
  );

  return {
    flush(deadline: IdleDeadline = { timeRemaining: () => 0, didTimeout: false }): void {
      while (callbacks.length > 0) {
        callbacks.shift()?.(deadline);
      }
    },
    get lastOptions(): IdleRequestOptions | undefined {
      return options;
    },
    pendingCount(): number {
      return callbacks.length;
    },
  };
}

export interface VisibilityDriver {
  disconnect: ReturnType<typeof mock>;
  get options(): IntersectionObserverInit | undefined;
  trigger(target: Element, isIntersecting?: boolean): void;
}

export function installVisibilityDriver(cleanups: CleanupQueue): VisibilityDriver {
  const callbacks: IntersectionObserverCallback[] = [];
  const disconnect = mock(() => {});
  let options: IntersectionObserverInit | undefined;

  cleanups.track(
    mockIntersectionObserver(
      class {
        constructor(callback: IntersectionObserverCallback, init?: IntersectionObserverInit) {
          callbacks.push(callback);
          options = init;
        }
        observe(): void {}
        disconnect = disconnect;
      } as unknown as typeof IntersectionObserver,
    ),
  );

  return {
    disconnect,
    get options(): IntersectionObserverInit | undefined {
      return options;
    },
    trigger(target: Element, isIntersecting = true): void {
      const entry = { isIntersecting, target } as IntersectionObserverEntry;
      for (const callback of callbacks) {
        callback([entry], {} as IntersectionObserver);
      }
    },
  };
}

export interface MediaDriver {
  setMatches(query: string, matches: boolean): void;
  dispatchChange(query: string, matches: boolean): void;
}

export function installMediaDriver(cleanups: CleanupQueue): MediaDriver {
  const states = new Map<string, boolean>();
  const listeners = new Map<string, Array<(event: MediaQueryListEvent) => void>>();

  cleanups.track(
    mockMatchMedia(
      (query) =>
        ({
          get matches() {
            return states.get(query) ?? false;
          },
          media: query,
          addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
            const existing = listeners.get(query) ?? [];
            existing.push(listener);
            listeners.set(query, existing);
          },
          removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
            const existing = listeners.get(query) ?? [];
            listeners.set(
              query,
              existing.filter((candidate) => candidate !== listener),
            );
          },
        }) as unknown as MediaQueryList,
    ),
  );

  return {
    setMatches(query: string, matches: boolean): void {
      states.set(query, matches);
    },
    dispatchChange(query: string, matches: boolean): void {
      states.set(query, matches);
      const event = { matches, media: query } as MediaQueryListEvent;
      for (const listener of listeners.get(query) ?? []) {
        listener(event);
      }
    },
  };
}

export interface MutationDriver {
  trigger(records: MutationRecord[]): void;
  add(node: Node): void;
  remove(node: Node): void;
}

export function installMutationDriver(cleanups: CleanupQueue): MutationDriver {
  const callbacks: MutationCallback[] = [];

  cleanups.track(
    mockMutationObserver(
      class {
        constructor(callback: MutationCallback) {
          callbacks.push(callback);
        }
        observe(): void {}
        disconnect(): void {}
      } as unknown as typeof MutationObserver,
    ),
  );

  const trigger = (records: MutationRecord[]): void => {
    for (const callback of callbacks) {
      callback(records, {} as MutationObserver);
    }
  };

  const add = (node: Node): void => {
    trigger([{ addedNodes: [node], removedNodes: [] } as unknown as MutationRecord]);
  };

  const remove = (node: Node): void => {
    trigger([{ addedNodes: [], removedNodes: [node] } as unknown as MutationRecord]);
  };

  return { trigger, add, remove };
}

export interface TimerDriver {
  advance(ms: number): void;
  pendingCount(): number;
}

export function installTimerDriver(cleanups: CleanupQueue): TimerDriver {
  type ScheduledTimer = { at: number; callback: () => void };
  const timers = new Map<number, ScheduledTimer>();
  let now = 0;
  let nextId = 1;

  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  globalThis.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
    const id = nextId++;
    const fn = typeof callback === "function" ? () => callback(...args) : () => undefined;
    timers.set(id, { at: now + (delay ?? 0), callback: fn });
    return id as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;

  globalThis.clearTimeout = ((timeoutId: ReturnType<typeof setTimeout>) => {
    timers.delete(Number(timeoutId));
  }) as typeof clearTimeout;

  cleanups.track(() => {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  });

  return {
    advance(ms: number): void {
      const target = now + ms;

      while (true) {
        const next = [...timers.entries()]
          .sort((a, b) => a[1].at - b[1].at)
          .find(([, timer]) => timer.at <= target);

        if (!next) break;

        const [id, timer] = next;
        now = timer.at;
        timers.delete(id);
        timer.callback();
      }

      now = target;
    },
    pendingCount(): number {
      return timers.size;
    },
  };
}

export function mockIntersectionObserver(impl: typeof IntersectionObserver): () => void {
  const original = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = impl;
  return () => {
    globalThis.IntersectionObserver = original;
  };
}

export function mockMutationObserver(impl: typeof MutationObserver): () => void {
  const original = globalThis.MutationObserver;
  globalThis.MutationObserver = impl;
  return () => {
    globalThis.MutationObserver = original;
  };
}

export function mockMatchMedia(impl: typeof window.matchMedia): () => void {
  const original = window.matchMedia;
  window.matchMedia = impl;
  return () => {
    window.matchMedia = original;
  };
}

export function mockRequestIdleCallback(impl?: typeof window.requestIdleCallback): () => void {
  const hadRequest = "requestIdleCallback" in window;
  const originalRequest = hadRequest ? window.requestIdleCallback : undefined;

  if (impl) {
    window.requestIdleCallback = impl;
  } else {
    Reflect.deleteProperty(window, "requestIdleCallback");
  }

  return () => {
    if (hadRequest && originalRequest) {
      window.requestIdleCallback = originalRequest;
    } else {
      Reflect.deleteProperty(window, "requestIdleCallback");
    }
  };
}
