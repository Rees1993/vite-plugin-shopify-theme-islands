import { describe, expect, it, mock } from "bun:test";
import { connectShopifyLifecycle } from "../shopify-lifecycle";

describe("connectShopifyLifecycle", () => {
  it("observes and unobserves section roots for Shopify section load and unload events", () => {
    const runtime = {
      scan: mock(() => {}),
      observe: mock(() => {}),
      unobserve: mock(() => {}),
    };
    const disconnect = connectShopifyLifecycle(runtime);
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

    disconnect();
  });

  it("scans section roots for Shopify select and reorder events", () => {
    const runtime = {
      scan: mock(() => {}),
      observe: mock(() => {}),
      unobserve: mock(() => {}),
    };
    const disconnect = connectShopifyLifecycle(runtime);
    const section = document.createElement("section");
    section.id = "shopify-section-main";
    document.body.appendChild(section);

    for (const type of [
      "shopify:section:reorder",
      "shopify:section:select",
      "shopify:section:deselect",
      "shopify:block:select",
      "shopify:block:deselect",
    ]) {
      document.dispatchEvent(new CustomEvent(type, { detail: { sectionId: "main" } }));
    }

    expect(runtime.scan).toHaveBeenCalledTimes(5);
    expect(runtime.scan).toHaveBeenCalledWith(section);

    disconnect();
  });

  it("removes Shopify event listeners on disconnect", () => {
    const runtime = {
      scan: mock(() => {}),
      observe: mock(() => {}),
      unobserve: mock(() => {}),
    };
    const disconnect = connectShopifyLifecycle(runtime);
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
