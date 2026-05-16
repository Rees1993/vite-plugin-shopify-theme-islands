import { describe, expect, it, mock } from "bun:test";
import type { ClientDirective, IslandLoader } from "../contract";
import {
  activateIslandElement,
  type IslandElementActivationDeps,
} from "../island-element-activation";
import {
  createDirectiveSpine,
  DEFAULT_DIRECTIVE_SPINE,
  extendDirectiveSpine,
} from "../directive-spine";
import { DirectiveCancelledError } from "../directive-waiters";

function makeDeps(
  overrides: Partial<IslandElementActivationDeps> = {},
): IslandElementActivationDeps {
  const element = overrides.element ?? document.createElement("x-island");
  const plan = overrides.plan ?? DEFAULT_DIRECTIVE_SPINE.planGates(element);
  return {
    tagName: "x-island",
    element,
    loader: mock<IslandLoader>(async () => {}),
    plan,
    directiveTimeout: 0,
    ownership: {
      isObserved: () => true,
      settleSuccess: () => 1,
      settleFailure: () => ({ willRetry: false, attempt: 1 }),
      evict: mock((_tag: string) => {}),
      watchCancellable: mock(() => () => {}),
      walk: mock((_root: HTMLElement) => {}),
    },
    surface: {
      createLogger: () => ({ note() {}, flush() {} }),
      dispatchLoad: mock(() => {}),
      dispatchError: mock((_detail: { tag: string; error: unknown; attempt: number }) => {}),
    },
    platform: {
      now: mock(() => 0),
      console: { error: mock(() => {}), warn: mock(() => {}) },
    },
    ...overrides,
  };
}

