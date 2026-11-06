import { createRetryScheduler } from "./retry-scheduler.js";
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
  retry: { retries: number; delay: number };
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
  isPending(tagName: string): boolean;
  clear(): void;
}

export function createActivationSession(deps: ActivationSessionDeps): ActivationSession {
  interface PendingElement {
    controller?: AbortController;
    canOwn: boolean;
    unwatch(): void;
  }
  interface TagActivation {
    phase: "waiting" | "loading" | "retrying" | "exhausted" | "loaded";
    elements: Map<HTMLElement, PendingElement>;
    gateElement?: HTMLElement;
  }
  const tags = new Map<string, TagActivation>();
  const retries = createRetryScheduler({
    retries: deps.retry.retries,
    retryDelay: deps.retry.delay,
  });
  let stopped = false;
  const clear = (): void => {
    stopped = true;
    retries.cancelAll();
    for (const tag of tags.keys()) release(tag);
    deps.observability.clear();
  };

  const release = (tag: string): void => {
    const state = tags.get(tag);
    tags.delete(tag);
    retries.cancel(tag);
    deps.observability.clear([tag]);
    for (const work of state?.elements.values() ?? []) {
      work.controller?.abort();
      work.unwatch();
    }
  };

  const discover = (tagName: string, element: HTMLElement): void => {
    const plan = deps.spine.planGates(element);
    deps.observability.warnOnConflictingLoadGate(tagName, element, plan.conflictSignature);
  };

  const activate = async ({ tagName, element, loader }: ActivationCandidate): Promise<void> => {
    if (stopped || !deps.ownership.isObserved(element)) return;
    let state = tags.get(tagName);
    if (!state) {
      state = { phase: "waiting", elements: new Map() };
      tags.set(tagName, state);
    }
    if (state.phase === "loaded" || state.elements.has(element)) return;
    const current = state;
    const work: PendingElement = { canOwn: true, unwatch: () => {} };
    work.unwatch = deps.ownership.watchCancellable(element, () => {
      if (current.elements.get(element) !== work) return;
      current.elements.delete(element);
      if (current.gateElement === element) current.gateElement = undefined;
      work.controller?.abort();
      if (tags.get(tagName) !== current) return;
      if (current.phase === "waiting" && !current.gateElement) {
        const next = [...current.elements.keys()].find(
          (root) => current.elements.get(root)!.canOwn && deps.ownership.isObserved(root),
        );
        if (next) {
          const parked = current.elements.get(next)!;
          current.elements.delete(next);
          parked.unwatch();
          void activate({ tagName, element: next, loader });
          return;
        }
        if (current.elements.size > 0) current.phase = "exhausted";
      }
      if (current.elements.size === 0 && current.phase !== "loading") release(tagName);
    });
    current.elements.set(element, work);
    if (current.phase === "loading" || current.phase === "retrying" || current.gateElement) return;
    if (current.phase === "exhausted") current.phase = "waiting";
    current.gateElement = element;
    const controller = new AbortController();
    work.controller = controller;
    const isActive = (): boolean => {
      if (stopped || tags.get(tagName) !== current) return false;
      if (
        [...current.elements.keys()].some(
          (root) => root.isConnected && deps.ownership.isObserved(root),
        )
      )
        return true;
      release(tagName);
      return false;
    };
    const run = async (): Promise<void> => {
      if (
        controller.signal.aborted ||
        !element.isConnected ||
        !deps.ownership.isObserved(element) ||
        current.phase !== "waiting" ||
        !isActive()
      )
        return;
      current.phase = "loading";
      const attempt = async (): Promise<void> => {
        if (!isActive()) return;
        current.phase = "loading";
        const startedAt = deps.platform.now();
        try {
          await loader();
        } catch (error) {
          if (!isActive()) return;
          deps.platform.console.error(`[islands] Failed to load <${tagName}>:`, error);
          const result = retries.scheduleRetry(tagName, () => {
            void attempt();
          });
          current.phase = result.willRetry ? "retrying" : "exhausted";
          if (!result.willRetry) {
            current.gateElement = undefined;
            for (const work of current.elements.values()) {
              work.canOwn = false;
              work.controller?.abort();
            }
          }
          deps.surface.dispatchError({ tag: tagName, error, attempt: result.attempt });
          return;
        }
        if (!isActive()) return;
        current.phase = "loaded";
        const attemptNumber = retries.attemptOf(tagName);
        retries.cancel(tagName);
        const roots = [...current.elements.keys()];
        const pending = [...current.elements.values()];
        current.elements.clear();
        current.gateElement = undefined;
        for (const work of pending) work.unwatch();
        for (const work of pending) work.controller?.abort();
        if (stopped || tags.get(tagName) !== current) return;
        deps.surface.dispatchLoad({
          tag: tagName,
          duration: deps.platform.now() - startedAt,
          attempt: attemptNumber,
        });
        for (const root of roots) {
          if (root.isConnected && deps.ownership.isObserved(root) && root.children.length)
            deps.ownership.walk(root);
        }
      };
      await attempt();
    };
    const plan = deps.spine.planGates(element);
    const log = deps.surface.createLogger(tagName);
    deps.observability.noteInitialWaits(
      tagName,
      plan.initialDiagnosticParts,
      deps.ownership.initialWalkComplete,
    );

    await activateIslandElement({
      tagName,
      element,
      run,
      onError: (error, attribute) => {
        if (controller.signal.aborted || tags.get(tagName) !== current) return;
        controller.abort();
        if (
          current.phase === "waiting" &&
          [...current.elements.values()].every(
            (work) => !work.controller || work.controller.signal.aborted,
          )
        ) {
          current.phase = "exhausted";
          current.gateElement = undefined;
          for (const work of current.elements.values()) work.canOwn = false;
        }
        deps.platform.console.error(
          attribute === null
            ? `[islands] Built-in directive failed for <${tagName}>:`
            : `[islands] Custom directive ${attribute} failed for <${tagName}>:`,
          error,
        );
        deps.surface.dispatchError({ tag: tagName, error, attempt: 1 });
        log.flush(
          attribute === null ? "aborted (directive error)" : "aborted (custom directive error)",
        );
      },
      signal: controller.signal,
      log,
      console: deps.platform.console,
      plan,
      directiveTimeout: deps.directiveTimeout,
      waiters: deps.waiters,
    });
  };

  return {
    discover,
    activate,
    isPending: (tagName) => {
      const state = tags.get(tagName);
      return !!state && state.phase !== "loaded";
    },
    clear,
  };
}
