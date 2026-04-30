/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import {
  createRuntimeSuite,
  flush,
  installMutationDriver,
  installTimerDriver,
  installVisibilityDriver,
} from "./utils/harness";

const suite = createRuntimeSuite();
let cleanups = suite.cleanups;
let runtimeHarness = suite.runtime;

describe("runtime lifecycle", () => {
  beforeEach(() => {
    suite.reset();
    cleanups = suite.cleanups;
    runtimeHarness = suite.runtime;
  });

  afterEach(() => {
    suite.cleanup();
  });

  describe("MutationObserver", () => {
    it("activates islands added to the DOM after init", async () => {
      const loader = mock(async () => {});
      suite.runtime.start(suite.runtime.payload({ "/islands/late-arrival.ts": loader }));

      const el = document.createElement("late-arrival");
      document.body.appendChild(el);
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("cancels a pending-visible island and activates a newly added island in the same tick", async () => {
      const mutations = installMutationDriver(suite.cleanups);
      installVisibilityDriver(suite.cleanups);

      const pendingLoader = mock(async () => {});
      const newLoader = mock(async () => {});

      const pendingEl = document.createElement("pending-conc");
      pendingEl.setAttribute("client:visible", "");
      document.body.appendChild(pendingEl);
      const newEl = document.createElement("new-conc");

      suite.runtime.start(
        suite.runtime.payload({
          "/islands/pending-conc.ts": pendingLoader,
          "/islands/new-conc.ts": newLoader,
        }),
      );

      document.body.removeChild(pendingEl);
      document.body.appendChild(newEl);
      mutations.trigger([
        { addedNodes: [], removedNodes: [pendingEl] } as unknown as MutationRecord,
        { addedNodes: [newEl], removedNodes: [] } as unknown as MutationRecord,
      ]);

      await flush(0);

      expect(pendingLoader).not.toHaveBeenCalled();
      expect(newLoader).toHaveBeenCalledTimes(1);
    });
  });

  describe("child island cascade", () => {
    it("child island loads via cascade when parent resolves immediately", async () => {
      const parentLoader = mock(async () => {});
      const childLoader = mock(async () => {});

      document.body.innerHTML = `
        <parent-widget>
          <child-widget></child-widget>
        </parent-widget>
      `;

      suite.runtime.start(
        suite.runtime.payload({
          "/islands/parent-widget.ts": parentLoader,
          "/islands/child-widget.ts": childLoader,
        }),
      );

      await flush();
      expect(parentLoader).toHaveBeenCalledTimes(1);
      expect(childLoader).toHaveBeenCalledTimes(1);
    });

    it("child island loads after parent loader resolves", async () => {
      let resolveParent!: () => void;
      const parentLoader = mock(
        () =>
          new Promise<void>((resolve) => {
            resolveParent = resolve;
          }),
      );
      const childLoader = mock(async () => {});

      document.body.innerHTML = `
        <parent-cascade>
          <child-cascade></child-cascade>
        </parent-cascade>
      `;

      suite.runtime.start(
        suite.runtime.payload({
          "/islands/parent-cascade.ts": parentLoader,
          "/islands/child-cascade.ts": childLoader,
        }),
      );

      await flush();
      expect(parentLoader).toHaveBeenCalledTimes(1);
      expect(childLoader).not.toHaveBeenCalled();

      resolveParent();
      await flush();
      expect(childLoader).toHaveBeenCalledTimes(1);
    });

    it("grandchild loads only after mid-child cascade resolves", async () => {
      let resolveGrandParent!: () => void;
      const grandParentLoader = mock(
        () =>
          new Promise<void>((resolve) => {
            resolveGrandParent = resolve;
          }),
      );
      const midChildLoader = mock(async () => {});
      const deepChildLoader = mock(async () => {});

      document.body.innerHTML = `
        <grand-parent>
          <mid-child>
            <deep-child></deep-child>
          </mid-child>
        </grand-parent>
      `;

      runtimeHarness.start(
        runtimeHarness.payload({
          "/islands/grand-parent.ts": grandParentLoader,
          "/islands/mid-child.ts": midChildLoader,
          "/islands/deep-child.ts": deepChildLoader,
        }),
      );

      await flush();
      expect(grandParentLoader).toHaveBeenCalledTimes(1);
      expect(midChildLoader).not.toHaveBeenCalled();
      expect(deepChildLoader).not.toHaveBeenCalled();

      resolveGrandParent();
      await flush();
      expect(midChildLoader).toHaveBeenCalledTimes(1);
      expect(deepChildLoader).toHaveBeenCalledTimes(1);
    });
  });

  describe("revive teardown", () => {
    it("returned disconnect() stops the MutationObserver", async () => {
      const mutations = installMutationDriver(cleanups);
      const loader = mock(async () => {});
      const runtime = runtimeHarness.start(
        runtimeHarness.payload({ "/islands/post-disconnect.ts": loader }),
      );

      runtime.disconnect();

      const el = document.createElement("post-disconnect");
      document.body.appendChild(el);
      mutations.add(el);
      await flush(0);
      expect(loader).not.toHaveBeenCalled();
    });

    it("disconnect() cancels pending retries", async () => {
      const timers = installTimerDriver(cleanups);
      const spy = spyOn(console, "error").mockImplementation(() => {});
      let callCount = 0;
      const loader = mock(async () => {
        callCount++;
        throw new Error("fail");
      });

      document.body.innerHTML = "<dc-retry></dc-retry>";
      const runtime = runtimeHarness.start(
        runtimeHarness.payload(
          { "/islands/dc-retry.ts": loader },
          { retry: { retries: 3, delay: 100 } },
        ),
      );

      await flush(0);
      expect(callCount).toBe(1);

      runtime.disconnect();
      timers.advance(400);
      await flush(0);

      expect(callCount).toBe(1);
      spy.mockRestore();
    });

    it("disconnect() cancels pending built-in directive work for the document root", async () => {
      const visibility = installVisibilityDriver(cleanups);
      const loader = mock(async () => {});

      document.body.innerHTML = "<dc-visible client:visible></dc-visible>";
      const runtime = runtimeHarness.start(
        runtimeHarness.payload({ "/islands/dc-visible.ts": loader }),
      );
      await flush(0);

      runtime.disconnect();
      expect(visibility.disconnect).toHaveBeenCalledTimes(1);
      visibility.trigger(document.querySelector("dc-visible")!, true);
      await flush(0);

      expect(loader).not.toHaveBeenCalled();
      expect(visibility.disconnect).toHaveBeenCalledTimes(1);
    });

    it("disconnect() before DOMContentLoaded prevents init from ever running", async () => {
      Object.defineProperty(document, "readyState", {
        configurable: true,
        value: "loading",
      });

      try {
        const loader = mock(async () => {});
        document.body.innerHTML = "<pre-init-disconnect></pre-init-disconnect>";
        const runtime = runtimeHarness.start(
          runtimeHarness.payload({ "/islands/pre-init-disconnect.ts": loader }),
        );

        runtime.disconnect();
        document.dispatchEvent(new Event("DOMContentLoaded"));
        await flush();

        expect(loader).not.toHaveBeenCalled();
      } finally {
        delete (document as { readyState?: string }).readyState;
      }
    });
  });

  describe("runtime subtree controls", () => {
    it("unobserve(root) stops future activation in that subtree without affecting sibling subtrees", async () => {
      const alphaLoader = mock(async () => {});
      const betaLoader = mock(async () => {});
      document.body.innerHTML = '<div id="alpha"></div><div id="beta"></div>';
      const alphaRoot = document.getElementById("alpha") as HTMLElement;
      const betaRoot = document.getElementById("beta") as HTMLElement;

      const runtime = runtimeHarness.start(
        runtimeHarness.payload({
          "/islands/alpha-widget.ts": alphaLoader,
          "/islands/beta-widget.ts": betaLoader,
        }),
      );
      await flush();

      runtime.unobserve(alphaRoot);
      alphaRoot.appendChild(document.createElement("alpha-widget"));
      betaRoot.appendChild(document.createElement("beta-widget"));
      runtime.scan(document.body);

      await flush();

      expect(alphaLoader).not.toHaveBeenCalled();
      expect(betaLoader).toHaveBeenCalledTimes(1);
    });

    it("unobserve(root) prevents pending built-in directive work from loading later", async () => {
      const timers = installTimerDriver(cleanups);
      const loader = mock(async () => {});

      document.body.innerHTML =
        '<div id="alpha"><slow-widget client:defer="100"></slow-widget></div>';
      const alphaRoot = document.getElementById("alpha") as HTMLElement;

      const runtime = runtimeHarness.start(
        runtimeHarness.payload({ "/islands/slow-widget.ts": loader }),
      );
      await flush(0);

      runtime.unobserve(alphaRoot);
      timers.advance(140);
      await flush(0);

      expect(loader).not.toHaveBeenCalled();
    });

    it("unobserve(root) cancels a pending visible directive inside that subtree", async () => {
      const visibility = installVisibilityDriver(cleanups);
      const loader = mock(async () => {});

      document.body.innerHTML =
        '<div id="alpha"><visible-widget client:visible></visible-widget></div>';
      const alphaRoot = document.getElementById("alpha") as HTMLElement;
      const runtime = runtimeHarness.start(
        runtimeHarness.payload({ "/islands/visible-widget.ts": loader }),
      );

      runtime.unobserve(alphaRoot);
      visibility.trigger(document.querySelector("visible-widget")!, true);
      await flush(0);

      expect(loader).not.toHaveBeenCalled();
    });

    it("observe(root) re-enables activation for a previously unobserved subtree", async () => {
      const loader = mock(async () => {});
      document.body.innerHTML = '<div id="alpha"></div>';
      const alphaRoot = document.getElementById("alpha") as HTMLElement;
      const runtime = runtimeHarness.start(
        runtimeHarness.payload({ "/islands/alpha-widget.ts": loader }),
      );

      runtime.unobserve(alphaRoot);
      alphaRoot.appendChild(document.createElement("alpha-widget"));
      runtime.scan(document.body);
      await flush();

      expect(loader).not.toHaveBeenCalled();

      runtime.observe(alphaRoot);
      await flush();

      expect(loader).toHaveBeenCalledTimes(1);
    });
  });

  describe("Shopify theme lifecycle", () => {
    it("re-observes a previously unloaded section root on shopify:section:load", async () => {
      const loader = mock(async () => {});
      document.body.innerHTML = '<section id="shopify-section-main"></section>';
      const section = document.getElementById("shopify-section-main") as HTMLElement;

      runtimeHarness.start(runtimeHarness.payload({ "/islands/shopify-widget.ts": loader }));
      await flush();

      section.dispatchEvent(
        new CustomEvent("shopify:section:unload", {
          bubbles: true,
          detail: { sectionId: "main" },
        }),
      );

      section.appendChild(document.createElement("shopify-widget"));
      section.dispatchEvent(
        new CustomEvent("shopify:section:load", {
          bubbles: true,
          detail: { sectionId: "main" },
        }),
      );

      await flush();

      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("cancels pending directive work on shopify:section:unload", async () => {
      const timers = installTimerDriver(cleanups);
      const loader = mock(async () => {});

      document.body.innerHTML =
        '<section id="shopify-section-main"><shopify-slow client:defer="100"></shopify-slow></section>';
      const section = document.getElementById("shopify-section-main") as HTMLElement;

      runtimeHarness.start(runtimeHarness.payload({ "/islands/shopify-slow.ts": loader }));
      await flush(0);

      section.dispatchEvent(
        new CustomEvent("shopify:section:unload", {
          bubbles: true,
          detail: { sectionId: "main" },
        }),
      );
      timers.advance(140);
      await flush(0);

      expect(loader).not.toHaveBeenCalled();
    });
  });
});
