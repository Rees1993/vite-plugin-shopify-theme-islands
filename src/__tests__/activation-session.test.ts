import { describe, expect, it, mock } from "bun:test";
import type { ClientDirective, IslandLoader } from "../contract";
import { createActivationSession, type ActivationCandidate } from "../activation-session";
import {
  createDirectiveSpine,
  DEFAULT_DIRECTIVE_SPINE,
  extendDirectiveSpine,
} from "../directive-spine";
import { DirectiveCancelledError } from "../directive-waiters";

describe("activation-session", () => {
  it("runs built-in gates in order through the activation-session boundary", async () => {
    const sequence: string[] = [];
    const loader = mock<IslandLoader>(async () => {});
    const element = document.createElement("x-built-ins");
    element.setAttribute("client:visible", "");
    element.setAttribute("client:media", "(min-width: 1px)");
    element.setAttribute("client:idle", "20");
    element.setAttribute("client:defer", "30");
    element.setAttribute("client:interaction", "");

    const session = createActivationSession({
      spine: createDirectiveSpine(),
      directiveTimeout: 0,
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
      ownership: {
        initialWalkComplete: true,
        isObserved: () => true,
        settleSuccess: () => 1,
        settleFailure: () => ({ willRetry: false, attempt: 1 }),
        evict: mock((_tag: string) => {}),
        clear: mock((_tags?: Iterable<string>) => {}),
        watchCancellable: mock(() => () => {}),
        walk: mock((_root: HTMLElement) => {}),
      },
      surface: {
        createLogger: () => ({ note() {}, flush() {} }),
        dispatchLoad: mock(() => {}),
        dispatchError: mock((_detail: { tag: string; error: unknown; attempt: number }) => {}),
      },
      observability: {
        noteInitialWaits: mock(() => {}),
        warnOnConflictingLoadGate: mock(() => {}),
        clear: mock(() => {}),
      },
      platform: {
        now: mock(() => 10),
        console: { error: mock(() => {}), warn: mock(() => {}) },
      },
    });

    await session.activate({
      tagName: "x-built-ins",
      element,
      loader,
    });

    expect(sequence).toEqual(["visible", "media", "idle", "defer", "interaction"]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("activates an island and dispatches load through one boundary", async () => {
    const platformConsole = {
      error: mock(() => {}),
      warn: mock(() => {}),
    };
    const loader = mock<IslandLoader>(async () => {});
    const dispatchLoad = mock((_detail: { tag: string; duration: number; attempt: number }) => {});
    const walk = mock((_root: HTMLElement) => {});
    const candidateEl = document.createElement("x-activation");
    candidateEl.appendChild(document.createElement("x-child"));

    const session = createActivationSession({
      spine: DEFAULT_DIRECTIVE_SPINE,
      directiveTimeout: 0,
      ownership: {
        initialWalkComplete: true,
        isObserved: () => true,
        settleSuccess: () => 1,
        settleFailure: () => ({ willRetry: false, attempt: 1 }),
        evict: mock((_tag: string) => {}),
        clear: mock((_tags?: Iterable<string>) => {}),
        watchCancellable: mock(() => () => {}),
        walk,
      },
      surface: {
        createLogger: () => ({ note() {}, flush() {} }),
        dispatchLoad,
        dispatchError: mock((_detail: { tag: string; error: unknown; attempt: number }) => {}),
      },
      observability: {
        noteInitialWaits: mock(() => {}),
        warnOnConflictingLoadGate: mock(() => {}),
        clear: mock(() => {}),
      },
      platform: {
        now: mock(() => 10),
        console: platformConsole,
      },
    });

    const candidate: ActivationCandidate = {
      tagName: "x-activation",
      element: candidateEl,
      loader,
    };

    await session.activate(candidate);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(dispatchLoad).toHaveBeenCalledWith({
      tag: "x-activation",
      duration: 0,
      attempt: 1,
    });
    expect(walk).toHaveBeenCalledWith(candidateEl);
  });

  it("keeps custom directives AND-latched through the activation-session boundary", async () => {
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

    const session = createActivationSession({
      spine: extendDirectiveSpine(createDirectiveSpine(), customDirectives),
      directiveTimeout: 0,
      ownership: {
        initialWalkComplete: true,
        isObserved: () => true,
        settleSuccess: () => 1,
        settleFailure: () => ({ willRetry: false, attempt: 1 }),
        evict: mock((_tag: string) => {}),
        clear: mock((_tags?: Iterable<string>) => {}),
        watchCancellable: mock(() => () => {}),
        walk: mock((_root: HTMLElement) => {}),
      },
      surface: {
        createLogger: () => ({ note() {}, flush() {} }),
        dispatchLoad,
        dispatchError: mock((_detail: { tag: string; error: unknown; attempt: number }) => {}),
      },
      observability: {
        noteInitialWaits: mock(() => {}),
        warnOnConflictingLoadGate: mock(() => {}),
        clear: mock(() => {}),
      },
      platform: {
        now: mock(() => 10),
        console: { error: mock(() => {}), warn: mock(() => {}) },
      },
    });

    const activation = session.activate({
      tagName: "x-latched",
      element,
      loader,
    });

    await Promise.resolve();
    expect(loader).not.toHaveBeenCalled();
    await releaseA();
    expect(loader).not.toHaveBeenCalled();

    await releaseB();
    await activation;

    expect(loader).toHaveBeenCalledTimes(1);
    expect(dispatchLoad).toHaveBeenCalledTimes(1);
  });

  it("treats built-in cancellation as an abort rather than a directive failure", async () => {
    const loader = mock<IslandLoader>(async () => {});
    const dispatchError = mock((_detail: { tag: string; error: unknown; attempt: number }) => {});
    const evict = mock((_tag: string) => {});
    const element = document.createElement("x-cancelled");
    element.setAttribute("client:visible", "");

    let cancel!: () => void;
    let cleanupCalled = false;
    const session = createActivationSession({
      spine: createDirectiveSpine(),
      directiveTimeout: 0,
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
        initialWalkComplete: true,
        isObserved: () => true,
        settleSuccess: () => 1,
        settleFailure: () => ({ willRetry: false, attempt: 1 }),
        evict,
        clear: mock((_tags?: Iterable<string>) => {}),
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
      observability: {
        noteInitialWaits: mock(() => {}),
        warnOnConflictingLoadGate: mock(() => {}),
        clear: mock(() => {}),
      },
      platform: {
        now: mock(() => 10),
        console: { error: mock(() => {}), warn: mock(() => {}) },
      },
    });

    const activation = session.activate({
      tagName: "x-cancelled",
      element,
      loader,
    });

    await Promise.resolve();
    cancel();
    await activation;

    expect(loader).not.toHaveBeenCalled();
    expect(dispatchError).not.toHaveBeenCalled();
    expect(evict).not.toHaveBeenCalled();
    expect(cleanupCalled).toBe(true);
  });

  it("delegates subtree clear to the ownership boundary", async () => {
    const platformConsole = {
      error: mock(() => {}),
      warn: mock(() => {}),
    };
    const loader = mock<IslandLoader>(async () => {
      throw new Error("retry me");
    });
    const evict = mock((_tag: string) => {});
    const clear = mock((_tags?: Iterable<string>) => {});
    const dispatchError = mock((_detail: { tag: string; error: unknown; attempt: number }) => {});

    const session = createActivationSession({
      spine: DEFAULT_DIRECTIVE_SPINE,
      directiveTimeout: 0,
      ownership: {
        initialWalkComplete: true,
        isObserved: () => true,
        settleSuccess: () => 1,
        settleFailure: () => ({ willRetry: true, attempt: 1 }),
        evict,
        clear,
        watchCancellable: mock(() => () => {}),
        walk: mock((_root: HTMLElement) => {}),
      },
      surface: {
        createLogger: () => ({ note() {}, flush() {} }),
        dispatchLoad: mock(() => {}),
        dispatchError,
      },
      observability: {
        noteInitialWaits: mock(() => {}),
        warnOnConflictingLoadGate: mock(() => {}),
        clear: mock(() => {}),
      },
      platform: {
        now: mock(() => 10),
        console: platformConsole,
      },
    });

    await session.activate({
      tagName: "x-retry",
      element: document.createElement("x-retry"),
      loader,
    });

    expect(loader).toHaveBeenCalledTimes(1);
    expect(dispatchError).toHaveBeenCalledTimes(1);

    session.clear(["x-retry"]);

    expect(clear).toHaveBeenCalledTimes(1);
    const tags = clear.mock.calls[0]?.[0];
    expect(tags ? [...tags] : []).toEqual(["x-retry"]);
    expect(evict).not.toHaveBeenCalled();
  });
});
