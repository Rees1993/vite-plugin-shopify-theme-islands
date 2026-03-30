import type {
  ClientDirectiveContext,
  IslandErrorDetail,
  IslandLoadDetail,
  IslandLoader,
} from "./contract.js";
import type { DirectiveSpine, GateResult } from "./directive-spine.js";
import {
  DEFAULT_DIRECTIVE_WAITERS,
  DirectiveCancelledError,
  type DirectiveWaiters,
} from "./directive-orchestration.js";
import type { RuntimeLogger } from "./runtime-surface.js";
import type { RuntimeObservability } from "./runtime-observability.js";

export interface ActivationCandidate {
  tagName: string;
  element: HTMLElement;
  loader: IslandLoader;
}

export interface ActivationOwnership {
  readonly initialWalkComplete: boolean;
  isObserved(el: Element): boolean;
  settleSuccess(tag: string): number;
  settleFailure(tag: string, retry: () => void): { willRetry: boolean; attempt: number };
  evict(tag: string): void;
  clear(tags?: Iterable<string>): void;
  watchCancellable(el: Element, cancel: () => void): () => void;
  walk(root: HTMLElement): void;
}

export interface ActivationPlatform {
  now(): number;
  console: Pick<Console, "error" | "warn">;
}

export interface ActivationSessionDeps {
  spine: DirectiveSpine;
  directiveTimeout: number;
  waiters?: DirectiveWaiters;
  ownership: ActivationOwnership;
  observability: Pick<
    RuntimeObservability,
    | "createLogger"
    | "dispatchLoad"
    | "dispatchError"
    | "noteInitialWaits"
    | "warnOnConflictingLoadGate"
    | "clear"
  >;
  platform: ActivationPlatform;
}

export interface ActivationSession {
  discover(tagName: string, element: HTMLElement): void;
  activate(candidate: ActivationCandidate): Promise<void>;
  clear(tagNames?: Iterable<string>): void;
}

interface BuiltInDirectiveContext {
  tagName: string;
  element: HTMLElement;
  gates: GateResult[];
  waiters: DirectiveWaiters;
  watchCancellable: (el: Element, cancel: () => void) => () => void;
  log: RuntimeLogger;
  warn: Pick<Console, "warn">;
}

interface CustomDirectiveExecutionContext {
  tagName: string;
  element: HTMLElement;
  gates: GateResult[];
  directiveTimeout: number;
  watchCancellable: (el: Element, cancel: () => void) => () => void;
  log: RuntimeLogger;
  run: () => Promise<void>;
  onError(attrName: string, err: unknown): void;
}

async function runBuiltInDirectives(ctx: BuiltInDirectiveContext): Promise<void> {
  const { tagName, element, gates, waiters, watchCancellable, log, warn } = ctx;
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
            warn.warn(
              `[islands] <${tagName}> ${gate.attribute} has no value — media check skipped, island will load immediately`,
            );
            break;
          }
          log.note(`waiting for ${gate.attribute}="${gate.query}"`);
          await waiters.waitMedia(gate.query, controller.signal);
          break;
        case "idle":
          if (gate.invalid) {
            warn.warn(
              `[islands] <${tagName}> invalid ${gate.attribute} value "${gate.rawValue}" — using default ${gate.timeout}ms`,
            );
          }
          log.note(`waiting for ${gate.attribute} (${gate.timeout}ms)`);
          await waiters.waitIdle(gate.timeout, controller.signal);
          break;
        case "defer":
          if (gate.invalid) {
            warn.warn(
              `[islands] <${tagName}> invalid ${gate.attribute} value "${gate.rawValue}" — using default ${gate.delay}ms`,
            );
          }
          log.note(`waiting for ${gate.attribute} (${gate.delay}ms)`);
          await waiters.waitDelay(gate.delay, controller.signal);
          break;
        case "interaction":
          if (gate.emptyTokens) {
            warn.warn(
              `[islands] <${tagName}> ${gate.attribute} has no valid event tokens — using default events`,
            );
          } else if (gate.invalidTokens.length > 0) {
            const countSuffix = gate.invalidTokens.length === 1 ? "" : "s";
            if (!gate.usedDefaultEvents) {
              warn.warn(
                `[islands] <${tagName}> ${gate.attribute} contains unsupported event token${countSuffix} (${gate.invalidTokens.join(", ")}) — ignoring invalid token${countSuffix}; supported tokens: mouseenter, touchstart, focusin`,
              );
            } else {
              warn.warn(
                `[islands] <${tagName}> ${gate.attribute} contains no supported event tokens (${gate.invalidTokens.join(", ")}) — using default events; supported tokens: mouseenter, touchstart, focusin`,
              );
            }
          }
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
  const matched = ctx.gates
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

