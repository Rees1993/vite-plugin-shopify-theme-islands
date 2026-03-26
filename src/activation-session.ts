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
import { describeEffectiveLoadGate } from "./load-gates.js";
import type { RuntimeLogger, RuntimeSurface } from "./runtime-surface.js";

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
  console: Pick<Console, "log" | "warn" | "error">;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
}

export interface ActivationSessionDeps {
  directives: NormalizedReviveOptions["directives"];
  debug: boolean;
  directiveTimeout: number;
  customDirectives?: Map<string, ClientDirective>;
  orchestrator?: DirectiveOrchestrator;
  ownership: ActivationOwnership;
  surface: Pick<RuntimeSurface, "createLogger" | "dispatchLoad" | "dispatchError">;
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
  const discoveredElementsByTag = new Map<string, Set<HTMLElement>>();
  const warnedLoadGateSignatures = new Map<string, string>();

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

  const clearLoadGateTracking = (tagNames?: Iterable<string>): void => {
    if (tagNames) {
      for (const tagName of tagNames) {
        discoveredElementsByTag.delete(tagName);
        warnedLoadGateSignatures.delete(tagName);
      }
      return;
    }

    discoveredElementsByTag.clear();
    warnedLoadGateSignatures.clear();
  };

  const clear = (tagNames?: Iterable<string>): void => {
    if (tagNames) {
      for (const tagName of tagNames) {
        clearRetryTimer(tagName);
        discoveredElementsByTag.delete(tagName);
        warnedLoadGateSignatures.delete(tagName);
        deps.ownership.evict(tagName);
      }
      return;
    }

    clearRetryTimers();
    clearLoadGateTracking();
  };

  const logInitialWaits = (tagName: string, element: HTMLElement): void => {
    if (!deps.debug || deps.ownership.initialWalkComplete) return;

    const parts: string[] = [];
    const pushAttr = (attr: string, value: string | null) => {
      if (value !== null) parts.push(value ? `${attr}="${value}"` : attr);
    };

    pushAttr(
      deps.directives.visible.attribute,
      element.getAttribute(deps.directives.visible.attribute),
    );

    const mediaValue = element.getAttribute(deps.directives.media.attribute);
    if (mediaValue) parts.push(`${deps.directives.media.attribute}="${mediaValue}"`);

    pushAttr(deps.directives.idle.attribute, element.getAttribute(deps.directives.idle.attribute));
    pushAttr(
      deps.directives.defer.attribute,
      element.getAttribute(deps.directives.defer.attribute),
    );
    pushAttr(
      deps.directives.interaction.attribute,
      element.getAttribute(deps.directives.interaction.attribute),
    );

    if (deps.customDirectives?.size) {
      for (const attrName of deps.customDirectives.keys()) {
        if (element.hasAttribute(attrName)) parts.push(attrName);
      }
    }

    if (parts.length > 0)
      deps.platform.console.log("[islands]", `<${tagName}> waiting · ${parts.join(", ")}`);
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

    deps.surface.dispatchError({ tag: tagName, error, attempt: 1 });
    clearRetryTimer(tagName);
    deps.ownership.evict(tagName);
    log.flush(attrName === null ? "aborted (directive error)" : "aborted (custom directive error)");
  };

  const discover = (tagName: string, element: HTMLElement): void => {
    if (!deps.debug) return;

    const elements = discoveredElementsByTag.get(tagName) ?? new Set<HTMLElement>();
    elements.add(element);
    discoveredElementsByTag.set(tagName, elements);

    const gates = new Set<string>();
    for (const candidate of elements) {
      if (!candidate.isConnected || !deps.ownership.isObserved(candidate)) {
        elements.delete(candidate);
        continue;
      }
      gates.add(describeEffectiveLoadGate(candidate, deps.directives, deps.customDirectives));
    }

    if (elements.size === 0) {
      discoveredElementsByTag.delete(tagName);
      warnedLoadGateSignatures.delete(tagName);
      return;
    }

    if (gates.size <= 1) {
      warnedLoadGateSignatures.delete(tagName);
      return;
    }

    const signature = [...gates].sort().join(" vs ");
    if (warnedLoadGateSignatures.get(tagName) === signature) return;
    warnedLoadGateSignatures.set(tagName, signature);
    deps.platform.console.warn(
      `[islands] Found same tag <${tagName}> with conflicting directive gates (${signature}). Directives load code at the tag level, so the first-resolved instance wins for this tag.`,
    );
  };

  const activate = async ({ tagName, element, loader }: ActivationCandidate): Promise<void> => {
    logInitialWaits(tagName, element);
    const log = deps.surface.createLogger(tagName, deps.debug);

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
          deps.surface.dispatchLoad({
            tag: tagName,
            duration: deps.platform.now() - startedAt,
            attempt,
          } satisfies IslandLoadDetail);
          if (element.children.length > 0) deps.ownership.walk(element);
        })
        .catch((error) => {
          deps.platform.console.error(`[islands] Failed to load <${tagName}>:`, error);
          const { retryDelayMs, attempt } = deps.ownership.settleFailure(tagName);
          deps.surface.dispatchError({ tag: tagName, error, attempt } satisfies IslandErrorDetail);
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
