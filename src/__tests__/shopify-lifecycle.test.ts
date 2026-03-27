import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { connectShopifyLifecycle, resolveLifecycleRoot } from "../shopify-lifecycle";
import { createCleanupQueue } from "./harness";

describe("connectShopifyLifecycle", () => {
  const cleanups = createCleanupQueue();

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    cleanups.cleanup({ resetDom: true });
  });

  it("resolves section roots by id and closest fallback", () => {
    const section = document.createElement("section");
    section.id = "shopify-section-main";
    const child = document.createElement("button");
    section.appendChild(child);
    document.body.appendChild(section);

    expect(
      resolveLifecycleRoot(
        new CustomEvent("shopify:section:load", {
          bubbles: true,
          detail: { sectionId: "main" },
        }),
      ),
    ).toBe(section);
    expect(
      resolveLifecycleRoot(
        new CustomEvent("shopify:section:load", {
          bubbles: true,
          detail: {},
        }),
      ),
    ).toBeNull();

    const fallback = new CustomEvent("shopify:section:load", {
      bubbles: true,
      detail: {},
    });
    Object.defineProperty(fallback, "target", { value: child });
    expect(resolveLifecycleRoot(fallback)).toBe(section);
  });

  it("resolves block roots by id and closest fallback", () => {
    const block = document.createElement("div");
    block.id = "shopify-block-main";
    const child = document.createElement("button");
    block.appendChild(child);
    document.body.appendChild(block);

    expect(
      resolveLifecycleRoot(
        new CustomEvent("shopify:block:select", {
          bubbles: true,
          detail: { blockId: "main" },
        }),
      ),
    ).toBe(block);

    const fallback = new CustomEvent("shopify:block:select", {
      bubbles: true,
      detail: {},
    });
    Object.defineProperty(fallback, "target", { value: child });
    expect(resolveLifecycleRoot(fallback)).toBe(block);
  });

  it("observes and unobserves section roots for Shopify section load and unload events", () => {
    const runtime = {
      scan: mock(() => {}),
      observe: mock(() => {}),
      unobserve: mock(() => {}),
    };
    cleanups.track(
      connectShopifyLifecycle(runtime, {
        resolveRoot: () => document.getElementById("shopify-section-main"),
      }),
    );
    const section = document.createElement("section");
    section.id = "shopify-section-main";
    document.body.appendChild(section);

    section.dispatchEvent(
      new CustomEvent("shopify:section:load", {
        bubbles: true,
        detail: { sectionId: "main" },
      }),
    );
    section.dispatchEvent(
      new CustomEvent("shopify:section:unload", {
        bubbles: true,
        detail: { sectionId: "main" },
      }),
    );

    expect(runtime.observe).toHaveBeenCalledWith(section);
    expect(runtime.unobserve).toHaveBeenCalledWith(section);
  });

  it("normalizes bubbled section events to the owning section root", () => {
    const runtime = {
      scan: mock(() => {}),
      observe: mock(() => {}),
      unobserve: mock(() => {}),
    };
    cleanups.track(
      connectShopifyLifecycle(runtime, {
        resolveRoot: () => document.getElementById("shopify-section-main"),
      }),
    );
    const section = document.createElement("section");
    section.id = "shopify-section-main";
    document.body.appendChild(section);

    document.dispatchEvent(new Event("shopify:section:load", { bubbles: true }));

    expect(runtime.observe).toHaveBeenCalledTimes(1);
    expect(runtime.observe).toHaveBeenCalledWith(section);
  });

  it("scans section roots for Shopify section select and reorder events", () => {
    const runtime = {
      scan: mock(() => {}),
      observe: mock(() => {}),
      unobserve: mock(() => {}),
    };
    cleanups.track(
      connectShopifyLifecycle(runtime, {
        resolveRoot: () => document.getElementById("shopify-section-main"),
      }),
    );
    const section = document.createElement("section");
    section.id = "shopify-section-main";
    document.body.appendChild(section);

    for (const type of [
      "shopify:section:reorder",
      "shopify:section:select",
      "shopify:section:deselect",
    ]) {
      document.dispatchEvent(new Event(type));
    }

    expect(runtime.scan).toHaveBeenCalledTimes(3);
    expect(runtime.scan).toHaveBeenCalledWith(section);
  });

  it("scans block roots for Shopify block selection events", () => {
    const runtime = {
      scan: mock(() => {}),
      observe: mock(() => {}),
      unobserve: mock(() => {}),
    };
    cleanups.track(
      connectShopifyLifecycle(runtime, {
        resolveRoot: () => document.getElementById("shopify-block-main"),
      }),
    );
    const block = document.createElement("div");
    block.id = "shopify-block-main";
    document.body.appendChild(block);

    for (const type of ["shopify:block:select", "shopify:block:deselect"]) {
      document.dispatchEvent(new Event(type));
    }

    expect(runtime.scan).toHaveBeenCalledTimes(2);
    expect(runtime.scan).toHaveBeenCalledWith(block);
  });

  it("normalizes bubbled block events to the owning block root", () => {
    const runtime = {
      scan: mock(() => {}),
      observe: mock(() => {}),
      unobserve: mock(() => {}),
    };
    cleanups.track(
      connectShopifyLifecycle(runtime, {
        resolveRoot: () => document.getElementById("shopify-block-main"),
      }),
    );
    const block = document.createElement("div");
    block.id = "shopify-block-main";
    document.body.appendChild(block);

    document.dispatchEvent(new Event("shopify:block:select"));

    expect(runtime.scan).toHaveBeenCalledTimes(1);
    expect(runtime.scan).toHaveBeenCalledWith(block);
  });

  it("ignores Shopify block events that do not identify a block root", () => {
    const runtime = {
      scan: mock(() => {}),
      observe: mock(() => {}),
      unobserve: mock(() => {}),
    };
    cleanups.track(connectShopifyLifecycle(runtime, { resolveRoot: () => null }));
    const section = document.createElement("section");
    section.id = "shopify-section-main";
    document.body.appendChild(section);

    document.dispatchEvent(new Event("shopify:block:select"));

    expect(runtime.scan).not.toHaveBeenCalled();
  });

  it("does not fall back to the built-in resolver when an injected resolver returns null", () => {
    const runtime = {
      scan: mock(() => {}),
      observe: mock(() => {}),
      unobserve: mock(() => {}),
    };
    cleanups.track(connectShopifyLifecycle(runtime, { resolveRoot: () => null }));

    const section = document.createElement("section");
    section.id = "shopify-section-main";
    document.body.appendChild(section);

    document.dispatchEvent(
      new CustomEvent("shopify:section:load", {
        detail: { sectionId: "main" },
      }),
    );

    expect(runtime.observe).not.toHaveBeenCalled();
  });

  it("removes Shopify event listeners on disconnect", () => {
    const runtime = {
      scan: mock(() => {}),
      observe: mock(() => {}),
      unobserve: mock(() => {}),
    };
    const disconnect = cleanups.track(
      connectShopifyLifecycle(runtime, {
        resolveRoot: () => document.getElementById("shopify-section-main"),
      }),
    );
    const section = document.createElement("section");
    section.id = "shopify-section-main";
    document.body.appendChild(section);

    disconnect();
    document.dispatchEvent(new Event("shopify:section:load"));

    expect(runtime.observe).not.toHaveBeenCalled();
  });
});
