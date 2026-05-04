import type {
  ClientDirectiveContext,
  IslandErrorDetail,
  IslandLoadDetail,
  IslandLoader,
} from "./contract.js";
import type { CustomGateResult, GatePlan, GateResult, GateWarning } from "./directive-spine.js";
import {
  DEFAULT_DIRECTIVE_WAITERS,
  DirectiveCancelledError,
  type DirectiveWaiters,
} from "./directive-waiters.js";
import { formatUnsupportedInteractionTokenWarning } from "./interaction-events.js";
import type { RuntimeLogger, RuntimeSurface } from "./runtime-surface.js";

export interface IslandElementOwnership {
  isObserved(el: Element): boolean;
  settleSuccess(tag: string): number;
  settleFailure(tag: string, retry: () => void): { willRetry: boolean; attempt: number };
  evict(tag: string): void;
  watchCancellable(el: Element, cancel: () => void): () => void;
  walk(root: HTMLElement): void;
}

export interface IslandElementPlatform {
  now(): number;
  console: Pick<Console, "error" | "warn">;
}

export interface IslandElementActivationDeps {
  tagName: string;
  element: HTMLElement;
  loader: IslandLoader;
  plan: GatePlan;
  directiveTimeout: number;
  waiters?: DirectiveWaiters;
  ownership: IslandElementOwnership;
  surface: {
    dispatchLoad: RuntimeSurface["dispatchLoad"];
    dispatchError: RuntimeSurface["dispatchError"];
    createLogger(tagName: string): RuntimeLogger;
  };
  platform: IslandElementPlatform;
}

function formatGateWarning(tagName: string, warning: GateWarning): string {
  switch (warning.kind) {
    case "emptyMediaQuery":
      return `[islands] <${tagName}> ${warning.attribute} has no value — media check skipped, island will load immediately`;
    case "invalidIdleValue":
    case "invalidDeferValue":
      return `[islands] <${tagName}> invalid ${warning.attribute} value "${warning.rawValue}" — using default ${warning.defaultMs}ms`;
    case "emptyInteractionTokens":
      return `[islands] <${tagName}> ${warning.attribute} has no valid event tokens — using default events`;
    case "invalidInteractionTokens":
      return `[islands] <${tagName}> ${formatUnsupportedInteractionTokenWarning({
        attribute: warning.attribute,
        invalidTokens: warning.invalidTokens,
        usedDefaultEvents: warning.usedDefaultEvents,
      })}`;
  }
}

interface BuiltInDirectiveContext {
  tagName: string;
  element: HTMLElement;
  gates: GateResult[];
  waiters: DirectiveWaiters;
  watchCancellable: (el: Element, cancel: () => void) => () => void;
  log: RuntimeLogger;
}

interface CustomDirectiveExecutionContext {
  tagName: string;
  element: HTMLElement;
  gates: CustomGateResult[];
  directiveTimeout: number;
  watchCancellable: (el: Element, cancel: () => void) => () => void;
  log: RuntimeLogger;
  run: () => Promise<void>;
  onError(attrName: string, err: unknown): void;
}

async function runBuiltInDirectives(ctx: BuiltInDirectiveContext): Promise<void> {
  const { element, gates, waiters, watchCancellable, log } = ctx;
  const controller = new AbortController();
  const unwatch = watchCancellable(element, () => controller.abort());

  try {
    for (const gate of gates) {
      switch (gate.kind) {
        case "visible":
          log.note(`waiting for ${gate.attribute}`);
          await waiters.waitVisible(element, gate.rootMargin, gate.threshold, controller.signal);
          break;
        case "media":
          if (gate.query === null) {
            break;
          }
          log.note(`waiting for ${gate.attribute}="${gate.query}"`);
          await waiters.waitMedia(gate.query, controller.signal);
          break;
        case "idle":
          log.note(`waiting for ${gate.attribute} (${gate.timeout}ms)`);
          await waiters.waitIdle(gate.timeout, controller.signal);
          break;
        case "defer":
          log.note(`waiting for ${gate.attribute} (${gate.delay}ms)`);
          await waiters.waitDelay(gate.delay, controller.signal);
          break;
        case "interaction":
          log.note(`waiting for ${gate.attribute} (${gate.events.join(", ")})`);
          await waiters.waitInteraction(element, gate.events, controller.signal);
          break;
        case "custom":
          break;
      }
    }
  } finally {
    unwatch();
  }
}

