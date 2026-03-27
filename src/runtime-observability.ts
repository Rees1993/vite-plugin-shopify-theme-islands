import type {
  IslandErrorDetail,
  IslandLoadDetail,
} from "./contract.js";
import type { DirectiveSpine, GateResult } from "./directive-spine.js";
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
  spine: DirectiveSpine;
  debug: boolean;
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

  const describeInitialGate = (gate: GateResult): string | null => {
    switch (gate.kind) {
      case "visible":
        return gate.rawValue ? `${gate.attribute}="${gate.rawValue}"` : gate.attribute;
      case "media":
        return gate.rawValue ? `${gate.attribute}="${gate.rawValue}"` : null;
      case "idle":
      case "defer":
      case "interaction":
        return gate.rawValue ? `${gate.attribute}="${gate.rawValue}"` : gate.attribute;
      case "custom":
        return gate.value ? `${gate.attribute}="${gate.value}"` : gate.attribute;
    }
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

      const parts = deps.spine
        .readGates(element)
        .map(describeInitialGate)
        .filter((part): part is string => part !== null);

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
        gates.add(deps.spine.describe(candidate));
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
