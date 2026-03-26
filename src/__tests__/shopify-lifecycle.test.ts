import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { connectShopifyLifecycle } from "../shopify-lifecycle";
import { createCleanupQueue } from "./harness";

describe("connectShopifyLifecycle", () => {
  const cleanups = createCleanupQueue();

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    cleanups.cleanup({ resetDom: true });
  });

  it("observes and unobserves section roots for Shopify section load and unload events", () => {
    const runtime = {
      scan: mock(() => {}),
      observe: mock(() => {}),
      unobserve: mock(() => {}),
    };
    cleanups.track(connectShopifyLifecycle(runtime));
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
    cleanups.track(connectShopifyLifecycle(runtime));
    const section = document.createElement("section");
    section.id = "shopify-section-main";
    const child = document.createElement("button");
    section.appendChild(child);
    document.body.appendChild(section);

    child.dispatchEvent(
      new CustomEvent("shopify:section:load", {
        bubbles: true,
        detail: { sectionId: "main" },
      }),
    );

    expect(runtime.observe).toHaveBeenCalledTimes(1);
    expect(runtime.observe).toHaveBeenCalledWith(section);
  });

  it("scans section roots for Shopify section select and reorder events", () => {
    const runtime = {
      scan: mock(() => {}),
      observe: mock(() => {}),
      unobserve: mock(() => {}),
    };
    cleanups.track(connectShopifyLifecycle(runtime));
    const section = document.createElement("section");
    section.id = "shopify-section-main";
    document.body.appendChild(section);

    for (const type of [
      "shopify:section:reorder",
      "shopify:section:select",
      "shopify:section:deselect",
    ]) {
      document.dispatchEvent(new CustomEvent(type, { detail: { sectionId: "main" } }));
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
    cleanups.track(connectShopifyLifecycle(runtime));
    const block = document.createElement("div");
    block.id = "shopify-block-main";
    document.body.appendChild(block);

    for (const type of ["shopify:block:select", "shopify:block:deselect"]) {
      block.dispatchEvent(new CustomEvent(type, { bubbles: true, detail: { blockId: "main" } }));
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
    cleanups.track(connectShopifyLifecycle(runtime));
    const block = document.createElement("div");
    block.id = "shopify-block-main";
    const child = document.createElement("button");
    block.appendChild(child);
    document.body.appendChild(block);

    child.dispatchEvent(
      new CustomEvent("shopify:block:select", {
        bubbles: true,
        detail: { blockId: "main" },
      }),
    );

    expect(runtime.scan).toHaveBeenCalledTimes(1);
    expect(runtime.scan).toHaveBeenCalledWith(block);
  });

  it("ignores Shopify block events that do not identify a block root", () => {
    const runtime = {
      scan: mock(() => {}),
      observe: mock(() => {}),
      unobserve: mock(() => {}),
    };
    cleanups.track(connectShopifyLifecycle(runtime));
    const section = document.createElement("section");
    section.id = "shopify-section-main";
    document.body.appendChild(section);

    document.dispatchEvent(
      new CustomEvent("shopify:block:select", { detail: { sectionId: "main" } }),
    );

    expect(runtime.scan).not.toHaveBeenCalled();
  });

  it("removes Shopify event listeners on disconnect", () => {
    const runtime = {
      scan: mock(() => {}),
      observe: mock(() => {}),
      unobserve: mock(() => {}),
    };
    const disconnect = cleanups.track(connectShopifyLifecycle(runtime));
    const section = document.createElement("section");
    section.id = "shopify-section-main";
    document.body.appendChild(section);

    disconnect();
    section.dispatchEvent(
      new CustomEvent("shopify:section:load", {
        bubbles: true,
        detail: { sectionId: "main" },
      }),
    );

    expect(runtime.observe).not.toHaveBeenCalled();
  });
});
