import type { ClientDirective, NormalizedReviveOptions } from "./contract.js";
import type { RuntimeLogger } from "./runtime-surface.js";

export interface DirectiveWaiters {
  waitVisible(
    element: Element,
    rootMargin: string,
    threshold: number,
    watch: (el: Element, cancel: () => void) => () => void,
  ): Promise<void>;
  waitMedia(query: string): Promise<void>;
  waitIdle(timeout: number): Promise<void>;
  waitDelay(ms: number): Promise<void>;
  waitInteraction(
    element: Element,
    events: string[],
    watch: (el: Element, cancel: () => void) => () => void,
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
  watch: (el: Element, cancel: () => void) => () => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let unwatch = () => {};
    const finish = (done: () => void) => {
      if (settled) return;
      settled = true;
      unwatch();
      io.disconnect();
      done();
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          finish(resolve);
        }
      },
      { rootMargin, threshold },
    );

    io.observe(element);
    unwatch = watch(element, () => finish(() => reject(new DirectiveCancelledError())));
  });
}

function waitInteraction(
  element: Element,
  events: string[],
  watch: (el: Element, cancel: () => void) => () => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let unwatch = () => {};
    const cleanup = () => {
      for (const name of events) element.removeEventListener(name, handler);
    };
    const finish = (done: () => void) => {
      if (settled) return;
      settled = true;
      unwatch();
      cleanup();
      done();
    };
    const handler = () => {
      finish(resolve);
    };
    for (const name of events) element.addEventListener(name, handler);
    unwatch = watch(element, () => finish(() => reject(new DirectiveCancelledError())));
  });
}

function waitDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitIdle(timeout: number): Promise<void> {
  return new Promise((resolve) => {
    if ("requestIdleCallback" in window) window.requestIdleCallback(() => resolve(), { timeout });
    else setTimeout(resolve, timeout);
  });
}

function waitMedia(query: string): Promise<void> {
  const m = window.matchMedia(query);
  return new Promise((resolve) => {
    if (m.matches) resolve();
    else m.addEventListener("change", () => resolve(), { once: true });
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
    const visibleAttr = directives.visible.attribute;
    if (el.getAttribute(visibleAttr) !== null) {
      log.note(`waiting for ${visibleAttr}`);
      await waiters.waitVisible(
        el,
        el.getAttribute(visibleAttr) || directives.visible.rootMargin,
        directives.visible.threshold,
        watchCancellable,
      );
    }

    const query = el.getAttribute(directives.media.attribute);
    if (query === "") {
      console.warn(
        `[islands] <${tagName}> ${directives.media.attribute} has no value — media check skipped, island will load immediately`,
      );
    } else if (query) {
      log.note(`waiting for ${directives.media.attribute}="${query}"`);
      await waiters.waitMedia(query);
    }

    const idleAttr = el.getAttribute(directives.idle.attribute);
    if (idleAttr !== null) {
      const raw = parseInt(idleAttr, 10);
      const elTimeout = Number.isNaN(raw) ? directives.idle.timeout : raw;
      log.note(`waiting for ${directives.idle.attribute} (${elTimeout}ms)`);
      await waiters.waitIdle(elTimeout);
    }

    const deferAttr = el.getAttribute(directives.defer.attribute);
    if (deferAttr !== null) {
      const msParsed = parseInt(deferAttr, 10);
      if (deferAttr !== "" && Number.isNaN(msParsed)) {
        console.warn(
          `[islands] <${tagName}> invalid ${directives.defer.attribute} value "${deferAttr}" — using default ${directives.defer.delay}ms`,
        );
      }
      const ms = Number.isNaN(msParsed) ? directives.defer.delay : msParsed;
      log.note(`waiting for ${directives.defer.attribute} (${ms}ms)`);
      await waiters.waitDelay(ms);
    }

    const interactionAttr = el.getAttribute(directives.interaction.attribute);
    if (interactionAttr !== null) {
      let events: string[] = [...directives.interaction.events];
      if (interactionAttr) {
        const tokens = interactionAttr.split(/\s+/).filter(Boolean);
        if (tokens.length > 0) events = tokens;
        else {
          console.warn(
            `[islands] <${tagName}> ${directives.interaction.attribute} has no valid event tokens — using default events`,
          );
        }
      }
      log.note(`waiting for ${directives.interaction.attribute} (${events.join(", ")})`);
      await waiters.waitInteraction(el, events, watchCancellable);
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

    const loadOnce = () => {
      if (fired || aborted) return Promise.resolve();
      if (--remaining === 0) {
        clearTimeout(timer);
        fired = true;
        return ctx.run();
      }
      return Promise.resolve();
    };

    if (ctx.directiveTimeout > 0) {
      timer = setTimeout(() => {
        if (fired || aborted) return;
        aborted = true;
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
        Promise.resolve(directiveFn(loadOnce, { name: attrName, value }, ctx.element)).catch(
          (err) => {
            clearTimeout(timer);
            aborted = true;
            ctx.onError(attrName, err);
          },
        );
      } catch (err) {
        clearTimeout(timer);
        aborted = true;
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
