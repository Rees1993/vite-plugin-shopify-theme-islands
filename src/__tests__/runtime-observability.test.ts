import { describe, expect, it, mock } from "bun:test";
import { DEFAULT_DIRECTIVE_SPINE } from "../directive-spine";
import { createRuntimeObservability } from "../runtime-observability";

describe("runtime-observability", () => {
  it("warns once for conflicting same-tag gates until the tag state is cleared", () => {
    const warn = mock(() => {});
    const alpha = document.createElement("same-tag");
    const beta = document.createElement("same-tag");
    alpha.setAttribute("client:defer", "100");
    beta.setAttribute("client:idle", "");
    document.body.append(alpha, beta);

    const observability = createRuntimeObservability({
      debug: true,
      isObserved: () => true,
      console: {
        log: mock(() => {}),
        warn,
      },
    });

    const alphaSignature = DEFAULT_DIRECTIVE_SPINE.planGates(alpha).conflictSignature;
    const betaSignature = DEFAULT_DIRECTIVE_SPINE.planGates(beta).conflictSignature;

    observability.warnOnConflictingLoadGate("same-tag", alpha, alphaSignature);
    observability.warnOnConflictingLoadGate("same-tag", beta, betaSignature);
    observability.warnOnConflictingLoadGate("same-tag", beta, betaSignature);

    expect(warn).toHaveBeenCalledTimes(1);

    observability.clear(["same-tag"]);
    observability.warnOnConflictingLoadGate("same-tag", alpha, alphaSignature);
    observability.warnOnConflictingLoadGate("same-tag", beta, betaSignature);

    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("logs init waits only before the initial walk is complete", () => {
    const log = mock(() => {});
    const element = document.createElement("deferred-tag");
    element.setAttribute("client:defer", "200");

    const observability = createRuntimeObservability({
      debug: true,
      isObserved: () => true,
      console: {
        log,
        warn: mock(() => {}),
      },
    });

    const plan = DEFAULT_DIRECTIVE_SPINE.planGates(element);

    observability.noteInitialWaits("deferred-tag", plan.initialDiagnosticParts, false);
    observability.noteInitialWaits("deferred-tag", plan.initialDiagnosticParts, true);

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("[islands]", '<deferred-tag> waiting · client:defer="200"');
  });
});
