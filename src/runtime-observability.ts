export interface RuntimeObservability {
  noteInitialWaits(
    tagName: string,
    initialDiagnosticParts: string[],
    initialWalkComplete: boolean,
  ): void;
  warnOnConflictingLoadGate(tagName: string, element: HTMLElement, conflictSignature: string): void;
  clear(tagNames?: Iterable<string>): void;
}

export interface RuntimeObservabilityDeps {
  debug: boolean;
  isObserved(element: Element): boolean;
  console: Pick<Console, "log" | "warn">;
}

export function createRuntimeObservability(deps: RuntimeObservabilityDeps): RuntimeObservability {
  const discoveredElementsByTag = new Map<string, Map<HTMLElement, string>>();
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
    noteInitialWaits(tagName, initialDiagnosticParts, initialWalkComplete) {
      if (!deps.debug || initialWalkComplete) return;
      if (initialDiagnosticParts.length > 0)
        deps.console.log(
          "[islands]",
          `<${tagName}> waiting · ${initialDiagnosticParts.join(", ")}`,
        );
    },

    warnOnConflictingLoadGate(tagName, element, conflictSignature) {
      if (!deps.debug) return;

      const elementSignatures =
        discoveredElementsByTag.get(tagName) ?? new Map<HTMLElement, string>();
      elementSignatures.set(element, conflictSignature);
      discoveredElementsByTag.set(tagName, elementSignatures);

      const gates = new Set<string>();
      for (const [candidate, sig] of elementSignatures) {
        if (!candidate.isConnected || !deps.isObserved(candidate)) {
          elementSignatures.delete(candidate);
          continue;
        }
        gates.add(sig);
      }

      if (elementSignatures.size === 0) {
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
  };
}
