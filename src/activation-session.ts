import type { IslandLoader } from "./contract.js";
import type { DirectiveSpine } from "./directive-spine.js";
import { type DirectiveWaiters } from "./directive-waiters.js";
import { activateIslandElement } from "./island-element-activation.js";
import type { RuntimeLogger, RuntimeSurface } from "./runtime-surface.js";
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
  surface: {
    dispatchLoad: RuntimeSurface["dispatchLoad"];
    dispatchError: RuntimeSurface["dispatchError"];
    createLogger(tagName: string): RuntimeLogger;
  };
  observability: Pick<
    RuntimeObservability,
    "noteInitialWaits" | "warnOnConflictingLoadGate" | "clear"
  >;
  platform: ActivationPlatform;
}

export interface ActivationSession {
  discover(tagName: string, element: HTMLElement): void;
  activate(candidate: ActivationCandidate): Promise<void>;
  clear(tagNames?: Iterable<string>): void;
}

export function createActivationSession(deps: ActivationSessionDeps): ActivationSession {
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

  const discover = (tagName: string, element: HTMLElement): void => {
    const plan = deps.spine.planGates(element);
    deps.observability.warnOnConflictingLoadGate(tagName, element, plan.conflictSignature);
  };

  const activate = async ({ tagName, element, loader }: ActivationCandidate): Promise<void> => {
    const plan = deps.spine.planGates(element);
    deps.observability.noteInitialWaits(
      tagName,
      plan.initialDiagnosticParts,
      deps.ownership.initialWalkComplete,
    );

    await activateIslandElement({
      tagName,
      element,
      loader,
      plan,
      directiveTimeout: deps.directiveTimeout,
      waiters: deps.waiters,
      ownership: deps.ownership,
      surface: deps.surface,
      platform: deps.platform,
    });
  };

  return {
    discover,
    activate,
    clear,
  };
}
