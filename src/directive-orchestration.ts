import type {
  ClientDirective,
  ClientDirectiveContext,
  NormalizedReviveOptions,
} from "./contract.js";
import {
  INTERACTION_EVENT_NAMES_LABEL,
  partitionInteractionEventTokens,
} from "./interaction-events.js";
import { getBuiltInLoadGateState } from "./load-gates.js";
import type { RuntimeLogger } from "./runtime-surface.js";

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
  waitInteraction(
    element: Element,
    events: string[],
    signal: AbortSignal,
  ): Promise<void>;
}

export interface DirectiveRunContext {
  tagName: string;
  element: HTMLElement;
  directives: NormalizedReviveOptions["directives"];
  customDirectives?: Map<string, ClientDirective>;
  directiveTimeout: number;
  watchCancellable: (el: Element, cancel: () => void) => () => void;
  log: RuntimeLogger;
  run: () => Promise<void>;
  onError(attrName: string, err: unknown): void;
}

export interface DirectiveOrchestrator {
  run(ctx: DirectiveRunContext): Promise<boolean>;
}

export class DirectiveCancelledError extends Error {
  constructor() {
    super("[islands] directive cancelled: element removed from DOM");
    this.name = "DirectiveCancelledError";
  }
}

function waitVisible(
  element: Element,
  rootMargin: string,
  threshold: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DirectiveCancelledError());
      return;
    }

    let settled = false;
    const finish = (done: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      io.disconnect();
      done();
    };
    const abort = () => finish(() => reject(new DirectiveCancelledError()));
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          finish(resolve);
        }
      },
      { rootMargin, threshold },
    );

    io.observe(element);
    signal.addEventListener("abort", abort, { once: true });
  });
}

function waitInteraction(
  element: Element,
  events: string[],
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DirectiveCancelledError());
      return;
    }

    let settled = false;
    const cleanup = () => {
      for (const name of events) element.removeEventListener(name, handler);
      signal.removeEventListener("abort", abort);
    };
    const finish = (done: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      done();
    };
    const abort = () => finish(() => reject(new DirectiveCancelledError()));
    const handler = () => {
      finish(resolve);
    };
    for (const name of events) element.addEventListener(name, handler);
    signal.addEventListener("abort", abort, { once: true });
  });
}

function waitDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DirectiveCancelledError());
      return;
    }

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(new DirectiveCancelledError());
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function waitIdle(timeout: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DirectiveCancelledError());
      return;
    }

    const abort = () => {
      if ("cancelIdleCallback" in window && idleId !== null) {
        window.cancelIdleCallback(idleId);
      } else if (timer !== null) {
        clearTimeout(timer);
      }
      reject(new DirectiveCancelledError());
    };

    let idleId: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      signal.removeEventListener("abort", abort);
      resolve();
    };

    if ("requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(() => finish(), { timeout });
    } else {
      timer = setTimeout(() => finish(), timeout);
    }

    signal.addEventListener("abort", abort, { once: true });
  });
}

