export interface DirectiveWaiters {
  waitVisible(
    element: Element,
    rootMargin: string,
    threshold: number,
    signal: AbortSignal,
  ): Promise<void>;
  waitMedia(query: string, signal: AbortSignal): Promise<void>;
  waitIdle(timeout: number, signal: AbortSignal): Promise<void>;
  waitDelay(ms: number, signal: AbortSignal): Promise<void>;
  waitInteraction(element: Element, events: string[], signal: AbortSignal): Promise<void>;
}

export class DirectiveCancelledError extends Error {
  constructor() {
    super("[islands] directive cancelled: element removed from DOM");
    this.name = "DirectiveCancelledError";
  }
}

function abortableWait(
  signal: AbortSignal,
  setup: (finish: () => void) => (() => void) | void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DirectiveCancelledError());
      return;
    }

    let settled = false;
    let cleanup = () => {};
    const finish = (done: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      cleanup();
      done();
    };
    const abort = () => finish(() => reject(new DirectiveCancelledError()));

    signal.addEventListener("abort", abort, { once: true });

    try {
      const registeredCleanup = setup(() => finish(resolve));
      cleanup = () => {
        registeredCleanup?.();
      };
      if (settled) cleanup();
    } catch (err) {
      finish(() => reject(err));
    }
  });
}

function waitVisible(
  element: Element,
  rootMargin: string,
  threshold: number,
  signal: AbortSignal,
): Promise<void> {
  return abortableWait(signal, (finish) => {
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) finish();
      },
      { rootMargin, threshold },
    );

    io.observe(element);
    return () => io.disconnect();
  });
}

function waitInteraction(element: Element, events: string[], signal: AbortSignal): Promise<void> {
  return abortableWait(signal, (finish) => {
    const handler = () => {
      finish();
    };
    for (const name of events) element.addEventListener(name, handler);
    return () => {
      for (const name of events) element.removeEventListener(name, handler);
    };
  });
}

function waitDelay(ms: number, signal: AbortSignal): Promise<void> {
  return abortableWait(signal, (finish) => {
    const timer = setTimeout(finish, ms);
    return () => clearTimeout(timer);
  });
}

function waitIdle(timeout: number, signal: AbortSignal): Promise<void> {
  return abortableWait(signal, (finish) => {
    let idleId: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    if ("requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(() => finish(), { timeout });
    } else {
      timer = setTimeout(finish, timeout);
    }

    return () => {
      if ("cancelIdleCallback" in window && idleId !== null) {
        window.cancelIdleCallback(idleId);
      } else if (timer !== null) {
        clearTimeout(timer);
      }
    };
  });
}

function waitMedia(query: string, signal: AbortSignal): Promise<void> {
  const m = window.matchMedia(query);
  return abortableWait(signal, (finish) => {
    if (m.matches) {
      finish();
      return;
    }

    const onChange = () => finish();
    m.addEventListener("change", onChange, { once: true });
    return () => {
      m.removeEventListener("change", onChange);
    };
  });
}

export const DEFAULT_DIRECTIVE_WAITERS: DirectiveWaiters = {
  waitVisible,
  waitMedia,
  waitIdle,
  waitDelay,
  waitInteraction,
};

/** One observer per visibility policy, shared for this Activation session. */
export function createDirectiveWaiters(): DirectiveWaiters {
  interface VisibilityPool {
    observer: IntersectionObserver;
    targets: Map<Element, Set<() => void>>;
  }
  const pools = new Map<string, VisibilityPool>();
  return {
    ...DEFAULT_DIRECTIVE_WAITERS,
    waitVisible(element, rootMargin, threshold, signal) {
      return abortableWait(signal, (finish) => {
        const key = JSON.stringify([rootMargin, threshold]);
        let pool = pools.get(key);
        if (!pool) {
          const targets = new Map<Element, Set<() => void>>();
          const observer = new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                for (const ready of [...(targets.get(entry.target) ?? [])]) ready();
              }
            },
            { rootMargin, threshold },
          );
          pool = { observer, targets };
          pools.set(key, pool);
        }
        const active = pool;
        let callbacks = active.targets.get(element);
        if (!callbacks) {
          callbacks = new Set();
          active.targets.set(element, callbacks);
          active.observer.observe(element);
        }
        callbacks.add(finish);
        return () => {
          callbacks.delete(finish);
          if (callbacks.size === 0) {
            active.targets.delete(element);
            active.observer.unobserve(element);
          }
          if (active.targets.size === 0) {
            active.observer.disconnect();
            pools.delete(key);
          }
        };
      });
    },
  };
}
