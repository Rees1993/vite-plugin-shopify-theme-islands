import { describe, expect, it, mock } from "bun:test";
import { DEFAULT_DIRECTIVES } from "../contract";
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
      directives: DEFAULT_DIRECTIVES,
      debug: true,
      customDirectives: undefined,
      isObserved: () => true,
      surface: {
        createLogger: mock(() => ({ note() {}, flush() {} })),
        beginReadyLog: mock(() => () => {}),
        dispatchLoad: mock(() => {}),
        dispatchError: mock(() => {}),
      },
      console: {
        log: mock(() => {}),
        warn,
      },
    });

    observability.warnOnConflictingLoadGate("same-tag", alpha);
    observability.warnOnConflictingLoadGate("same-tag", beta);
    observability.warnOnConflictingLoadGate("same-tag", beta);

    expect(warn).toHaveBeenCalledTimes(1);

    observability.clear(["same-tag"]);
    observability.warnOnConflictingLoadGate("same-tag", alpha);
    observability.warnOnConflictingLoadGate("same-tag", beta);

    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("logs init waits only before the initial walk is complete", () => {
    const log = mock(() => {});
    const element = document.createElement("deferred-tag");
    element.setAttribute("client:defer", "200");

    const observability = createRuntimeObservability({
      directives: DEFAULT_DIRECTIVES,
      debug: true,
      customDirectives: undefined,
      isObserved: () => true,
      surface: {
        createLogger: mock(() => ({ note() {}, flush() {} })),
        beginReadyLog: mock(() => () => {}),
        dispatchLoad: mock(() => {}),
        dispatchError: mock(() => {}),
      },
      console: {
        log,
        warn: mock(() => {}),
      },
    });

    observability.noteInitialWaits("deferred-tag", element, false);
    observability.noteInitialWaits("deferred-tag", element, true);

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("[islands]", '<deferred-tag> waiting · client:defer="200"');
  });
});