function waitMedia(query: string, signal: AbortSignal): Promise<void> {
  const m = window.matchMedia(query);
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DirectiveCancelledError());
      return;
    }

    if (m.matches) {
      resolve();
      return;
    }

    const onChange = () => {
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      reject(new DirectiveCancelledError());
    };
    const cleanup = () => {
      m.removeEventListener("change", onChange);
      signal.removeEventListener("abort", onAbort);
    };

    m.addEventListener("change", onChange, { once: true });
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function createDirectiveOrchestrator(
  waiters: DirectiveWaiters = {
    waitVisible,
    waitMedia,
    waitIdle,
    waitDelay,
    waitInteraction,
  },
): DirectiveOrchestrator {
  async function runBuiltIns(ctx: DirectiveRunContext): Promise<void> {
    const { tagName, element: el, directives, log, watchCancellable } = ctx;
    const controller = new AbortController();
    const unwatch = watchCancellable(el, () => controller.abort());
    const builtIns = getBuiltInLoadGateState(el, directives);

    try {
      const visibleAttr = directives.visible.attribute;
      if (builtIns.visible !== null) {
        log.note(`waiting for ${visibleAttr}`);
        await waiters.waitVisible(
          el,
          builtIns.visible,
          directives.visible.threshold,
          controller.signal,
        );
      }

      const query = el.getAttribute(directives.media.attribute);
      if (query === "") {
        console.warn(
          `[islands] <${tagName}> ${directives.media.attribute} has no value — media check skipped, island will load immediately`,
        );
      } else if (builtIns.media) {
        log.note(`waiting for ${directives.media.attribute}="${builtIns.media}"`);
        await waiters.waitMedia(builtIns.media, controller.signal);
      }

      if (builtIns.idle !== null) {
        log.note(`waiting for ${directives.idle.attribute} (${builtIns.idle}ms)`);
        await waiters.waitIdle(builtIns.idle, controller.signal);
      }

      const deferAttr = el.getAttribute(directives.defer.attribute);
      if (builtIns.defer !== null) {
        if (deferAttr !== null && deferAttr !== "" && Number.isNaN(parseInt(deferAttr, 10))) {
          console.warn(
            `[islands] <${tagName}> invalid ${directives.defer.attribute} value "${deferAttr}" — using default ${directives.defer.delay}ms`,
          );
        }
        log.note(`waiting for ${directives.defer.attribute} (${builtIns.defer}ms)`);
        await waiters.waitDelay(builtIns.defer, controller.signal);
      }

      const interactionAttr = el.getAttribute(directives.interaction.attribute);
      if (builtIns.interaction !== null) {
        let events: string[] = builtIns.interaction;
        if (interactionAttr) {
          const tokens = interactionAttr.split(/\s+/).filter(Boolean);
          if (tokens.length === 0) {
            console.warn(
              `[islands] <${tagName}> ${directives.interaction.attribute} has no valid event tokens — using default events`,
            );
          } else {
            const { valid, invalid } = partitionInteractionEventTokens(tokens);
            if (invalid.length > 0) {
              if (valid.length > 0) {
                console.warn(
                  `[islands] <${tagName}> ${directives.interaction.attribute} contains unsupported event token${invalid.length === 1 ? "" : "s"} (${invalid.join(", ")}) — ignoring invalid token${invalid.length === 1 ? "" : "s"}; supported tokens: ${INTERACTION_EVENT_NAMES_LABEL}`,
                );
              } else {
                console.warn(
                  `[islands] <${tagName}> ${directives.interaction.attribute} contains no supported event tokens (${invalid.join(", ")}) — using default events; supported tokens: ${INTERACTION_EVENT_NAMES_LABEL}`,
                );
              }
            }
          }
        }
        log.note(`waiting for ${directives.interaction.attribute} (${events.join(", ")})`);
        await waiters.waitInteraction(el, events, controller.signal);
      }
    } finally {
      unwatch();
    }
  }

  function runCustomDirectives(ctx: DirectiveRunContext): boolean {
    const matched: [string, ClientDirective, string][] = [];
    if (ctx.customDirectives) {
      for (const [attrName, directiveFn] of ctx.customDirectives) {
        const value = ctx.element.getAttribute(attrName);
        if (value !== null) matched.push([attrName, directiveFn, value] as const);
      }
    }

    if (matched.length === 0) return false;

    const attrNames = matched.map(([attrName]) => attrName).join(", ");
    ctx.log.flush(`dispatching to custom directive${matched.length === 1 ? "" : "s"} ${attrNames}`);

    let remaining = matched.length;
    let fired = false;
    let aborted = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cleanupRan = false;
    const cleanupFns = new Set<() => void>();
    let unwatch = () => {};

    const runCleanup = () => {
      if (cleanupRan) return;
      cleanupRan = true;
      unwatch();
      clearTimeout(timer);
      for (const cleanup of cleanupFns) cleanup();
      cleanupFns.clear();
    };

    const abort = () => {
      if (aborted) return;
      aborted = true;
      controller.abort();
      runCleanup();
    };

    const controller = new AbortController();
    const directiveContext: ClientDirectiveContext = {
      signal: controller.signal,
      onCleanup(cleanup) {
        if (controller.signal.aborted) {
          cleanup();
          return;
        }
        cleanupFns.add(cleanup);
      },
    };

    const loadOnce = () => {
      if (fired || aborted) return Promise.resolve();
      if (--remaining === 0) {
        fired = true;
        controller.abort();
        runCleanup();
        return ctx.run();
      }
      return Promise.resolve();
    };

    unwatch = ctx.watchCancellable(ctx.element, abort);

    if (ctx.directiveTimeout > 0) {
      timer = setTimeout(() => {
        if (fired || aborted) return;
        abort();
        ctx.onError(
          attrNames,
          new Error(
            `[islands] Custom directive timed out after ${ctx.directiveTimeout}ms for <${ctx.tagName}>`,
          ),
        );
      }, ctx.directiveTimeout);
    }

    for (const [attrName, directiveFn, value] of matched) {
      try {
        Promise.resolve(
          directiveFn(loadOnce, { name: attrName, value }, ctx.element, directiveContext),
        ).catch(
          (err) => {
            if (fired) return;
            abort();
            ctx.onError(attrName, err);
          },
        );
      } catch (err) {
        if (fired) continue;
        abort();
        ctx.onError(attrName, err);
      }
    }

    return true;
  }

  return {
    async run(ctx) {
      await runBuiltIns(ctx);
      return runCustomDirectives(ctx);
    },
  };
}
