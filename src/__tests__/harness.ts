import { revive, type ReviveRuntime } from "../runtime";
import type { ReviveOptions } from "../contract";
import type { ClientDirective } from "../index";

export interface CleanupQueue {
  track<T extends () => void>(cleanup: T): T;
  trackRuntime<T extends ReviveRuntime>(runtime: T): T;
  listen(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ): EventListenerOrEventListenerObject;
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
    revive(
      islands: Record<string, () => Promise<unknown>>,
      options?: ReviveOptions,
      customDirectives?: Map<string, ClientDirective>,
    ): ReviveRuntime {
      return cleanups.trackRuntime(revive({ islands, options, customDirectives }));
    },

    track<T extends ReviveRuntime>(runtime: T): T {
      return cleanups.trackRuntime(runtime);
    },
  };
}

export const flush = (ms = 20) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