export function createActivationSession(deps: ActivationSessionDeps): ActivationSession {
  const waiters = deps.waiters ?? DEFAULT_DIRECTIVE_WAITERS;

  const clear = (tagNames?: Iterable<string>): void => {
    if (tagNames) {
      const tags = [...tagNames];
      deps.ownership.clear(tags);
      deps.observability.clear(tags);
      return;
    }

    deps.ownership.clear();
    deps.observability.clear();
  };

  const handleDirectiveError = (
    tagName: string,
    error: unknown,
    attrName: string | null,
    log: RuntimeLogger,
  ): void => {
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

    deps.observability.dispatchError({ tag: tagName, error, attempt: 1 });
    deps.ownership.evict(tagName);
    log.flush(attrName === null ? "aborted (directive error)" : "aborted (custom directive error)");
  };

  const discover = (tagName: string, element: HTMLElement): void => {
    deps.observability.warnOnConflictingLoadGate(tagName, element);
  };

  const activate = async ({ tagName, element, loader }: ActivationCandidate): Promise<void> => {
    deps.observability.noteInitialWaits(tagName, element, deps.ownership.initialWalkComplete);
    const log = deps.observability.createLogger(tagName);
    const gates = deps.spine.readGates(element);

    const abortIfInactive = (): boolean => {
      if (deps.ownership.isObserved(element)) return false;
      deps.ownership.evict(tagName);
      return true;
    };

    const runLoader = (): Promise<void> => {
      if (abortIfInactive()) return Promise.resolve();
      const startedAt = deps.platform.now();
      return loader()
        .then(() => {
          if (abortIfInactive()) return;
          const attempt = deps.ownership.settleSuccess(tagName);
          deps.observability.dispatchLoad({
            tag: tagName,
            duration: deps.platform.now() - startedAt,
            attempt,
          } satisfies IslandLoadDetail);
          if (element.children.length > 0) deps.ownership.walk(element);
        })
        .catch((error) => {
          deps.platform.console.error(`[islands] Failed to load <${tagName}>:`, error);
          const { willRetry, attempt } = deps.ownership.settleFailure(tagName, () => {
            void runLoader();
          });
          deps.observability.dispatchError({
            tag: tagName,
            error,
            attempt,
          } satisfies IslandErrorDetail);
          if (!willRetry) deps.ownership.evict(tagName);
        });
    };

    try {
      await runBuiltInDirectives({
        tagName,
        element,
        gates,
        waiters,
        watchCancellable: deps.ownership.watchCancellable,
        log,
        warn: deps.platform.console,
      });
    } catch (error) {
      handleDirectiveError(tagName, error, null, log);
      return;
    }

    const delegatedToCustomDirectives = runCustomDirectives({
      tagName,
      element,
      gates,
      directiveTimeout: deps.directiveTimeout,
      watchCancellable: deps.ownership.watchCancellable,
      log,
      run: runLoader,
      onError: (attrName, error) => handleDirectiveError(tagName, error, attrName, log),
    });
    if (delegatedToCustomDirectives) return;

    log.flush("triggered");
    await runLoader();
  };

  return {
    discover,
    activate,
    clear,
  };
}
