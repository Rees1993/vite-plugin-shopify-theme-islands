import type {
  ClientDirective,
  IslandErrorDetail,
  IslandLoadDetail,
  NormalizedReviveOptions,
} from "./contract.js";
import { describeEffectiveLoadGate } from "./load-gates.js";
import type { RuntimeLogger, RuntimeSurface } from "./runtime-surface.js";

export interface RuntimeObservability {
  beginReadyLog(islandCount: number): () => void;
  createLogger(tagName: string): RuntimeLogger;
  noteInitialWaits(tagName: string, element: HTMLElement, initialWalkComplete: boolean): void;
  warnOnConflictingLoadGate(tagName: string, element: HTMLElement): void;
  clear(tagNames?: Iterable<string>): void;
  dispatchLoad(detail: IslandLoadDetail): void;
  dispatchError(detail: IslandErrorDetail): void;
}

export interface RuntimeObservabilityDeps {
  directives: NormalizedReviveOptions["directives"];
  debug: boolean;
  customDirectives?: Map<string, ClientDirective>;
  isObserved(element: Element): boolean;
  surface: Pick<
    RuntimeSurface,
    "beginReadyLog" | "createLogger" | "dispatchLoad" | "dispatchError"
  >;
  console: Pick<Console, "log" | "warn">;
}

export function createRuntimeObservability(deps: RuntimeObservabilityDeps): RuntimeObservability {
  const discoveredElementsByTag = new Map<string, Set<HTMLElement>>();
  const warnedLoadGateSignatures = new Map<string, string>();

  const clear = (tagNames?: Iterable<string>): void => {
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

  return {
    beginReadyLog(islandCount) {
      return deps.surface.beginReadyLog(islandCount, deps.debug);
    },

    createLogger(tagName) {
      return deps.surface.createLogger(tagName, deps.debug);
    },

    noteInitialWaits(tagName, element, initialWalkComplete) {
      if (!deps.debug || initialWalkComplete) return;

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

      pushAttr(
        deps.directives.idle.attribute,
        element.getAttribute(deps.directives.idle.attribute),
      );
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
        deps.console.log("[islands]", `<${tagName}> waiting · ${parts.join(", ")}`);
    },

    warnOnConflictingLoadGate(tagName, element) {
      if (!deps.debug) return;

      const elements = discoveredElementsByTag.get(tagName) ?? new Set<HTMLElement>();
      elements.add(element);
      discoveredElementsByTag.set(tagName, elements);

      const gates = new Set<string>();
      for (const candidate of elements) {
        if (!candidate.isConnected || !deps.isObserved(candidate)) {
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
      deps.console.warn(
        `[islands] Found same tag <${tagName}> with conflicting directive gates (${signature}). Directives load code at the tag level, so the first-resolved instance wins for this tag.`,
      );
    },

    clear,

    dispatchLoad(detail) {
      deps.surface.dispatchLoad(detail);
    },

    dispatchError(detail) {
      deps.surface.dispatchError(detail);
    },
  };
}
