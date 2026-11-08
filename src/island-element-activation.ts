import type { ClientDirectiveContext } from "./contract.js";
import type { CustomGateResult, GatePlan, GateResult, GateWarning } from "./directive-spine.js";
import {
  DEFAULT_DIRECTIVE_WAITERS,
  DirectiveCancelledError,
  type DirectiveWaiters,
} from "./directive-waiters.js";
import { formatUnsupportedInteractionTokenWarning } from "./interaction-events.js";
import type { RuntimeLogger } from "./runtime-surface.js";

export interface IslandElementActivationDeps {
  tagName: string;
  element: HTMLElement;
  plan: GatePlan;
  directiveTimeout: number;
  waiters?: DirectiveWaiters;
  signal: AbortSignal;
  log: RuntimeLogger;
  console: Pick<Console, "warn" | "error">;
  run(): Promise<void>;
  onError(error: unknown, attribute: string | null): void;
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
  signal: AbortSignal;
  log: RuntimeLogger;
}

interface CustomDirectiveExecutionContext {
  tagName: string;
  element: HTMLElement;
  gates: CustomGateResult[];
  directiveTimeout: number;
  signal: AbortSignal;
  log: RuntimeLogger;
  run: () => Promise<void>;
  onError(attrName: string, err: unknown): void;
  onCleanupError(err: unknown): void;
}

async function runBuiltInDirectives(ctx: BuiltInDirectiveContext): Promise<void> {
  const { element, gates, waiters, signal, log } = ctx;
  for (const gate of gates) {
    switch (gate.kind) {
      case "visible":
        log.note(`waiting for ${gate.attribute}`);
        await waiters.waitVisible(element, gate.rootMargin, gate.threshold, signal);
        break;
      case "media":
        if (gate.query === null) {
          break;
        }
        log.note(`waiting for ${gate.attribute}="${gate.query}"`);
        await waiters.waitMedia(gate.query, signal);
        break;
      case "idle":
        log.note(`waiting for ${gate.attribute} (${gate.timeout}ms)`);
        await waiters.waitIdle(gate.timeout, signal);
        break;
      case "defer":
        log.note(`waiting for ${gate.attribute} (${gate.delay}ms)`);
        await waiters.waitDelay(gate.delay, signal);
        break;
      case "interaction":
        log.note(`waiting for ${gate.attribute} (${gate.events.join(", ")})`);
        await waiters.waitInteraction(element, gate.events, signal);
        break;
      case "custom":
        break;
    }
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
  const controller = new AbortController();

  const runCleanup = () => {
    if (cleanupRan) return;
    cleanupRan = true;
    ctx.signal?.removeEventListener("abort", abort);
    clearTimeout(timer);
    for (const cleanup of cleanupFns) {
      try {
        cleanup();
      } catch (error) {
        ctx.onCleanupError(error);
      }
    }
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

  ctx.signal?.addEventListener("abort", abort, { once: true });
  if (ctx.signal?.aborted) {
    abort();
    return true;
  }

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
    let opened = false;
    const load = () => {
      if (opened) return Promise.resolve();
      opened = true;
      return loadOnce();
    };
    try {
      Promise.resolve(
        directiveFn(load, { name: attrName, value }, ctx.element, directiveContext),
      ).catch((err) => {
        if (fired || aborted) return;
        abort();
        ctx.onError(attrName, err);
      });
    } catch (err) {
      if (fired || aborted) continue;
      abort();
      ctx.onError(attrName, err);
    }
  }

  return true;
}

export async function activateIslandElement(deps: IslandElementActivationDeps): Promise<void> {
  const { tagName, element, plan, log, signal } = deps;
  for (const warning of plan.warnings) deps.console.warn(formatGateWarning(tagName, warning));
  try {
    await runBuiltInDirectives({
      tagName,
      element,
      gates: plan.gates,
      waiters: deps.waiters ?? DEFAULT_DIRECTIVE_WAITERS,
      signal,
      log,
    });
  } catch (error) {
    if (signal.aborted || error instanceof DirectiveCancelledError) return;
    deps.onError(error, null);
    return;
  }
  if (signal.aborted) return;
  if (
    runCustomDirectives({
      tagName,
      element,
      gates: plan.customGates,
      directiveTimeout: deps.directiveTimeout,
      signal,
      log,
      run: deps.run,
      onError: (attribute, error) => deps.onError(error, attribute),
      onCleanupError: (error) =>
        deps.console.error(`[islands] Custom directive cleanup failed for <${tagName}>:`, error),
    })
  )
    return;
  log.flush("triggered");
  await deps.run();
}
