import type { IslandErrorDetail, IslandLoadDetail, IslandLoader } from "./contract.js";
import type { DirectiveSpine } from "./directive-spine.js";
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
  settleFailure(tag: string, retry: () => void): { willRetry: boolean; attempt: number };
  evict(tag: string): void;
  clear(tags?: Iterable<string>): void;
  watchCancellable(el: Element, cancel: () => void): () => void;
  walk(root: HTMLElement): void;
}

export interface ActivationPlatform {
  now(): number;
  console: Pick<Console, "error">;
}

export interface ActivationSessionDeps {
  spine: DirectiveSpine;
  directiveTimeout: number;
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
      const delegatedToCustomDirectives = await orchestrator.run({
        tagName,
        element,
        spine: deps.spine,
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
