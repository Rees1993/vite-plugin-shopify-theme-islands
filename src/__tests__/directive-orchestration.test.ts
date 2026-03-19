import { describe, expect, it, mock } from "bun:test";
import { DEFAULT_DIRECTIVES } from "../contract";
import { createDirectiveLogger, createDirectiveOrchestrator } from "../directive-orchestration";

const flush = (ms = 20) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("directive-orchestration", () => {
  it("runs built-ins in order and falls through when no custom directives match", async () => {
    const sequence: string[] = [];
    const orchestrator = createDirectiveOrchestrator({
      waitVisible: async () => {
        sequence.push("visible");
      },
      waitMedia: async () => {
        sequence.push("media");
      },
      waitIdle: async () => {
        sequence.push("idle");
      },
      waitDelay: async () => {
        sequence.push("defer");
      },
      waitInteraction: async () => {
        sequence.push("interaction");
      },
    });
    const run = mock(async () => {});
    const onError = mock((_attrName: string, _err: unknown) => {});
    const element = document.createElement("x-orchestrated");
    element.setAttribute("client:visible", "");
    element.setAttribute("client:media", "(min-width: 1px)");
    element.setAttribute("client:idle", "20");
    element.setAttribute("client:defer", "30");
    element.setAttribute("client:interaction", "");

    const matched = await orchestrator.run({
      tagName: "x-orchestrated",
      element,
      directives: DEFAULT_DIRECTIVES,
      directiveTimeout: 0,
      watchCancellable: mock(() => () => {}),
      log: createDirectiveLogger("x-orchestrated", false),
      run,
      onError,
    });

    expect(sequence).toEqual(["visible", "media", "idle", "defer", "interaction"]);
    expect(matched).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("keeps custom directives AND-latched until all of them call load()", async () => {
    const orchestrator = createDirectiveOrchestrator();
    const run = mock(async () => {});
    const onError = mock((_attrName: string, _err: unknown) => {});
    const element = document.createElement("x-and-latch");
    element.setAttribute("client:on-a", "");
    element.setAttribute("client:on-b", "");
    let loadA!: () => Promise<void>;
    let loadB!: () => Promise<void>;
    const customDirectives = new Map([
      [
        "client:on-a",
        mock((load: () => Promise<void>) => {
          loadA = load;
        }),
      ],
      [
        "client:on-b",
        mock((load: () => Promise<void>) => {
          loadB = load;
        }),
      ],
    ]);

    const matched = await orchestrator.run({
      tagName: "x-and-latch",
      element,
      directives: DEFAULT_DIRECTIVES,
      customDirectives,
      directiveTimeout: 0,
      watchCancellable: mock(() => () => {}),
      log: createDirectiveLogger("x-and-latch", false),
      run,
      onError,
    });

    expect(matched).toBe(true);
    expect(run).not.toHaveBeenCalled();

    await loadA();
    await flush();
    expect(run).not.toHaveBeenCalled();

    await loadB();
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("fires a timeout error when a matched custom directive never calls load()", async () => {
    const orchestrator = createDirectiveOrchestrator();
    const run = mock(async () => {});
    const onError = mock((_attrName: string, _err: unknown) => {});
    const element = document.createElement("x-timeout");
    element.setAttribute("client:on-click", "");
    const customDirectives = new Map([
      [
        "client:on-click",
        mock(() => {
          /* intentionally never calls load */
        }),
      ],
    ]);

    const matched = await orchestrator.run({
      tagName: "x-timeout",
      element,
      directives: DEFAULT_DIRECTIVES,
      customDirectives,
      directiveTimeout: 1,
      watchCancellable: mock(() => () => {}),
      log: createDirectiveLogger("x-timeout", false),
      run,
      onError,
    });

    expect(matched).toBe(true);
    await flush(15);
    expect(run).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBe("client:on-click");
    expect(String(onError.mock.calls[0][1])).toContain("timed out after 1ms");
  });
});
