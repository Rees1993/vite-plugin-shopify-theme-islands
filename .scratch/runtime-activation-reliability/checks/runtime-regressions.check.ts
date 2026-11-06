import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import {
  createRuntimeSuite,
  flush,
  installMutationDriver,
  installTimerDriver,
  installVisibilityDriver,
} from "../../../src/__tests__/utils/harness";

const suite = createRuntimeSuite();
beforeEach(() => suite.reset());
afterEach(() => suite.cleanup());

function silenceExpectedLoadError() {
  const error = spyOn(console, "error").mockImplementation(() => {});
  suite.cleanups.track(() => error.mockRestore());
}

describe("Activation reliability prerequisites", () => {
  it("control: activates a different Tag after a pending Island element is removed", async () => {
    const mutations = installMutationDriver(suite.cleanups);
    installVisibilityDriver(suite.cleanups);
    document.body.innerHTML = "<pending-control client:visible></pending-control>";
    const loader = mock(async () => {});
    suite.runtime.start(
      suite.runtime.payload({
        "/pending-control.ts": async () => {},
        "/replacement-control.ts": loader,
      }),
    );
    const removed = document.querySelector("pending-control")!;
    removed.remove();
    const added = document.createElement("replacement-control");
    document.body.append(added);
    mutations.trigger([
      { addedNodes: [added], removedNodes: [removed] } as unknown as MutationRecord,
    ]);
    await flush(0);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("activates a same-Tag replacement after pending Gate cancellation", async () => {
    const mutations = installMutationDriver(suite.cleanups);
    installVisibilityDriver(suite.cleanups);
    document.body.innerHTML = "<pending-replacement client:visible></pending-replacement>";
    const loader = mock(async () => {});
    const runtime = suite.runtime.start(
      suite.runtime.payload({ "/pending-replacement.ts": loader }),
    );
    const removed = document.querySelector("pending-replacement")!;
    removed.remove();
    const added = document.createElement("pending-replacement");
    document.body.append(added);
    mutations.trigger([
      { addedNodes: [added], removedNodes: [removed] } as unknown as MutationRecord,
    ]);
    await flush(0);
    runtime.scan(added);
    await flush(0);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("control: exhausted retries do not grant a parked occurrence another automatic attempt", async () => {
    silenceExpectedLoadError();
    document.body.innerHTML =
      "<exhausted-budget></exhausted-budget><exhausted-budget></exhausted-budget>";
    const loader = mock(async () => {
      throw new Error("controlled failure");
    });
    suite.runtime.start(
      suite.runtime.payload(
        { "/exhausted-budget.ts": loader },
        { retry: { retries: 0, delay: 1 } },
      ),
    );
    await flush(0);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("control: successful automatic retry releases both earlier parent Subtrees", async () => {
    silenceExpectedLoadError();
    const timers = installTimerDriver(suite.cleanups);
    let attempts = 0;
    const parent = mock(async () => {
      if (++attempts === 1) throw new Error("controlled failure");
    });
    const alpha = mock(async () => {});
    const beta = mock(async () => {});
    document.body.innerHTML =
      "<retry-parent><retry-alpha></retry-alpha></retry-parent><retry-parent><retry-beta></retry-beta></retry-parent>";
    suite.runtime.start(
      suite.runtime.payload(
        { "/retry-parent.ts": parent, "/retry-alpha.ts": alpha, "/retry-beta.ts": beta },
        { retry: { retries: 1, delay: 10 } },
      ),
    );
    await flush(0);
    timers.advance(10);
    await flush(0);
    expect(parent).toHaveBeenCalledTimes(2);
    expect(alpha).toHaveBeenCalledTimes(1);
    expect(beta).toHaveBeenCalledTimes(1);
  });

  it("releases earlier same-Tag children when a fresh parent succeeds after exhaustion", async () => {
    silenceExpectedLoadError();
    const mutations = installMutationDriver(suite.cleanups);
    let attempts = 0;
    const parent = mock(async () => {
      if (++attempts === 1) throw new Error("controlled failure");
    });
    const alpha = mock(async () => {});
    const beta = mock(async () => {});
    const gamma = mock(async () => {});
    document.body.innerHTML =
      "<later-parent><later-alpha></later-alpha></later-parent><later-parent><later-beta></later-beta></later-parent>";
    suite.runtime.start(
      suite.runtime.payload(
        {
          "/later-parent.ts": parent,
          "/later-alpha.ts": alpha,
          "/later-beta.ts": beta,
          "/later-gamma.ts": gamma,
        },
        { retry: { retries: 0, delay: 1 } },
      ),
    );
    await flush(0);
    expect(parent).toHaveBeenCalledTimes(1);
    const fresh = document.createElement("later-parent");
    fresh.innerHTML = "<later-gamma></later-gamma>";
    document.body.append(fresh);
    mutations.add(fresh);
    await flush(0);
    expect(parent).toHaveBeenCalledTimes(2);
    expect(gamma).toHaveBeenCalledTimes(1);
    expect(alpha).toHaveBeenCalledTimes(1);
    expect(beta).toHaveBeenCalledTimes(1);
  });

  it("keeps pending Gate work in an explicitly included child when its parent is unobserved", async () => {
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
});
