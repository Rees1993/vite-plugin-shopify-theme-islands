/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { ClientDirective } from "../index";
import { createRuntimeSuite, flush } from "./harness";

const suite = createRuntimeSuite();
let runtimeHarness = suite.runtime;

describe("runtime diagnostics", () => {
  beforeEach(() => {
    suite.reset();
    runtimeHarness = suite.runtime;
  });

  afterEach(() => {
    suite.cleanup();
  });

  describe("debug logging", () => {
    it("does not call console.groupCollapsed when debug is false", () => {
      const groupCollapsed = spyOn(console, "groupCollapsed").mockImplementation(() => {});
      document.body.innerHTML = "<no-debug-island></no-debug-island>";
      suite.runtime.start(
        suite.runtime.payload({ "/islands/no-debug-island.ts": mock(async () => {}) }),
      );
      expect(groupCollapsed).not.toHaveBeenCalled();
      groupCollapsed.mockRestore();
    });

    it("wraps the init walk in a collapsed group when debug is true", () => {
      const groupCollapsed = spyOn(console, "groupCollapsed").mockImplementation(() => {});
      const groupEnd = spyOn(console, "groupEnd").mockImplementation(() => {});
      document.body.innerHTML = "<dbg-init></dbg-init>";
      suite.runtime.start(
        suite.runtime.payload({ "/islands/dbg-init.ts": mock(async () => {}) }, { debug: true }),
      );
      expect(groupCollapsed).toHaveBeenCalledWith("[islands] ready — 1 island(s)");
      expect(groupEnd).toHaveBeenCalled();
      groupCollapsed.mockRestore();
      groupEnd.mockRestore();
    });

    it("logs waiting with directive names for islands that have directives during init", async () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const groupCollapsed = spyOn(console, "groupCollapsed").mockImplementation(() => {});
      const groupEnd = spyOn(console, "groupEnd").mockImplementation(() => {});
      document.body.innerHTML = '<dbg-waiting client:defer="500"></dbg-waiting>';
      suite.runtime.start(
        suite.runtime.payload({ "/islands/dbg-waiting.ts": mock(async () => {}) }, { debug: true }),
      );
      const waitingCalls = logSpy.mock.calls.filter((args) =>
        String(args[1]).includes("waiting ·"),
      );
      expect(waitingCalls).toHaveLength(1);
      expect(waitingCalls[0]).toEqual(["[islands]", '<dbg-waiting> waiting · client:defer="500"']);
      logSpy.mockRestore();
      groupCollapsed.mockRestore();
      groupEnd.mockRestore();
    });

    it("does not log waiting for islands with no directives", () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const groupCollapsed = spyOn(console, "groupCollapsed").mockImplementation(() => {});
      const groupEnd = spyOn(console, "groupEnd").mockImplementation(() => {});
      document.body.innerHTML = "<dbg-instant></dbg-instant>";
      suite.runtime.start(
        suite.runtime.payload({ "/islands/dbg-instant.ts": mock(async () => {}) }, { debug: true }),
      );
      const waitingCalls = logSpy.mock.calls.filter((args) =>
        String(args[1]).includes("waiting ·"),
      );
      expect(waitingCalls).toHaveLength(0);
      logSpy.mockRestore();
      groupCollapsed.mockRestore();
      groupEnd.mockRestore();
    });

    it("does not log waiting for islands added dynamically after init", async () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const groupCollapsed = spyOn(console, "groupCollapsed").mockImplementation(() => {});
      const groupEnd = spyOn(console, "groupEnd").mockImplementation(() => {});
      suite.runtime.start(
        suite.runtime.payload({ "/islands/dbg-dynamic.ts": mock(async () => {}) }, { debug: true }),
      );
      logSpy.mockClear();
      const el = document.createElement("dbg-dynamic");
      el.setAttribute("client:defer", "500");
      document.body.appendChild(el);
      await flush();
      const waitingCalls = logSpy.mock.calls.filter((args) =>
        String(args[1]).includes("waiting ·"),
      );
      expect(waitingCalls).toHaveLength(0);
      logSpy.mockRestore();
      groupCollapsed.mockRestore();
      groupEnd.mockRestore();
    });

    it("includes the outcome in the collapsed group label when intermediate notes were buffered", async () => {
      const groupCollapsed = spyOn(console, "groupCollapsed").mockImplementation(() => {});
      const groupEnd = spyOn(console, "groupEnd").mockImplementation(() => {});
      document.body.innerHTML = '<dbg-outcome client:defer="20"></dbg-outcome>';
      suite.runtime.start(
        suite.runtime.payload({ "/islands/dbg-outcome.ts": mock(async () => {}) }, { debug: true }),
      );
      await flush();
      const triggered = groupCollapsed.mock.calls.find((args) =>
        String(args[0]).includes("<dbg-outcome> triggered"),
      );
      expect(triggered).toBeDefined();
      groupCollapsed.mockRestore();
      groupEnd.mockRestore();
    });

    it("logs a flat line when an island fires with no intermediate waits", async () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const groupCollapsed = spyOn(console, "groupCollapsed").mockImplementation(() => {});
      const groupEnd = spyOn(console, "groupEnd").mockImplementation(() => {});
      document.body.innerHTML = "<dbg-flat></dbg-flat>";
      runtimeHarness.start(
        runtimeHarness.payload({ "/islands/dbg-flat.ts": mock(async () => {}) }, { debug: true }),
      );
      await flush();
      expect(logSpy).toHaveBeenCalledWith("[islands]", "<dbg-flat> triggered");
      const triggeredGroup = groupCollapsed.mock.calls.find((args) =>
        String(args[0]).includes("<dbg-flat> triggered"),
      );
      expect(triggeredGroup).toBeUndefined();
      logSpy.mockRestore();
      groupCollapsed.mockRestore();
      groupEnd.mockRestore();
    });

    it("warns once when the same tag appears with conflicting directive gates", async () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      document.body.innerHTML =
        '<same-tag client:defer="100"></same-tag><same-tag client:idle></same-tag>';

      const runtime = runtimeHarness.start(
        runtimeHarness.payload({ "/islands/same-tag.ts": mock(async () => {}) }, { debug: true }),
      );
      await flush(20);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("same tag <same-tag>"));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("first-resolved instance"));

      runtime.disconnect();
      warnSpy.mockRestore();
    });

    it("warns when the same tag mixes custom directive gates", async () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      const customDirectives = new Map<string, ClientDirective>([
        ["client:on-click", mock(() => {}) as ClientDirective],
      ]);
      document.body.innerHTML =
        "<same-custom></same-custom><same-custom client:on-click></same-custom>";

      runtimeHarness.start(
        runtimeHarness.payload(
          { "/islands/same-custom.ts": mock(async () => {}) },
          { debug: true },
          customDirectives,
        ),
      );
      await flush(20);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("client:on-click"));
      warnSpy.mockRestore();
    });

    it("does not warn when the same tag repeats the same effective gate", async () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      document.body.innerHTML =
        '<same-stable client:defer="100"></same-stable><same-stable client:defer="100"></same-stable>';

      const runtime = runtimeHarness.start(
        runtimeHarness.payload(
          { "/islands/same-stable.ts": mock(async () => {}) },
          { debug: true },
        ),
      );
      await flush(20);

      expect(warnSpy).not.toHaveBeenCalled();

      runtime.disconnect();
      warnSpy.mockRestore();
    });

    it("forgets stale same-tag conflicts after subtree teardown", async () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      document.body.innerHTML = '<div id="alpha"></div>';
      const alphaRoot = document.getElementById("alpha") as HTMLElement;
      alphaRoot.innerHTML =
        '<same-reset client:defer="100"></same-reset><same-reset client:idle></same-reset>';

      const runtime = runtimeHarness.start(
        runtimeHarness.payload({ "/islands/same-reset.ts": mock(async () => {}) }, { debug: true }),
      );
      await flush(20);

      expect(warnSpy).toHaveBeenCalledTimes(1);

      runtime.unobserve(alphaRoot);
      alphaRoot.innerHTML =
        "<same-reset client:visible></same-reset><same-reset client:interaction></same-reset>";
      warnSpy.mockClear();

      runtime.observe(alphaRoot);
      await flush(20);

      expect(warnSpy).toHaveBeenCalledTimes(1);

      runtime.disconnect();
      warnSpy.mockRestore();
    });

    it("retains sibling same-tag diagnostics when one subtree is unobserved", async () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      document.body.innerHTML = '<div id="alpha"></div><div id="beta"></div>';
      const alphaRoot = document.getElementById("alpha") as HTMLElement;
      const betaRoot = document.getElementById("beta") as HTMLElement;
      alphaRoot.innerHTML = '<same-sibling client:defer="100"></same-sibling>';
      betaRoot.innerHTML = "<same-sibling client:idle></same-sibling>";

      const runtime = runtimeHarness.start(
        runtimeHarness.payload(
          { "/islands/same-sibling.ts": mock(async () => {}) },
          { debug: true },
        ),
      );
      await flush(20);
      expect(warnSpy).toHaveBeenCalledTimes(1);

      runtime.unobserve(alphaRoot);
      warnSpy.mockClear();
      const betaConflict = document.createElement("same-sibling");
      betaConflict.setAttribute("client:defer", "100");
      betaRoot.appendChild(betaConflict);
      runtime.scan(betaRoot);
      await flush(20);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("same tag <same-sibling>"));

      runtime.disconnect();
      warnSpy.mockRestore();
    });
  });
});
