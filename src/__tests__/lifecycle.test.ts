/// <reference lib="dom" />
import { describe, expect, it, mock, afterEach } from "bun:test";
import { createIslandLifecycleCoordinator } from "../lifecycle";

const flush = (ms = 20) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("lifecycle", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("walks initial DOM, defers children behind queued parents, and rewinds them after success", async () => {
    const lifecycle = createIslandLifecycleCoordinator({ retries: 0, retryDelay: 100 });
    const tags: string[] = [];
    const islandMap = new Map<string, () => Promise<unknown>>([
      ["parent-island", mock(async () => {})],
      ["child-island", mock(async () => {})],
    ]);

    document.body.innerHTML = `
      <parent-island>
        <child-island></child-island>
      </parent-island>
    `;

    const parent = document.querySelector("parent-island") as HTMLElement;
    const child = document.querySelector("child-island") as HTMLElement;

    lifecycle.start({
      root: document.body,
      islandMap,
      onActivate(tagName) {
        tags.push(tagName);
      },
    });

    expect(tags).toEqual(["parent-island"]);
    expect(lifecycle.isQueued("parent-island")).toBe(true);
    expect(lifecycle.isQueued("child-island")).toBe(false);

    lifecycle.walk(child);
    expect(tags).toEqual(["parent-island"]);

    lifecycle.settleSuccess("parent-island");
    lifecycle.walk(parent);
    expect(tags).toEqual(["parent-island", "child-island"]);
  });

  it("activates islands added after start and stops after disconnect", async () => {
    const lifecycle = createIslandLifecycleCoordinator({ retries: 0, retryDelay: 100 });
    const tags: string[] = [];
    const islandMap = new Map<string, () => Promise<unknown>>([
      ["dynamic-island", mock(async () => {})],
    ]);
    let moCallback: MutationCallback | undefined;
    const OriginalMO = globalThis.MutationObserver;
    globalThis.MutationObserver = class {
      constructor(cb: MutationCallback) {
        moCallback = cb;
      }
      observe() {}
      disconnect() {}
    } as unknown as typeof MutationObserver;

    try {
      document.body.innerHTML = "<root-shell></root-shell>";

      const { disconnect } = lifecycle.start({
        root: document.body,
        islandMap,
        onActivate(tagName) {
          tags.push(tagName);
        },
      });

      const el = document.createElement("dynamic-island");
      document.body.appendChild(el);
      moCallback?.([{ addedNodes: [el] } as unknown as MutationRecord], {} as MutationObserver);
      await flush();
      expect(tags).toEqual(["dynamic-island"]);

      disconnect();
      const later = document.createElement("dynamic-island");
      document.body.appendChild(later);
      moCallback?.([{ addedNodes: [later] } as unknown as MutationRecord], {} as MutationObserver);
      await flush();
      expect(tags).toEqual(["dynamic-island"]);
    } finally {
      globalThis.MutationObserver = OriginalMO;
    }
  });
});
