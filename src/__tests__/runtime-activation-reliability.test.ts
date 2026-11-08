import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import {
  createRuntimeSuite,
  flush,
  installMutationDriver,
  installMediaDriver,
  installIdleDriver,
  installTimerDriver,
  installVisibilityDriver,
} from "./utils/harness";

const suite = createRuntimeSuite();
beforeEach(() => suite.reset());
afterEach(() => suite.cleanup());

describe("shared Tag Activation", () => {
  it("releases an explicitly included child when its excluded ancestor's import finishes", async () => {
    let finish!: () => void;
    const child = mock(async () => {});
    document.body.innerHTML =
      '<section id="parent-root"><excluded-parent><section id="child-root"><retained-child></retained-child></section></excluded-parent></section>';
    const runtime = suite.runtime.start(
      suite.runtime.payload({
        "/excluded-parent.ts": () => new Promise<void>((resolve) => (finish = resolve)),
        "/retained-child.ts": child,
      }),
    );
    await flush(0);
    runtime.observe(document.getElementById("child-root")!);
    runtime.unobserve(document.getElementById("parent-root")!);
    expect(child).not.toHaveBeenCalled();
    finish();
    await flush(0);
    expect(child).toHaveBeenCalledTimes(1);
  });

  it.each(["exclude-child", "disconnect", "detach-child"])(
    "does not release a blocked included child after %s",
    async (action) => {
      let finish!: () => void;
      const child = mock(async () => {});
      document.body.innerHTML =
        '<section id="parent-root"><excluded-parent><section id="child-root"><retained-child></retained-child></section></excluded-parent></section>';
      const runtime = suite.runtime.start(
        suite.runtime.payload({
          "/excluded-parent.ts": () => new Promise<void>((resolve) => (finish = resolve)),
          "/retained-child.ts": child,
        }),
      );
      await flush(0);
      const included = document.getElementById("child-root")!;
      runtime.observe(included);
      runtime.unobserve(document.getElementById("parent-root")!);
      if (action === "exclude-child") runtime.unobserve(included);
      else if (action === "disconnect") runtime.disconnect();
      else included.remove();
      finish();
      await flush(0);
      expect(child).not.toHaveBeenCalled();
    },
  );

  it("keeps the first observed occurrence's Gate policy until it opens or is cancelled", async () => {
    const visibility = installVisibilityDriver(suite.cleanups);
    document.body.innerHTML =
      "<first-owner-gates client:visible></first-owner-gates><first-owner-gates></first-owner-gates>";
    const loader = mock(async () => {});
    suite.runtime.start(suite.runtime.payload({ "/first-owner-gates.ts": loader }));
    await flush(0);
    expect(loader).not.toHaveBeenCalled();
    visibility.trigger(document.querySelector("first-owner-gates")!);
    await flush(0);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("activates a same-Tag replacement after pending Gate cancellation without a manual scan", async () => {
    const mutations = installMutationDriver(suite.cleanups);
    installVisibilityDriver(suite.cleanups);
    document.body.innerHTML = "<pending-replacement client:visible></pending-replacement>";
    const loader = mock(async () => {});
    const errors: unknown[] = [];
    suite.cleanups.listen(document, "islands:error", (event) => errors.push(event.type));
    suite.runtime.start(suite.runtime.payload({ "/pending-replacement.ts": loader }));
    const removed = document.querySelector("pending-replacement")!;
    removed.remove();
    const added = document.createElement("pending-replacement");
    document.body.append(added);
    mutations.trigger([
      { addedNodes: [added], removedNodes: [removed] } as unknown as MutationRecord,
    ]);
    await flush(0);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([]);
  });

  it("releases earlier same-Tag children after a fresh parent recovers an exhausted load", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    suite.cleanups.track(() => error.mockRestore());
    const mutations = installMutationDriver(suite.cleanups);
    let attempts = 0;
    const parent = mock(async () => {
      if (++attempts === 1) throw new Error("controlled failure");
    });
    const alpha = mock(async () => {});
    const beta = mock(async () => {});
    document.body.innerHTML =
      "<later-parent><later-alpha></later-alpha></later-parent><later-parent><later-beta></later-beta></later-parent>";
    suite.runtime.start(
      suite.runtime.payload(
        { "/later-parent.ts": parent, "/later-alpha.ts": alpha, "/later-beta.ts": beta },
        { retry: { retries: 0, delay: 1 } },
      ),
    );
    await flush(0);
    expect(parent).toHaveBeenCalledTimes(1);
    expect(alpha).not.toHaveBeenCalled();
    const fresh = document.createElement("later-parent");
    document.body.append(fresh);
    mutations.add(fresh);
    await flush(0);
    expect(parent).toHaveBeenCalledTimes(2);
    expect(alpha).toHaveBeenCalledTimes(1);
    expect(beta).toHaveBeenCalledTimes(1);
  });

  it("preserves pending Gates in an explicitly included child when its parent is unobserved", async () => {
    const timers = installTimerDriver(suite.cleanups);
    document.body.innerHTML =
      '<section id="parent-root"><section id="child-root"><included-child client:defer="10"></included-child></section></section>';
    const loader = mock(async () => {});
    const runtime = suite.runtime.start(suite.runtime.payload({ "/included-child.ts": loader }));
    const parent = document.getElementById("parent-root")!;
    const child = document.getElementById("child-root")!;
    runtime.observe(parent);
    runtime.observe(child);
    runtime.unobserve(parent);
    timers.advance(10);
    await flush(0);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("ignores a loader success after disconnect, including explicitly included roots", async () => {
    let finish!: () => void;
    const loader = mock(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const child = mock(async () => {});
    const loads: unknown[] = [];
    suite.cleanups.listen(document, "islands:load", (event) => loads.push(event.type));
    document.body.innerHTML =
      '<section id="included"><late-success><late-child></late-child></late-success></section>';
    const runtime = suite.runtime.start(
      suite.runtime.payload({ "/late-success.ts": loader, "/late-child.ts": child }),
    );
    runtime.observe(document.getElementById("included")!);
    await flush(0);
    runtime.disconnect();
    finish();
    await flush(0);
    expect(loads).toEqual([]);
    expect(child).not.toHaveBeenCalled();
  });

  it("does not report or retry a late rejection after its Subtree is unobserved", async () => {
    const timers = installTimerDriver(suite.cleanups);
    let reject!: (error: Error) => void;
    const loader = mock(
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        }),
    );
    const errors: string[] = [];
    suite.cleanups.listen(document, "islands:error", (event) => errors.push(event.type));
    document.body.innerHTML = '<section id="excluded"><late-rejection></late-rejection></section>';
    const runtime = suite.runtime.start(
      suite.runtime.payload({ "/late-rejection.ts": loader }, { retry: { retries: 1, delay: 10 } }),
    );
    await flush(0);
    runtime.unobserve(document.getElementById("excluded")!);
    reject(new Error("obsolete import"));
    await flush(0);
    timers.advance(10);
    await flush(0);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([]);
  });

  it("requires every custom Gate on the owning occurrence when a callback repeats", async () => {
    const releases = new Map<string, Map<string, () => Promise<void>>>();
    const directive =
      (name: string) => (load: () => Promise<void>, _directive: unknown, element: HTMLElement) => {
        const gates = releases.get(element.id) ?? new Map();
        gates.set(name, load);
        releases.set(element.id, gates);
      };
    document.body.innerHTML = '<and-race id="one" client:a client:b></and-race>';
    const loader = mock(async () => {});
    suite.runtime.start(
      suite.runtime.payload(
        { "/and-race.ts": loader },
        undefined,
        new Map([
          ["client:a", directive("a")],
          ["client:b", directive("b")],
        ]),
      ),
    );
    await flush(0);
    await releases.get("one")!.get("a")!();
    await releases.get("one")!.get("a")!();
    expect(loader).not.toHaveBeenCalled();
    await releases.get("one")!.get("b")!();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("holds child Activation behind an exhausted parent until a fresh parent succeeds", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    suite.cleanups.track(() => error.mockRestore());
    let attempts = 0;
    const parent = mock(async () => {
      if (++attempts === 1) throw new Error("controlled failure");
    });
    const child = mock(async () => {});
    document.body.innerHTML = "<held-parent><held-child></held-child></held-parent>";
    const runtime = suite.runtime.start(
      suite.runtime.payload(
        { "/held-parent.ts": parent, "/held-child.ts": child },
        { retry: { retries: 0, delay: 1 } },
      ),
    );
    await flush(0);
    runtime.scan();
    await flush(0);
    expect(child).not.toHaveBeenCalled();
    const fresh = document.createElement("held-parent");
    document.body.append(fresh);
    runtime.scan(fresh);
    await flush(0);
    expect(parent).toHaveBeenCalledTimes(2);
    expect(child).toHaveBeenCalledTimes(1);
  });

  it("shares an unabortable import with a replacement after the initiating root is unobserved", async () => {
    let finish!: () => void;
    const loader = mock(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const child = mock(async () => {});
    document.body.innerHTML = '<section id="old-root"><import-race></import-race></section>';
    const runtime = suite.runtime.start(
      suite.runtime.payload({ "/import-race.ts": loader, "/import-child.ts": child }),
    );
    const oldRoot = document.getElementById("old-root")!;
    runtime.observe(oldRoot);
    await flush(0);
    runtime.unobserve(oldRoot);
    const replacement = document.createElement("import-race");
    replacement.innerHTML = "<import-child></import-child>";
    document.body.append(replacement);
    runtime.scan(replacement);
    await flush(0);
    expect(loader).toHaveBeenCalledTimes(1);
    finish();
    await flush(0);
    expect(child).toHaveBeenCalledTimes(1);
  });

  it("ignores a custom Gate rejection after that occurrence is removed", async () => {
    const mutations = installMutationDriver(suite.cleanups);
    let reject!: (error: Error) => void;
    const errors: string[] = [];
    suite.cleanups.listen(document, "islands:error", (event) => errors.push(event.type));
    const loader = mock(async () => {});
    document.body.innerHTML = "<stale-gate client:reject></stale-gate>";
    suite.runtime.start(
      suite.runtime.payload(
        { "/stale-gate.ts": loader },
        undefined,
        new Map([
          [
            "client:reject",
            () =>
              new Promise<void>((_resolve, fail) => {
                reject = fail;
              }),
          ],
        ]),
      ),
    );
    await flush(0);
    const removed = document.querySelector("stale-gate")!;
    removed.remove();
    const replacement = document.createElement("stale-gate");
    document.body.append(replacement);
    mutations.trigger([
      { addedNodes: [replacement], removedNodes: [removed] } as unknown as MutationRecord,
    ]);
    reject(new Error("obsolete Gate"));
    await flush(0);
    expect(errors).toEqual([]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("restarts a cancelled Gate when the same element is observed again", async () => {
    const timers = installTimerDriver(suite.cleanups);
    document.body.innerHTML =
      '<section id="reobserved"><returning-gate client:defer="10"></returning-gate></section>';
    const loader = mock(async () => {});
    const runtime = suite.runtime.start(suite.runtime.payload({ "/returning-gate.ts": loader }));
    const root = document.getElementById("reobserved")!;
    runtime.unobserve(root);
    runtime.observe(root);
    timers.advance(10);
    await flush(0);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("discovers new Islands in an included child during a scan through its excluded parent", async () => {
    document.body.innerHTML =
      '<section id="excluded-parent"><section id="included-child"></section></section>';
    const loader = mock(async () => {});
    const runtime = suite.runtime.start(suite.runtime.payload({ "/nested-scan.ts": loader }));
    const parent = document.getElementById("excluded-parent")!;
    const child = document.getElementById("included-child")!;
    runtime.observe(child);
    runtime.unobserve(parent);
    child.innerHTML = "<nested-scan></nested-scan>";
    runtime.scan();
    await flush(0);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("keeps one shared attempt for repeated occurrences with timed Gates", async () => {
    const timers = installTimerDriver(suite.cleanups);
    let finish!: () => void;
    const loader = mock(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const loads: string[] = [];
    suite.cleanups.listen(document, "islands:load", (event) => loads.push(event.type));
    document.body.innerHTML =
      '<simultaneous-gates client:defer="10"></simultaneous-gates><simultaneous-gates client:defer="10"></simultaneous-gates>';
    suite.runtime.start(suite.runtime.payload({ "/simultaneous-gates.ts": loader }));
    timers.advance(10);
    await flush(0);
    expect(loader).toHaveBeenCalledTimes(1);
    finish();
    await flush(0);
    expect(loads).toEqual(["islands:load"]);
  });

  it("cancels a Gate moved into an excluded root while a sibling remains observed", async () => {
    const mutations = installMutationDriver(suite.cleanups);
    const releases = new Map<string, () => Promise<void>>();
    const signals = new Map<string, AbortSignal>();
    const loader = mock(async () => {});
    document.body.innerHTML =
      '<moved-gate id="moved" client:hold></moved-gate><moved-gate id="parked" client:hold></moved-gate><section id="excluded"></section>';
    const runtime = suite.runtime.start(
      suite.runtime.payload(
        { "/moved-gate.ts": loader },
        undefined,
        new Map([
          [
            "client:hold",
            (load, _directive, element, ctx) => {
              releases.set(element.id, load);
              signals.set(element.id, ctx.signal);
            },
          ],
        ]),
      ),
    );
    await flush(0);
    const root = document.getElementById("excluded")!;
    runtime.unobserve(root);
    const moved = document.getElementById("moved")!;
    root.append(moved);
    mutations.add(moved);
    await releases.get("moved")!();
    expect(signals.get("moved")!.aborted).toBe(true);
    expect(loader).not.toHaveBeenCalled();
    await releases.get("parked")!();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("shares an in-flight retry with a replacement after the old root is unobserved", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    suite.cleanups.track(() => error.mockRestore());
    const timers = installTimerDriver(suite.cleanups);
    let finish!: () => void;
    let attempts = 0;
    const loader = mock(async () => {
      if (++attempts === 1) throw new Error("controlled failure");
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    document.body.innerHTML = '<section id="retry-root"><retry-import></retry-import></section>';
    const runtime = suite.runtime.start(
      suite.runtime.payload({ "/retry-import.ts": loader }, { retry: { retries: 1, delay: 10 } }),
    );
    await flush(0);
    timers.advance(10);
    await flush(0);
    runtime.unobserve(document.getElementById("retry-root")!);
    const replacement = document.createElement("retry-import");
    document.body.append(replacement);
    runtime.scan(replacement);
    await flush(0);
    expect(loader).toHaveBeenCalledTimes(2);
    finish();
    await flush(0);
  });

  it("respects visibility targets across independently owned Tags", async () => {
    const visibility = installVisibilityDriver(suite.cleanups);
    const media = installMediaDriver(suite.cleanups);
    media.setMatches("(min-width: 1px)", true);
    document.body.innerHTML =
      '<visible-policy id="closed" client:visible client:media="(min-width: 9999px)"></visible-policy><visible-ready id="ready" client:visible client:media="(min-width: 1px)"></visible-ready>';
    const loader = mock(async () => {});
    suite.runtime.start(
      suite.runtime.payload({ "/visible-policy.ts": loader, "/visible-ready.ts": loader }),
    );
    visibility.trigger(document.getElementById("closed")!);
    await flush(0);
    expect(loader).not.toHaveBeenCalled();
    visibility.trigger(document.getElementById("ready")!);
    await flush(0);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("keeps visible, media, idle, defer, interaction and custom Gates sequential", async () => {
    const visibility = installVisibilityDriver(suite.cleanups);
    const media = installMediaDriver(suite.cleanups);
    const idle = installIdleDriver(suite.cleanups);
    const timers = installTimerDriver(suite.cleanups);
    let release!: () => Promise<void>;
    document.body.innerHTML =
      '<ordered-gates client:visible client:media="(min-width: 1px)" client:idle client:defer="10" client:interaction client:last></ordered-gates>';
    const loader = mock(async () => {});
    suite.runtime.start(
      suite.runtime.payload(
        { "/ordered-gates.ts": loader },
        undefined,
        new Map([
          [
            "client:last",
            (load) => {
              release = load;
            },
          ],
        ]),
      ),
    );
    expect(idle.pendingCount()).toBe(0);
    const element = document.querySelector("ordered-gates")!;
    visibility.trigger(element);
    await flush(0);
    expect(idle.pendingCount()).toBe(0);
    media.dispatchChange("(min-width: 1px)", true);
    await flush(0);
    expect(idle.pendingCount()).toBe(1);
    idle.flush();
    await flush(0);
    element.dispatchEvent(new Event("focusin"));
    timers.advance(10);
    await flush(0);
    expect(release).toBeUndefined();
    element.dispatchEvent(new Event("focusin"));
    await flush(0);
    expect(loader).not.toHaveBeenCalled();
    await release();
    expect(loader).toHaveBeenCalledTimes(1);
  });
  it("keeps a successful Tag loaded when a load-event listener unobserves its root", async () => {
    document.body.innerHTML = '<section id="event-root"><event-reentry></event-reentry></section>';
    const root = document.getElementById("event-root")!;
    const loader = mock(async () => {});
    const runtime = suite.runtime.start(suite.runtime.payload({ "/event-reentry.ts": loader }));
    suite.cleanups.listen(document, "islands:load", () => runtime.unobserve(root));
    await flush(0);
    runtime.observe(root);
    await flush(0);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("transfers a cancelled Gate to an already-observed occurrence without manual scan", async () => {
    const mutations = installMutationDriver(suite.cleanups);
    installVisibilityDriver(suite.cleanups);
    document.body.innerHTML =
      '<transfer-owner id="first" client:visible></transfer-owner><transfer-owner></transfer-owner>';
    const loader = mock(async () => {});
    suite.runtime.start(suite.runtime.payload({ "/transfer-owner.ts": loader }));
    await flush(0);
    expect(loader).not.toHaveBeenCalled();
    const first = document.getElementById("first")!;
    first.remove();
    mutations.remove(first);
    await flush(0);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("does not revive exhausted occurrences when a fresh waiting owner is cancelled", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    suite.cleanups.track(() => error.mockRestore());
    const mutations = installMutationDriver(suite.cleanups);
    installVisibilityDriver(suite.cleanups);
    const loader = mock(async () => {
      throw new Error("controlled failure");
    });
    document.body.innerHTML = "<exhausted-owner></exhausted-owner>";
    suite.runtime.start(suite.runtime.payload({ "/exhausted-owner.ts": loader }));
    await flush(0);
    const fresh = document.createElement("exhausted-owner");
    fresh.setAttribute("client:visible", "");
    document.body.append(fresh);
    mutations.add(fresh);
    await flush(0);
    fresh.remove();
    mutations.remove(fresh);
    await flush(0);
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
