import type {
  ClientDirectiveContext,
} from "./contract.js";
import { INTERACTION_EVENT_NAMES_LABEL } from "./interaction-events.js";
import type { DirectiveSpine, GateResult } from "./directive-spine.js";
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
  waitInteraction(element: Element, events: string[], signal: AbortSignal): Promise<void>;
}

export interface DirectiveRunContext {
  tagName: string;
  element: HTMLElement;
  spine: DirectiveSpine;
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
    const { tagName, element: el, log, watchCancellable } = ctx;
    const controller = new AbortController();
    const unwatch = watchCancellable(el, () => controller.abort());
    const gates = ctx.spine.readGates(el);

    try {
      for (const gate of gates) {
        switch (gate.kind) {
          case "visible":
            log.note(`waiting for ${gate.attribute}`);
            await waiters.waitVisible(el, gate.rootMargin, gate.threshold, controller.signal);
            break;
          case "media":
            if (gate.query === null) {
              console.warn(
                `[islands] <${tagName}> ${gate.attribute} has no value — media check skipped, island will load immediately`,
              );
              break;
            }
            log.note(`waiting for ${gate.attribute}="${gate.query}"`);
            await waiters.waitMedia(gate.query, controller.signal);
            break;
          case "idle":
            if (gate.invalid) {
              console.warn(
                `[islands] <${tagName}> invalid ${gate.attribute} value "${gate.rawValue}" — using default ${gate.timeout}ms`,
              );
            }
            log.note(`waiting for ${gate.attribute} (${gate.timeout}ms)`);
            await waiters.waitIdle(gate.timeout, controller.signal);
            break;
          case "defer":
            if (gate.invalid) {
              console.warn(
                `[islands] <${tagName}> invalid ${gate.attribute} value "${gate.rawValue}" — using default ${gate.delay}ms`,
              );
            }
            log.note(`waiting for ${gate.attribute} (${gate.delay}ms)`);
            await waiters.waitDelay(gate.delay, controller.signal);
            break;
          case "interaction":
            if (gate.emptyTokens) {
              console.warn(
                `[islands] <${tagName}> ${gate.attribute} has no valid event tokens — using default events`,
              );
            } else if (gate.invalidTokens.length > 0) {
              if (!gate.usedDefaultEvents) {
                console.warn(
                  `[islands] <${tagName}> ${gate.attribute} contains unsupported event token${gate.invalidTokens.length === 1 ? "" : "s"} (${gate.invalidTokens.join(", ")}) — ignoring invalid token${gate.invalidTokens.length === 1 ? "" : "s"}; supported tokens: ${INTERACTION_EVENT_NAMES_LABEL}`,
                );
              } else {
                console.warn(
                  `[islands] <${tagName}> ${gate.attribute} contains no supported event tokens (${gate.invalidTokens.join(", ")}) — using default events; supported tokens: ${INTERACTION_EVENT_NAMES_LABEL}`,
                );
              }
            }
            log.note(`waiting for ${gate.attribute} (${gate.events.join(", ")})`);
            await waiters.waitInteraction(el, gate.events, controller.signal);
            break;
          case "custom":
            break;
        }
      }
    } finally {
      unwatch();
    }
  }

  function runCustomDirectives(ctx: DirectiveRunContext): boolean {
    const matched = ctx.spine
      .readGates(ctx.element)
      .filter((gate): gate is Extract<GateResult, { kind: "custom" }> => gate.kind === "custom")
      .map((gate) => [gate.attribute, gate.directive, gate.value] as const);

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
        ).catch((err) => {
          if (fired) return;
          abort();
          ctx.onError(attrName, err);
        });
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
