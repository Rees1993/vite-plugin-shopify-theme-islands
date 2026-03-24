import type { ClientDirective, IslandLoader, NormalizedReviveOptions } from "./contract.js";
import {
  createDirectiveOrchestrator,
  DirectiveCancelledError,
  type DirectiveOrchestrator,
} from "./directive-orchestration.js";
import type { ActivationLifecycle } from "./activation-lifecycle.js";
import type { RuntimeSurface } from "./runtime-surface.js";

export interface ActivationPipeline {
  activate(tagName: string, el: HTMLElement, loader: IslandLoader): Promise<void>;
  beginInitialWalk(islandCount: number): void;
  completeInitialWalk(): void;
  disconnect(): void;
}

export interface ActivationPipelineDeps {
  directives: NormalizedReviveOptions["directives"];
  customDirectives?: Map<string, ClientDirective>;
  debug: boolean;
  directiveTimeout: number;
  lifecycle: ActivationLifecycle;
  runtimeSurface: RuntimeSurface;
  directiveOrchestrator?: DirectiveOrchestrator;
}

export function createActivationPipeline(deps: ActivationPipelineDeps): ActivationPipeline {
  const directiveOrchestrator = deps.directiveOrchestrator ?? createDirectiveOrchestrator();
  let disconnected = false;
  let endReadyLog: (() => void) | undefined;

  function logWaiting(tagName: string, el: HTMLElement): void {
    if (!deps.debug || deps.lifecycle.initialWalkComplete) return;

    const parts: string[] = [];
    const pushAttr = (attr: string, val: string | null) => {
      if (val !== null) parts.push(val ? `${attr}="${val}"` : attr);
    };

    pushAttr(deps.directives.visible.attribute, el.getAttribute(deps.directives.visible.attribute));
    const mediaVal = el.getAttribute(deps.directives.media.attribute);
    if (mediaVal) parts.push(`${deps.directives.media.attribute}="${mediaVal}"`);
    pushAttr(deps.directives.idle.attribute, el.getAttribute(deps.directives.idle.attribute));
    pushAttr(deps.directives.defer.attribute, el.getAttribute(deps.directives.defer.attribute));
    pushAttr(
      deps.directives.interaction.attribute,
      el.getAttribute(deps.directives.interaction.attribute),
    );

    if (deps.customDirectives?.size) {
      for (const attr of deps.customDirectives.keys()) {
        if (el.hasAttribute(attr)) parts.push(attr);
      }
    }

    if (parts.length > 0) console.log("[islands]", `<${tagName}> waiting · ${parts.join(", ")}`);
  }

  async function activate(tagName: string, el: HTMLElement, loader: IslandLoader): Promise<void> {
    logWaiting(tagName, el);
    const log = deps.runtimeSurface.createLogger(tagName, deps.debug);

    const run = (): Promise<void> => {
      if (disconnected) return Promise.resolve();
      const t0 = performance.now();
      return loader()
        .then(() => {
          const attempt = deps.lifecycle.settleSuccess(tagName);
          deps.runtimeSurface.dispatchLoad({
            tag: tagName,
            duration: performance.now() - t0,
            attempt,
          });
          if (!disconnected && el.children.length) deps.lifecycle.walk(el);
        })
        .catch((err) => {
          console.error(`[islands] Failed to load <${tagName}>:`, err);
          const { retryDelayMs, attempt } = deps.lifecycle.settleFailure(tagName);
          deps.runtimeSurface.dispatchError({ tag: tagName, error: err, attempt });
          if (retryDelayMs !== null) setTimeout(run, retryDelayMs);
        });
    };

    const handleDirectiveError = (attrName: string | null, err: unknown) => {
      if (attrName === null && err instanceof DirectiveCancelledError) return;
      if (attrName !== null) {
        console.error(`[islands] Custom directive ${attrName} failed for <${tagName}>:`, err);
      } else {
        console.error(`[islands] Built-in directive failed for <${tagName}>:`, err);
      }
      deps.runtimeSurface.dispatchError({ tag: tagName, error: err, attempt: 1 });
      deps.lifecycle.evict(tagName);
    };

    try {
      const matchedCustomDirectives = await directiveOrchestrator.run({
        tagName,
        element: el,
        directives: deps.directives,
        customDirectives: deps.customDirectives,
        directiveTimeout: deps.directiveTimeout,
        watchCancellable: deps.lifecycle.watchCancellable,
        log,
        run,
        onError: handleDirectiveError,
      });
      if (matchedCustomDirectives) return;
    } catch (err) {
      handleDirectiveError(null, err);
      log.flush(
        err instanceof DirectiveCancelledError
          ? "aborted (element removed)"
          : "aborted (directive error)",
      );
      return;
    }

    log.flush("triggered");
    void run();
  }

  return {
    activate,

    beginInitialWalk(islandCount) {
      endReadyLog = deps.runtimeSurface.beginReadyLog(islandCount, deps.debug);
    },

    completeInitialWalk() {
      endReadyLog?.();
      endReadyLog = undefined;
    },

    disconnect() {
      disconnected = true;
      endReadyLog?.();
      endReadyLog = undefined;
    },
  };
}