function runCustomDirectives(ctx: CustomDirectiveExecutionContext): boolean {
  const matched = ctx.gates.map((gate) => [gate.attribute, gate.directive, gate.value] as const);

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
  const controller = new AbortController();

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

interface LoaderRunContext {
  tagName: string;
  element: HTMLElement;
  loader: IslandLoader;
  ownership: Pick<
    IslandElementOwnership,
    "isObserved" | "evict" | "settleSuccess" | "settleFailure" | "walk"
  >;
  surface: Pick<RuntimeSurface, "dispatchLoad" | "dispatchError">;
  platform: IslandElementPlatform;
}

function createLoaderRunner(ctx: LoaderRunContext): () => Promise<void> {
  const { tagName, element, loader, ownership, surface, platform } = ctx;

  const abortIfInactive = (): boolean => {
    if (ownership.isObserved(element)) return false;
    ownership.evict(tagName);
    return true;
  };

  const runLoader = (): Promise<void> => {
    if (abortIfInactive()) return Promise.resolve();
    const startedAt = platform.now();
    return loader()
      .then(() => {
        if (abortIfInactive()) return;
        const attempt = ownership.settleSuccess(tagName);
        surface.dispatchLoad({
          tag: tagName,
          duration: platform.now() - startedAt,
          attempt,
        } satisfies IslandLoadDetail);
        if (element.children.length > 0) ownership.walk(element);
      })
      .catch((error) => {
        platform.console.error(`[islands] Failed to load <${tagName}>:`, error);
        const { willRetry, attempt } = ownership.settleFailure(tagName, () => {
          void runLoader();
        });
        surface.dispatchError({
          tag: tagName,
          error,
          attempt,
        } satisfies IslandErrorDetail);
        if (!willRetry) ownership.evict(tagName);
      });
  };

  return runLoader;
}

function handleDirectiveError(
  tagName: string,
  error: unknown,
  attrName: string | null,
  log: RuntimeLogger,
  deps: Pick<IslandElementActivationDeps, "platform" | "surface" | "ownership">,
): void {
  if (attrName === null && error instanceof DirectiveCancelledError) {
    log.flush("aborted (element removed)");
    return;
  }

  if (attrName !== null) {
    deps.platform.console.error(
      `[islands] Custom directive ${attrName} failed for <${tagName}>:`,
      error,
    );
  } else {
    deps.platform.console.error(`[islands] Built-in directive failed for <${tagName}>:`, error);
  }

  deps.surface.dispatchError({ tag: tagName, error, attempt: 1 });
  deps.ownership.evict(tagName);
  log.flush(attrName === null ? "aborted (directive error)" : "aborted (custom directive error)");
}

export async function activateIslandElement(deps: IslandElementActivationDeps): Promise<void> {
  const { tagName, element, loader, plan, platform, ownership, surface } = deps;
  const waiters = deps.waiters ?? DEFAULT_DIRECTIVE_WAITERS;
  const log = surface.createLogger(tagName);

  for (const warning of plan.warnings) {
    platform.console.warn(formatGateWarning(tagName, warning));
  }

  const runLoader = createLoaderRunner({ tagName, element, loader, ownership, surface, platform });

  try {
    await runBuiltInDirectives({
      tagName,
      element,
      gates: plan.gates,
      waiters,
      watchCancellable: ownership.watchCancellable,
      log,
    });
  } catch (error) {
    handleDirectiveError(tagName, error, null, log, deps);
    return;
  }

  const delegatedToCustomDirectives = runCustomDirectives({
    tagName,
    element,
    gates: plan.customGates,
    directiveTimeout: deps.directiveTimeout,
    watchCancellable: ownership.watchCancellable,
    log,
    run: runLoader,
    onError: (attrName, error) => handleDirectiveError(tagName, error, attrName, log, deps),
  });
  if (delegatedToCustomDirectives) return;

  log.flush("triggered");
  await runLoader();
}
