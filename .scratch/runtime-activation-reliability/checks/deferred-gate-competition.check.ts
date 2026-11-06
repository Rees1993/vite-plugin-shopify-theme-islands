// Deferred enhancement checks. Opt-in only: these intentionally require Gate competition.
// Do not include in bug-fix acceptance until issue 02 is redesigned and performance verified.
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import {
  createRuntimeSuite,
  flush,
  installMutationDriver,
  installMediaDriver,
  installIdleDriver,
  installTimerDriver,
  installVisibilityDriver,
} from "../../../src/__tests__/utils/harness";

const suite = createRuntimeSuite();
beforeEach(() => suite.reset());
afterEach(() => suite.cleanup());

describe("deferred same-Tag Gate competition", () => {
  it("allows an eligible occurrence to activate before an earlier visibility Gate", async () => {
    installVisibilityDriver(suite.cleanups);
    document.body.innerHTML =
      "<competing-gates client:visible></competing-gates><competing-gates></competing-gates>";
    const loader = mock(async () => {});
    suite.runtime.start(suite.runtime.payload({ "/competing-gates.ts": loader }));
    await flush(0);
    expect(loader).toHaveBeenCalledTimes(1);
  });  it("aborts and cleans up a losing custom Gate once when another occurrence wins", async () => {
    let signal!: AbortSignal;
    let lateLoad!: () => Promise<void>;
    const cleanup = mock(() => {});
    const loader = mock(async () => {});
    document.body.innerHTML =
      "<cleanup-race client:hold></cleanup-race><cleanup-race></cleanup-race>";
    const runtime = suite.runtime.start(
      suite.runtime.payload(
        { "/cleanup-race.ts": loader },
        undefined,
        new Map([
          [
            "client:hold",
            (load, _directive, _element, ctx) => {
              signal = ctx.signal;
              lateLoad = load;
              ctx.onCleanup(cleanup);
            },
          ],
        ]),
      ),
    );
    await flush(0);
    expect(signal.aborted).toBe(true);
    expect(cleanup).toHaveBeenCalledTimes(1);
    await lateLoad();
    runtime.disconnect();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
  it("disposes parked Gates when the shared attempt exhausts its retry budget", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    suite.cleanups.track(() => error.mockRestore());
    let signal!: AbortSignal;
    let lateLoad!: () => Promise<void>;
    const loader = mock(async () => {
      throw new Error("controlled failure");
    });
    document.body.innerHTML = "<budget-race></budget-race><budget-race client:hold></budget-race>";
    suite.runtime.start(
      suite.runtime.payload(
        { "/budget-race.ts": loader },
        { retry: { retries: 0, delay: 1 } },
        new Map([
          [
            "client:hold",
            (load, _directive, _element, ctx) => {
              signal = ctx.signal;
              lateLoad = load;
            },
          ],
        ]),
      ),
    );
    await flush(0);
    expect(signal.aborted).toBe(true);
    await lateLoad();
    expect(loader).toHaveBeenCalledTimes(1);
  });
  it("continues disposing losing Gates when one custom cleanup throws", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    suite.cleanups.track(() => error.mockRestore());
    const cleanup = mock(() => {});
    const loader = mock(async () => {});
    document.body.innerHTML =
      "<cleanup-error client:hold></cleanup-error><cleanup-error></cleanup-error>";
    const runtime = suite.runtime.start(
      suite.runtime.payload(
        { "/cleanup-error.ts": loader },
        undefined,
        new Map([
          [
            "client:hold",
            (_load, _directive, _element, ctx) => {
              ctx.onCleanup(() => {
                throw new Error("controlled cleanup failure");
              });
              ctx.onCleanup(cleanup);
            },
          ],
        ]),
      ),
    );
    await flush(0);
    runtime.disconnect();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(loader).toHaveBeenCalledTimes(1);
  });
  it("preserves an active sibling's retry when a competing custom Gate rejects", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    suite.cleanups.track(() => error.mockRestore());
    const timers = installTimerDriver(suite.cleanups);
    let reject!: (error: Error) => void;
    let attempts = 0;
    const parent = mock(async () => {
      if (++attempts === 1) throw new Error("controlled import failure");
    });
    const child = mock(async () => {});
    const loadedAttempts: number[] = [];
    suite.cleanups.listenCustomEvent<{ attempt: number; tag: string }>(
      document,
      "islands:load",
      (event) => {
        if (event.detail.tag === "sibling-retry") loadedAttempts.push(event.detail.attempt);
      },
    );
    document.body.innerHTML =
      "<sibling-retry><retry-child></retry-child></sibling-retry><sibling-retry client:reject></sibling-retry>";
    const runtime = suite.runtime.start(
      suite.runtime.payload(
        { "/sibling-retry.ts": parent, "/retry-child.ts": child },
        { retry: { retries: 1, delay: 10 } },
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
    reject(new Error("competing Gate failure"));
    await flush(0);
    runtime.scan();
    await flush(0);
    expect(child).not.toHaveBeenCalled();
    timers.advance(10);
    await flush(0);
    expect(parent).toHaveBeenCalledTimes(2);
    expect(loadedAttempts).toEqual([2]);
    expect(child).toHaveBeenCalledTimes(1);
  });  it("suppresses success dispatch when losing Gate cleanup disconnects the runtime", async () => {
    document.body.innerHTML =
      "<cleanup-disconnect client:hold></cleanup-disconnect><cleanup-disconnect></cleanup-disconnect>";
    const loads: string[] = [];
    suite.cleanups.listen(document, "islands:load", (event) => loads.push(event.type));
    const runtime = suite.runtime.start(
      suite.runtime.payload(
        { "/cleanup-disconnect.ts": async () => {} },
        undefined,
        new Map([
          [
            "client:hold",
            (_load, _directive, _element, ctx) => {
              ctx.onCleanup(() => runtime.disconnect());
            },
          ],
        ]),
      ),
    );
    await flush(0);
    expect(loads).toEqual([]);
  });
  it("retains successful Tag state when losing Gate cleanup unobserves its root", async () => {
    document.body.innerHTML =
      '<section id="cleanup-root"><cleanup-unobserve client:hold></cleanup-unobserve><cleanup-unobserve></cleanup-unobserve></section>';
    const root = document.getElementById("cleanup-root")!;
    const loader = mock(async () => {});
    const runtime = suite.runtime.start(
      suite.runtime.payload(
        { "/cleanup-unobserve.ts": loader },
        undefined,
        new Map([
          [
            "client:hold",
            (_load, _directive, _element, ctx) => {
              ctx.onCleanup(() => runtime.unobserve(root));
            },
          ],
        ]),
      ),
    );
    await flush(0);
    const fresh = document.createElement("cleanup-unobserve");
    document.body.append(fresh);
    runtime.scan(fresh);
    await flush(0);
    expect(loader).toHaveBeenCalledTimes(1);
  });  it("requires every custom Gate on one occurrence, even when another callback repeats", async () => {
    const releases = new Map<string, Map<string, () => Promise<void>>>();
    const directive =
      (name: string) => (load: () => Promise<void>, _directive: unknown, element: HTMLElement) => {
        const gates = releases.get(element.id) ?? new Map();
        gates.set(name, load);
        releases.set(element.id, gates);
      };
    document.body.innerHTML =
      '<and-race id="one" client:a client:b></and-race><and-race id="two" client:a client:b></and-race>';
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
    await releases.get("two")!.get("b")!();
    expect(loader).not.toHaveBeenCalled();
    await releases.get("one")!.get("b")!();
    expect(loader).toHaveBeenCalledTimes(1);
  });
  it("opens only the intersecting occurrence's complete policy with pooled visibility", async () => {
    const visibility = installVisibilityDriver(suite.cleanups);
    const media = installMediaDriver(suite.cleanups);
    media.setMatches("(min-width: 1px)", true);
    document.body.innerHTML =
      '<visible-policy id="closed" client:visible client:media="(min-width: 9999px)"></visible-policy><visible-policy id="ready" client:visible client:media="(min-width: 1px)"></visible-policy>';
    const loader = mock(async () => {});
    suite.runtime.start(suite.runtime.payload({ "/visible-policy.ts": loader }));
    visibility.trigger(document.getElementById("closed")!);
    await flush(0);
    expect(loader).not.toHaveBeenCalled();
    visibility.trigger(document.getElementById("ready")!);
    await flush(0);
    expect(loader).toHaveBeenCalledTimes(1);
  });

});