describe("activateIslandElement", () => {
  it("runs built-in gates in order", async () => {
    const sequence: string[] = [];
    const element = document.createElement("x-built-ins");
    element.setAttribute("client:visible", "");
    element.setAttribute("client:media", "(min-width: 1px)");
    element.setAttribute("client:idle", "20");
    element.setAttribute("client:defer", "30");
    element.setAttribute("client:interaction", "");

    const plan = createDirectiveSpine().planGates(element);
    await activateIslandElement(
      makeDeps({
        tagName: "x-built-ins",
        element,
        plan,
        waiters: {
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
        },
      }),
    );

    expect(sequence).toEqual(["visible", "media", "idle", "defer", "interaction"]);
  });

  it("dispatches load after successful activation", async () => {
    const loader = mock<IslandLoader>(async () => {});
    const dispatchLoad = mock((_detail: { tag: string; duration: number; attempt: number }) => {});
    const element = document.createElement("x-activation");
    element.appendChild(document.createElement("x-child"));
    const walk = mock((_root: HTMLElement) => {});

    await activateIslandElement(
      makeDeps({
        tagName: "x-activation",
        element,
        loader,
        plan: DEFAULT_DIRECTIVE_SPINE.planGates(element),
        ownership: {
          isObserved: () => true,
          settleSuccess: () => 1,
          settleFailure: () => ({ willRetry: false, attempt: 1 }),
          evict: mock((_tag: string) => {}),
          watchCancellable: mock(() => () => {}),
          walk,
        },
        surface: {
          createLogger: () => ({ note() {}, flush() {} }),
          dispatchLoad,
          dispatchError: mock((_detail: { tag: string; error: unknown; attempt: number }) => {}),
        },
        platform: { now: mock(() => 10), console: { error: mock(() => {}), warn: mock(() => {}) } },
      }),
    );

    expect(loader).toHaveBeenCalledTimes(1);
    expect(dispatchLoad).toHaveBeenCalledWith({ tag: "x-activation", duration: 0, attempt: 1 });
    expect(walk).toHaveBeenCalledWith(element);
  });

  it("keeps custom directives AND-latched", async () => {
    const loader = mock<IslandLoader>(async () => {});
    const dispatchLoad = mock((_detail: { tag: string; duration: number; attempt: number }) => {});
    const element = document.createElement("x-latched");
    element.setAttribute("client:on-a", "");
    element.setAttribute("client:on-b", "");

    let releaseA!: () => Promise<void>;
    let releaseB!: () => Promise<void>;
    const customDirectives = new Map<string, ClientDirective>([
      [
        "client:on-a",
        mock((load: () => Promise<void>) => {
          releaseA = load;
        }),
      ],
      [
        "client:on-b",
        mock((load: () => Promise<void>) => {
          releaseB = load;
        }),
      ],
    ]);

    const spine = extendDirectiveSpine(createDirectiveSpine(), customDirectives);
    const plan = spine.planGates(element);

    const activation = activateIslandElement(
      makeDeps({
        tagName: "x-latched",
        element,
        loader,
        plan,
        surface: {
          createLogger: () => ({ note() {}, flush() {} }),
          dispatchLoad,
          dispatchError: mock((_detail: { tag: string; error: unknown; attempt: number }) => {}),
        },
      }),
    );

    await Promise.resolve();
    expect(loader).not.toHaveBeenCalled();
    await releaseA();
    expect(loader).not.toHaveBeenCalled();
    await releaseB();
    await activation;

    expect(loader).toHaveBeenCalledTimes(1);
    expect(dispatchLoad).toHaveBeenCalledTimes(1);
  });

  it("treats built-in cancellation as abort rather than failure", async () => {
    const loader = mock<IslandLoader>(async () => {});
    const dispatchError = mock((_detail: { tag: string; error: unknown; attempt: number }) => {});
    const evict = mock((_tag: string) => {});
    const element = document.createElement("x-cancelled");
    element.setAttribute("client:visible", "");

    let cancel!: () => void;
    let cleanupCalled = false;
    const plan = createDirectiveSpine().planGates(element);

    const activation = activateIslandElement(
      makeDeps({
        tagName: "x-cancelled",
        element,
        loader,
        plan,
        waiters: {
          waitVisible: (_element, _rootMargin, _threshold, signal) =>
            new Promise<void>((_resolve, reject) => {
              signal.addEventListener(
                "abort",
                () => {
                  reject(new DirectiveCancelledError());
                },
                { once: true },
              );
            }),
          waitMedia: async () => {},
          waitIdle: async () => {},
          waitDelay: async () => {},
          waitInteraction: async () => {},
        },
        ownership: {
          isObserved: () => true,
          settleSuccess: () => 1,
          settleFailure: () => ({ willRetry: false, attempt: 1 }),
          evict,
          watchCancellable: mock((_el, abort) => {
            cancel = abort;
            return () => {
              cleanupCalled = true;
            };
          }),
          walk: mock((_root: HTMLElement) => {}),
        },
        surface: {
          createLogger: () => ({ note() {}, flush() {} }),
          dispatchLoad: mock(() => {}),
          dispatchError,
        },
      }),
    );

    await Promise.resolve();
    cancel();
    await activation;

    expect(loader).not.toHaveBeenCalled();
    expect(dispatchError).not.toHaveBeenCalled();
    expect(evict).not.toHaveBeenCalled();
    expect(cleanupCalled).toBe(true);
  });

  it("emits warnings from plan.warnings", async () => {
    const warn = mock((..._args: unknown[]) => {});
    const element = document.createElement("x-warn");
    element.setAttribute("client:idle", "bad");
    const plan = DEFAULT_DIRECTIVE_SPINE.planGates(element);

    await activateIslandElement(
      makeDeps({
        element,
        plan,
        platform: { now: mock(() => 0), console: { error: mock(() => {}), warn } },
      }),
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0] as string).toContain("invalid client:idle");
  });

  it("schedules retry on loader failure", async () => {
    const error = new Error("load failed");
    let retryFn!: () => void;
    const loader = mock<IslandLoader>(async () => {
      throw error;
    });
    const settleFailure = mock((_tag: string, retry: () => void) => {
      retryFn = retry;
      return { willRetry: true, attempt: 1 };
    });
    const dispatchError = mock((_detail: { tag: string; error: unknown; attempt: number }) => {});

    await activateIslandElement(
      makeDeps({
        loader,
        ownership: {
          isObserved: () => true,
          settleSuccess: () => 1,
          settleFailure,
          evict: mock((_tag: string) => {}),
          watchCancellable: mock(() => () => {}),
          walk: mock((_root: HTMLElement) => {}),
        },
        surface: {
          createLogger: () => ({ note() {}, flush() {} }),
          dispatchLoad: mock(() => {}),
          dispatchError,
        },
      }),
    );

    expect(dispatchError).toHaveBeenCalledWith(
      expect.objectContaining({ tag: "x-island", error, attempt: 1 }),
    );
    expect(typeof retryFn).toBe("function");
  });

  it("evicts on failure when willRetry is false", async () => {
    const error = new Error("fatal");
    const loader = mock<IslandLoader>(async () => {
      throw error;
    });
    const evict = mock((_tag: string) => {});

    await activateIslandElement(
      makeDeps({
        loader,
        ownership: {
          isObserved: () => true,
          settleSuccess: () => 1,
          settleFailure: () => ({ willRetry: false, attempt: 1 }),
          evict,
          watchCancellable: mock(() => () => {}),
          walk: mock((_root: HTMLElement) => {}),
        },
      }),
    );

    expect(evict).toHaveBeenCalledWith("x-island");
  });

  it("evicts silently when no longer observed at load time", async () => {
    const loader = mock<IslandLoader>(async () => {});
    const evict = mock((_tag: string) => {});
    const dispatchLoad = mock(() => {});

    await activateIslandElement(
      makeDeps({
        loader,
        ownership: {
          isObserved: () => false,
          settleSuccess: () => 1,
          settleFailure: () => ({ willRetry: false, attempt: 1 }),
          evict,
          watchCancellable: mock(() => () => {}),
          walk: mock((_root: HTMLElement) => {}),
        },
        surface: {
          createLogger: () => ({ note() {}, flush() {} }),
          dispatchLoad,
          dispatchError: mock(() => {}),
        },
      }),
    );

    expect(evict).toHaveBeenCalledWith("x-island");
    expect(dispatchLoad).not.toHaveBeenCalled();
  });

  it("calls walk after successful load when element has children", async () => {
    const element = document.createElement("x-parent");
    element.appendChild(document.createElement("x-child"));
    const walk = mock((_root: HTMLElement) => {});

    await activateIslandElement(
      makeDeps({
        element,
        plan: DEFAULT_DIRECTIVE_SPINE.planGates(element),
        ownership: {
          isObserved: () => true,
          settleSuccess: () => 1,
          settleFailure: () => ({ willRetry: false, attempt: 1 }),
          evict: mock((_tag: string) => {}),
          watchCancellable: mock(() => () => {}),
          walk,
        },
      }),
    );

    expect(walk).toHaveBeenCalledWith(element);
  });

  it("skips walk when element has no children after load", async () => {
    const element = document.createElement("x-leaf");
    const walk = mock((_root: HTMLElement) => {});

    await activateIslandElement(
      makeDeps({
        element,
        plan: DEFAULT_DIRECTIVE_SPINE.planGates(element),
        ownership: {
          isObserved: () => true,
          settleSuccess: () => 1,
          settleFailure: () => ({ willRetry: false, attempt: 1 }),
          evict: mock((_tag: string) => {}),
          watchCancellable: mock(() => () => {}),
          walk,
        },
      }),
    );

    expect(walk).not.toHaveBeenCalled();
  });
});
