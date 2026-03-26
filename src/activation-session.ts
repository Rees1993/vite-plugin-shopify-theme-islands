import type {
  ClientDirective,
  IslandErrorDetail,
  IslandLoadDetail,
  IslandLoader,
  NormalizedReviveOptions,
} from "./contract.js";
import {
  createDirectiveOrchestrator,
  DirectiveCancelledError,
  type DirectiveOrchestrator,
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
  settleFailure(tag: string): { retryDelayMs: number | null; attempt: number };
  evict(tag: string): void;
  watchCancellable(el: Element, cancel: () => void): () => void;
  walk(root: HTMLElement): void;
}

export interface ActivationPlatform {
  now(): number;
  console: Pick<Console, "error">;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
}

export interface ActivationSessionDeps {
  directives: NormalizedReviveOptions["directives"];
  directiveTimeout: number;
  customDirectives?: Map<string, ClientDirective>;
  orchestrator?: DirectiveOrchestrator;
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

export function createActivationSession(deps: ActivationSessionDeps): ActivationSession {
  const orchestrator = deps.orchestrator ?? createDirectiveOrchestrator();
  const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const clearRetryTimer = (tagName: string): void => {
    const timer = retryTimers.get(tagName);
    if (timer === undefined) return;
    deps.platform.clearTimeout(timer);
    retryTimers.delete(tagName);
  };

  const clearRetryTimers = (tagNames?: Iterable<string>): void => {
    if (tagNames) {
      for (const tagName of tagNames) clearRetryTimer(tagName);
      return;
    }

    for (const timer of retryTimers.values()) deps.platform.clearTimeout(timer);
    retryTimers.clear();
  };

  const clear = (tagNames?: Iterable<string>): void => {
    if (tagNames) {
      const tags = [...tagNames];
      clearRetryTimers(tags);
      deps.observability.clear(tags);
      for (const tagName of tags) {
        deps.ownership.evict(tagName);
      }
      return;
    }

    clearRetryTimers();
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
    clearRetryTimer(tagName);
    deps.ownership.evict(tagName);
    log.flush(attrName === null ? "aborted (directive error)" : "aborted (custom directive error)");
  };

  const discover = (tagName: string, element: HTMLElement): void => {
    deps.observability.warnOnConflictingLoadGate(tagName, element);
  };

  const activate = async ({ tagName, element, loader }: ActivationCandidate): Promise<void> => {
    deps.observability.noteInitialWaits(tagName, element, deps.ownership.initialWalkComplete);
    const log = deps.observability.createLogger(tagName);

    const abortIfInactive = (): boolean => {
      if (deps.ownership.isObserved(element)) return false;
      clearRetryTimer(tagName);
      deps.ownership.evict(tagName);
      return true;
    };

    const runLoader = (): Promise<void> => {
      if (abortIfInactive()) return Promise.resolve();
      const startedAt = deps.platform.now();
      return loader()
        .then(() => {
          if (abortIfInactive()) return;
          clearRetryTimer(tagName);
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
          const { retryDelayMs, attempt } = deps.ownership.settleFailure(tagName);
          deps.observability.dispatchError({
            tag: tagName,
            error,
            attempt,
          } satisfies IslandErrorDetail);
          if (retryDelayMs !== null) {
            clearRetryTimer(tagName);
            const timer = deps.platform.setTimeout(() => {
              retryTimers.delete(tagName);
              void runLoader();
            }, retryDelayMs);
            retryTimers.set(tagName, timer);
          }
        });
    };

    try {
      const delegatedToCustomDirectives = await orchestrator.run({
        tagName,
        element,
        directives: deps.directives,
        customDirectives: deps.customDirectives,
        directiveTimeout: deps.directiveTimeout,
        watchCancellable: deps.ownership.watchCancellable,
        log,
        run: runLoader,
        onError: (attrName, error) => handleDirectiveError(tagName, error, attrName, log),
      });
      if (delegatedToCustomDirectives) return;
    } catch (error) {
      handleDirectiveError(tagName, error, null, log);
      return;
    }

    log.flush("triggered");
    await runLoader();
  };

  return {
    discover,
    activate,
    clear,
  };
}
