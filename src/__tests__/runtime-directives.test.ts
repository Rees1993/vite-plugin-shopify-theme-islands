/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { ClientDirective, ClientDirectiveLoader } from "../index";
import {
  createCleanupQueue,
  createRuntimeHarness,
  flush,
  installMutationDriver,
  installTimerDriver,
  installVisibilityDriver,
} from "./harness";

let cleanups = createCleanupQueue();
let runtimeHarness = createRuntimeHarness(cleanups);

describe("runtime custom directives", () => {
  beforeEach(() => {
    cleanups = createCleanupQueue();
    runtimeHarness = createRuntimeHarness(cleanups);
    document.body.innerHTML = "";
  });

  afterEach(() => {
    cleanups.cleanup({ resetDom: true });
  });

  describe("custom directives", () => {
    it("calls the directive function with loader, options, element, and context", async () => {
      const directiveFn = mock<ClientDirective>((_load, _opts, _el, _ctx) => {});
      const customDirectives = new Map<string, ClientDirective>([["client:on-click", directiveFn]]);

      document.body.innerHTML = "<click-island client:on-click></click-island>";
      runtimeHarness.start(
        runtimeHarness.payload(
          { "/islands/click-island.ts": mock(async () => {}) },
          {},
          customDirectives,
        ),
      );

      await flush();
      expect(directiveFn).toHaveBeenCalledTimes(1);
      const [loadArg, optsArg, elArg, ctxArg] = directiveFn.mock.calls[0];
      expect(typeof loadArg).toBe("function");
      expect(optsArg).toEqual({ name: "client:on-click", value: "" });
      expect(elArg.tagName.toLowerCase()).toBe("click-island");
      expect(ctxArg).toEqual({
        onCleanup: expect.any(Function),
        signal: expect.any(AbortSignal),
      });
    });

    it("passes attribute value in options", async () => {
      const directiveFn = mock<ClientDirective>((_load, _opts, _el) => {});
      const customDirectives = new Map<string, ClientDirective>([["client:on-click", directiveFn]]);

      document.body.innerHTML = '<val-island client:on-click="submit"></val-island>';
      runtimeHarness.start(
        runtimeHarness.payload(
          { "/islands/val-island.ts": mock(async () => {}) },
          {},
          customDirectives,
        ),
      );

      await flush();
      expect(directiveFn.mock.calls[0][1].value).toBe("submit");
    });

    it("does not auto-load when a custom directive matches", async () => {
      const directiveFn = mock<ClientDirective>(() => {});
      const loader = mock(async () => {});
      const customDirectives = new Map<string, ClientDirective>([["client:on-click", directiveFn]]);

      document.body.innerHTML = "<no-auto-load client:on-click></no-auto-load>";
      runtimeHarness.start(
        runtimeHarness.payload({ "/islands/no-auto-load.ts": loader }, {}, customDirectives),
      );

      await flush();
      expect(loader).not.toHaveBeenCalled();
      expect(directiveFn).toHaveBeenCalledTimes(1);
    });

    it("runs custom directive cleanup and aborts its signal when the subtree is unobserved", async () => {
      const cleanup = mock(() => {});
      const directiveFn = mock<ClientDirective>((_load, _opts, _el, ctx) => {
        ctx.onCleanup(cleanup);
      });
      const customDirectives = new Map<string, ClientDirective>([["client:on-click", directiveFn]]);

      document.body.innerHTML =
        '<div id="alpha"><cleanup-island client:on-click></cleanup-island></div>';
      const alphaRoot = document.getElementById("alpha") as HTMLElement;
      const runtime = runtimeHarness.start(
        runtimeHarness.payload(
          { "/islands/cleanup-island.ts": mock(async () => {}) },
          {},
          customDirectives,
        ),
      );

      await flush();

      const ctxArg = directiveFn.mock.calls[0][3];
      runtime.unobserve(alphaRoot);
      await flush();

      expect(ctxArg.signal.aborted).toBe(true);
      expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it("aborts custom directive signal after successful load and runs cleanup once", async () => {
      const cleanup = mock(() => {});
      const loader = mock(async () => {});
      const directiveFn = mock<ClientDirective>(async (load, _opts, _el, ctx) => {
        ctx.onCleanup(cleanup);
        await load();
      });
      const customDirectives = new Map<string, ClientDirective>([["client:on-click", directiveFn]]);

      document.body.innerHTML = "<success-island client:on-click></success-island>";
      runtimeHarness.start(
        runtimeHarness.payload({ "/islands/success-island.ts": loader }, {}, customDirectives),
      );

      await flush();

      const ctxArg = directiveFn.mock.calls[0][3];
      expect(loader).toHaveBeenCalledTimes(1);
      expect(ctxArg.signal.aborted).toBe(true);
      expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it("ignores a custom directive rejection after load has already been released", async () => {
      const loader = mock(async () => {});
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});
      const directiveFn = mock<ClientDirective>(async (load) => {
        await load();
        throw new Error("late directive failure");
      });
      const customDirectives = new Map<string, ClientDirective>([["client:on-click", directiveFn]]);

      document.body.innerHTML = "<late-failure client:on-click></late-failure>";
      runtimeHarness.start(
        runtimeHarness.payload({ "/islands/late-failure.ts": loader }, {}, customDirectives),
      );

      await flush();

      expect(loader).toHaveBeenCalledTimes(1);
      expect(errorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("Custom directive client:on-click failed"),
        expect.any(Error),
      );
      errorSpy.mockRestore();
    });

    it("calls load immediately when no custom directive attribute matches", async () => {
      const loader = mock(async () => {});
      const customDirectives = new Map<string, ClientDirective>([
        ["client:on-click", mock<ClientDirective>(() => {})],
      ]);

      document.body.innerHTML = "<no-attr-island></no-attr-island>";
      runtimeHarness.start(
        runtimeHarness.payload({ "/islands/no-attr-island.ts": loader }, {}, customDirectives),
      );

      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("built-ins gate before custom directives", async () => {
      const visibility = installVisibilityDriver(cleanups);
      const directiveFn = mock<ClientDirective>(() => {});
      const customDirectives = new Map<string, ClientDirective>([["client:on-click", directiveFn]]);

      document.body.innerHTML = "<gated-island client:visible client:on-click></gated-island>";
      runtimeHarness.start(
        runtimeHarness.payload(
          { "/islands/gated-island.ts": mock(async () => {}) },
          {},
          customDirectives,
        ),
      );

      await flush(0);
      expect(directiveFn).not.toHaveBeenCalled();

      visibility.trigger(document.querySelector("gated-island")!, true);
      await flush(0);
      expect(directiveFn).toHaveBeenCalledTimes(1);
    });

    it("catches sync custom directive errors and allows retry on re-insertion", async () => {
      const mutations = installMutationDriver(cleanups);
      const loader = mock(async () => {});
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});
      const unhandledSpy = mock(() => {});
      process.once("unhandledRejection", unhandledSpy);

      const directiveFn = mock<ClientDirective>(() => {
        throw new Error("directive failed");
      });
      const customDirectives = new Map<string, ClientDirective>([["client:on-click", directiveFn]]);

      document.body.innerHTML = "<broken-island client:on-click></broken-island>";
      runtimeHarness.start(
        runtimeHarness.payload({ "/islands/broken-island.ts": loader }, {}, customDirectives),
      );

      await flush();
      expect(directiveFn).toHaveBeenCalledTimes(1);
      expect(loader).not.toHaveBeenCalled();
      expect(unhandledSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Custom directive client:on-click failed"),
        expect.any(Error),
      );

      const el = document.createElement("broken-island");
      el.setAttribute("client:on-click", "");
      mutations.add(el);
      await flush();

      expect(directiveFn).toHaveBeenCalledTimes(2);
      expect(loader).not.toHaveBeenCalled();
      expect(unhandledSpy).not.toHaveBeenCalled();

      process.off("unhandledRejection", unhandledSpy);
      errorSpy.mockRestore();
    });

    it("does not warn about multiple custom directives", async () => {
      const spy = spyOn(console, "warn");
      const loads: ClientDirectiveLoader[] = [];
      const makeDirective = (): ClientDirective => (load) => {
        loads.push(load);
      };
      const customDirectives = new Map<string, ClientDirective>([
        ["client:on-a", makeDirective()],
        ["client:on-b", makeDirective()],
      ]);

      document.body.innerHTML = "<no-warn-multi client:on-a client:on-b></no-warn-multi>";
      runtimeHarness.start(
        runtimeHarness.payload(
          { "/islands/no-warn-multi.ts": mock(async () => {}) },
          {},
          customDirectives,
        ),
      );

      await flush();
      expect(spy).not.toHaveBeenCalledWith(expect.stringContaining("multiple custom directives"));
      spy.mockRestore();
    });

    it("catches async custom directive rejections and allows retry on re-insertion", async () => {
      const mutations = installMutationDriver(cleanups);
      const loader = mock(async () => {});
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});
      const unhandledSpy = mock(() => {});
      process.once("unhandledRejection", unhandledSpy);

      const directiveFn = mock<ClientDirective>(async () => {
        throw new Error("async directive failed");
      });
      const customDirectives = new Map<string, ClientDirective>([["client:on-click", directiveFn]]);

      document.body.innerHTML = "<broken-async client:on-click></broken-async>";
      runtimeHarness.start(
        runtimeHarness.payload({ "/islands/broken-async.ts": loader }, {}, customDirectives),
      );

      await flush();
      expect(directiveFn).toHaveBeenCalledTimes(1);
      expect(loader).not.toHaveBeenCalled();
      expect(unhandledSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Custom directive client:on-click failed"),
        expect.any(Error),
      );

      const el = document.createElement("broken-async");
      el.setAttribute("client:on-click", "");
      mutations.add(el);
      await flush();

      expect(directiveFn).toHaveBeenCalledTimes(2);
      expect(loader).not.toHaveBeenCalled();
      expect(unhandledSpy).not.toHaveBeenCalled();

      process.off("unhandledRejection", unhandledSpy);
      errorSpy.mockRestore();
    });
  });

  describe("multiple custom directives (AND latch)", () => {
    it("loads only after both custom directives call load()", async () => {
      const loader = mock(async () => {});
      let loadA!: ClientDirectiveLoader;
      let loadB!: ClientDirectiveLoader;
      const directiveA = mock<ClientDirective>((load) => {
        loadA = load;
      });
      const directiveB = mock<ClientDirective>((load) => {
        loadB = load;
      });
      const customDirectives = new Map<string, ClientDirective>([
        ["client:on-a", directiveA],
        ["client:on-b", directiveB],
      ]);

      document.body.innerHTML = "<and-island client:on-a client:on-b></and-island>";
      runtimeHarness.start(
        runtimeHarness.payload({ "/islands/and-island.ts": loader }, {}, customDirectives),
      );

      await flush();
      expect(loader).not.toHaveBeenCalled();

      await loadA();
      await flush();
      expect(loader).not.toHaveBeenCalled();

      await loadB();
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("loads exactly once even when load() is called more than once", async () => {
      const loader = mock(async () => {});
      let loadA!: ClientDirectiveLoader;
      let loadB!: ClientDirectiveLoader;
      const customDirectives = new Map<string, ClientDirective>([
        ["client:on-a", (load) => void (loadA = load)],
        ["client:on-b", (load) => void (loadB = load)],
      ]);

      document.body.innerHTML = "<idem-island client:on-a client:on-b></idem-island>";
      runtimeHarness.start(
        runtimeHarness.payload({ "/islands/idem-island.ts": loader }, {}, customDirectives),
      );

      await flush();
      await loadA();
      await loadB();
      await loadA();
      await flush();

      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("three directives all must call load() before the island loads", async () => {
      const loader = mock(async () => {});
      const loads: ClientDirectiveLoader[] = [];
      const makeDirective = (): ClientDirective => (load) => {
        loads.push(load);
      };
      const customDirectives = new Map<string, ClientDirective>([
        ["client:on-a", makeDirective()],
        ["client:on-b", makeDirective()],
        ["client:on-c", makeDirective()],
      ]);

      document.body.innerHTML = "<three-island client:on-a client:on-b client:on-c></three-island>";
      runtimeHarness.start(
        runtimeHarness.payload({ "/islands/three-island.ts": loader }, {}, customDirectives),
      );

      await flush();
      expect(loader).not.toHaveBeenCalled();

      await loads[0]();
      await loads[1]();
      await flush();
      expect(loader).not.toHaveBeenCalled();

      await loads[2]();
      await flush();
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("a surviving directive cannot trigger load after a sibling directive fails", async () => {
      const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      const loader = mock(async () => {});
      let loadB!: ClientDirectiveLoader;
      const customDirectives = new Map<string, ClientDirective>([
        [
          "client:on-a",
          mock<ClientDirective>(() => {
            throw new Error("directive A failed");
          }),
        ],
        [
          "client:on-b",
          (load) => {
            loadB = load;
          },
        ],
      ]);

      document.body.innerHTML = "<abort-latch client:on-a client:on-b></abort-latch>";
      runtimeHarness.start(
        runtimeHarness.payload({ "/islands/abort-latch.ts": loader }, {}, customDirectives),
      );

      await flush();
      expect(loader).not.toHaveBeenCalled();

      await loadB();
      await flush();
      expect(loader).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    describe("client:interaction", () => {
      it("loads on mouseenter", async () => {
        const loader = mock(async () => {});
        document.body.innerHTML = "<hover-island client:interaction></hover-island>";
        runtimeHarness.start(runtimeHarness.payload({ "/islands/hover-island.ts": loader }));
        await flush();
        expect(loader).not.toHaveBeenCalled();
        document.querySelector("hover-island")!.dispatchEvent(new Event("mouseenter"));
        await flush();
        expect(loader).toHaveBeenCalledTimes(1);
      });

      it("loads on touchstart", async () => {
        const loader = mock(async () => {});
        document.body.innerHTML = "<touch-island client:interaction></touch-island>";
        runtimeHarness.start(runtimeHarness.payload({ "/islands/touch-island.ts": loader }));
        await flush();
        document.querySelector("touch-island")!.dispatchEvent(new Event("touchstart"));
        await flush();
        expect(loader).toHaveBeenCalledTimes(1);
      });

      it("loads on focusin", async () => {
        const loader = mock(async () => {});
        document.body.innerHTML = "<focus-island client:interaction></focus-island>";
        runtimeHarness.start(runtimeHarness.payload({ "/islands/focus-island.ts": loader }));
        await flush();
        document.querySelector("focus-island")!.dispatchEvent(new Event("focusin"));
        await flush();
        expect(loader).toHaveBeenCalledTimes(1);
      });

      it("does not load before any event fires", async () => {
        const loader = mock(async () => {});
        document.body.innerHTML = "<no-fire-island client:interaction></no-fire-island>";
        runtimeHarness.start(runtimeHarness.payload({ "/islands/no-fire-island.ts": loader }));
        await flush();
        expect(loader).not.toHaveBeenCalled();
      });

      it("per-element value only fires on configured events", async () => {
        const loader = mock(async () => {});
        document.body.innerHTML =
          '<per-event-island client:interaction="mouseenter"></per-event-island>';
        runtimeHarness.start(runtimeHarness.payload({ "/islands/per-event-island.ts": loader }));
        await flush();
        const el = document.querySelector("per-event-island")!;
        el.dispatchEvent(new Event("touchstart"));
        await flush();
        expect(loader).not.toHaveBeenCalled();
        el.dispatchEvent(new Event("mouseenter"));
        await flush();
        expect(loader).toHaveBeenCalledTimes(1);
      });

      it("per-element value overrides global events config", async () => {
        const loader = mock(async () => {});
        document.body.innerHTML =
          '<override-events client:interaction="mouseenter"></override-events>';
        runtimeHarness.start(
          runtimeHarness.payload(
            { "/islands/override-events.ts": loader },
            { directives: { interaction: { events: ["focusin"] } } },
          ),
        );

        await flush();
        const el = document.querySelector("override-events")!;
        el.dispatchEvent(new Event("focusin"));
        await flush();
        expect(loader).not.toHaveBeenCalled();
        el.dispatchEvent(new Event("mouseenter"));
        await flush();
        expect(loader).toHaveBeenCalledTimes(1);
      });

      it("warns for mixed supported and unsupported tokens and uses only supported tokens", async () => {
        const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
        const loader = mock(async () => {});
        document.body.innerHTML =
          '<mixed-interaction client:interaction="mouseenter click"></mixed-interaction>';
        runtimeHarness.start(runtimeHarness.payload({ "/islands/mixed-interaction.ts": loader }));

        await flush();
        const el = document.querySelector("mixed-interaction")!;
        el.dispatchEvent(new Event("click"));
        await flush();
        expect(loader).not.toHaveBeenCalled();

        el.dispatchEvent(new Event("mouseenter"));
        await flush();
        expect(loader).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("contains unsupported event token"),
        );
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("click"));
        warnSpy.mockRestore();
      });

      it("warns and falls back to default events when all tokens are unsupported", async () => {
        const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
        const loader = mock(async () => {});
        document.body.innerHTML =
          '<invalid-interaction client:interaction="click submit"></invalid-interaction>';
        runtimeHarness.start(runtimeHarness.payload({ "/islands/invalid-interaction.ts": loader }));

        await flush();
        const el = document.querySelector("invalid-interaction")!;
        el.dispatchEvent(new Event("click"));
        await flush();
        expect(loader).not.toHaveBeenCalled();

        el.dispatchEvent(new Event("touchstart"));
        await flush();
        expect(loader).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("contains no supported event tokens"),
        );
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("click, submit"));
        warnSpy.mockRestore();
      });

      it("all-whitespace attribute value warns and falls back to default events", async () => {
        const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
        const loader = mock(async () => {});
        document.body.innerHTML = '<ws-interaction client:interaction="   "></ws-interaction>';
        runtimeHarness.start(runtimeHarness.payload({ "/islands/ws-interaction.ts": loader }));

        await flush();
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("no valid event tokens"));
        document.querySelector("ws-interaction")!.dispatchEvent(new Event("touchstart"));
        await flush();
        expect(loader).toHaveBeenCalledTimes(1);
        warnSpy.mockRestore();
      });

      it("event listeners are removed after load", async () => {
        const loader = mock(async () => {});
        document.body.innerHTML = "<cleanup-island client:interaction></cleanup-island>";
        runtimeHarness.start(runtimeHarness.payload({ "/islands/cleanup-island.ts": loader }));

        await flush();
        const el = document.querySelector("cleanup-island")!;
        el.dispatchEvent(new Event("mouseenter"));
        await flush();
        expect(loader).toHaveBeenCalledTimes(1);

        el.dispatchEvent(new Event("mouseenter"));
        await flush();
        expect(loader).toHaveBeenCalledTimes(1);
      });

      it("removes the interaction cancellation watcher after interaction fires", async () => {
        const mutations = installMutationDriver(cleanups);
        const loader = mock(async () => {});

        document.body.innerHTML = "<cleanup-cancel client:interaction></cleanup-cancel>";
        runtimeHarness.start(runtimeHarness.payload({ "/islands/cleanup-cancel.ts": loader }));

        await flush();
        const el = document.querySelector("cleanup-cancel")!;
        const removeSpy = spyOn(el, "removeEventListener");

        el.dispatchEvent(new Event("mouseenter"));
        await flush();
        expect(loader).toHaveBeenCalledTimes(1);
        const cleanupCalls = removeSpy.mock.calls.length;

        document.body.removeChild(el);
        mutations.remove(el);
        await flush();
        expect(removeSpy).toHaveBeenCalledTimes(cleanupCalls);

        removeSpy.mockRestore();
      });

      it("does not load when element is removed before interaction fires", async () => {
        const mutations = installMutationDriver(cleanups);
        const loader = mock(async () => {});

        document.body.innerHTML = "<cancel-interact client:interaction></cancel-interact>";
        runtimeHarness.start(runtimeHarness.payload({ "/islands/cancel-interact.ts": loader }));

        await flush();
        expect(loader).not.toHaveBeenCalled();

        const el = document.querySelector("cancel-interact")!;
        document.body.removeChild(el);
        mutations.remove(el);
        await flush();

        el.dispatchEvent(new Event("mouseenter"));
        await flush();
        expect(loader).not.toHaveBeenCalled();
      });

      it("combines with client:visible", async () => {
        const visibility = installVisibilityDriver(cleanups);
        const loader = mock(async () => {});

        document.body.innerHTML = "<combo-island client:visible client:interaction></combo-island>";
        runtimeHarness.start(runtimeHarness.payload({ "/islands/combo-island.ts": loader }));

        await flush();
        const el = document.querySelector("combo-island")!;
        el.dispatchEvent(new Event("mouseenter"));
        await flush();
        expect(loader).not.toHaveBeenCalled();

        visibility.trigger(el, true);
        await flush();
        expect(loader).not.toHaveBeenCalled();

        el.dispatchEvent(new Event("mouseenter"));
        await flush();
        expect(loader).toHaveBeenCalledTimes(1);
      });

      it("supports a custom attribute name", async () => {
        const loader = mock(async () => {});
        document.body.innerHTML = "<custom-attr-island data-lazy></custom-attr-island>";
        runtimeHarness.start(
          runtimeHarness.payload(
            { "/islands/custom-attr-island.ts": loader },
            { directives: { interaction: { attribute: "data-lazy" } } },
          ),
        );

        await flush();
        expect(loader).not.toHaveBeenCalled();
        document.querySelector("custom-attr-island")!.dispatchEvent(new Event("mouseenter"));
        await flush();
        expect(loader).toHaveBeenCalledTimes(1);
      });
    });

    it("debug log names all matched directives when multiple are present", async () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const groupCollapsed = spyOn(console, "groupCollapsed").mockImplementation(() => {});
      const groupEnd = spyOn(console, "groupEnd").mockImplementation(() => {});
      const customDirectives = new Map<string, ClientDirective>([
        ["client:on-a", (load) => void load()],
        ["client:on-b", (load) => void load()],
      ]);

      document.body.innerHTML = "<multi-dbg client:on-a client:on-b></multi-dbg>";
      runtimeHarness.start(
        runtimeHarness.payload(
          { "/islands/multi-dbg.ts": mock(async () => {}) },
          { debug: true },
          customDirectives,
        ),
      );

      await flush();
      const dispatchCall = logSpy.mock.calls.find(
        (args) =>
          String(args[1]).includes("dispatching to custom directives") &&
          String(args[1]).includes("client:on-a") &&
          String(args[1]).includes("client:on-b"),
      );
      expect(dispatchCall).toBeDefined();
      logSpy.mockRestore();
      groupCollapsed.mockRestore();
      groupEnd.mockRestore();
    });
  });

  describe("directiveTimeout", () => {
    it("fires islands:error when a custom directive never calls load() past the timeout", async () => {
      const timers = installTimerDriver(cleanups);
      const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      const handler = mock((event: CustomEvent<{ tag: string }>) => event);
      cleanups.listen(document, "islands:error", handler as unknown as EventListener);

      document.body.innerHTML = "<timeout-island client:never></timeout-island>";
      const customDirectives = new Map<string, ClientDirective>([
        [
          "client:never",
          () => {
            /* intentionally never calls load */
          },
        ],
      ]);

      runtimeHarness.start(
        runtimeHarness.payload(
          { "/islands/timeout-island.ts": mock(async () => {}) },
          { directiveTimeout: 20 },
          customDirectives,
        ),
      );

      await flush(0);
      timers.advance(100);
      await flush(0);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].detail.tag).toBe("timeout-island");
      consoleSpy.mockRestore();
    });

    it("does not fire islands:error when directive calls load() before the timeout", async () => {
      const timers = installTimerDriver(cleanups);
      const handler = mock((event: CustomEvent<{ tag: string }>) => event);
      cleanups.listen(document, "islands:error", handler as unknown as EventListener);
      const loader = mock(async () => {});
      const customDirectives = new Map<string, ClientDirective>([
        [
          "client:fast",
          (load) => {
            void load();
          },
        ],
      ]);

      document.body.innerHTML = "<fast-island client:fast></fast-island>";
      runtimeHarness.start(
        runtimeHarness.payload(
          { "/islands/fast-island.ts": loader },
          { directiveTimeout: 50 },
          customDirectives,
        ),
      );

      await flush(0);
      timers.advance(100);
      await flush(0);
      expect(loader).toHaveBeenCalledTimes(1);
      expect(handler).not.toHaveBeenCalled();
    });

    it("is disabled by default when directiveTimeout is not set", async () => {
      const timers = installTimerDriver(cleanups);
      const handler = mock((event: CustomEvent<{ tag: string }>) => event);
      cleanups.listen(document, "islands:error", handler as unknown as EventListener);
      const customDirectives = new Map<string, ClientDirective>([
        [
          "client:hang",
          () => {
            /* intentionally never calls load */
          },
        ],
      ]);

      document.body.innerHTML = "<hang-island client:hang></hang-island>";
      runtimeHarness.start(
        runtimeHarness.payload(
          { "/islands/hang-island.ts": mock(async () => {}) },
          {},
          customDirectives,
        ),
      );

      await flush(0);
      timers.advance(100);
      await flush(0);
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
