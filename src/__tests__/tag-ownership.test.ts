import { describe, it, expect } from "bun:test";
import {
  analyzeTagOwnership,
  recomputeFileTagOwnership,
  readStaticDefinedTags,
} from "../tag-ownership";

// ---------------------------------------------------------------------------
// readStaticDefinedTags
// ---------------------------------------------------------------------------

describe("readStaticDefinedTags", () => {
  it("reads a single static define", () => {
    expect(readStaticDefinedTags('customElements.define("cart-drawer", CartDrawer)')).toEqual([
      "cart-drawer",
    ]);
  });

  it("reads multiple defines", () => {
    expect(
      readStaticDefinedTags(
        'customElements.define("cart-drawer", A)\ncustomElements.define("mini-cart", B)',
      ),
    ).toEqual(["cart-drawer", "mini-cart"]);
  });

  it("ignores line-commented defines", () => {
    expect(
      readStaticDefinedTags(
        '// customElements.define("old-tag", X)\ncustomElements.define("cart-drawer", A)',
      ),
    ).toEqual(["cart-drawer"]);
  });

  it("ignores block-commented defines", () => {
    expect(
      readStaticDefinedTags(
        '/* customElements.define("old-tag", X) */\ncustomElements.define("cart-drawer", A)',
      ),
    ).toEqual(["cart-drawer"]);
  });

  it("ignores defines inside string literals", () => {
    expect(
      readStaticDefinedTags(
        '"customElements.define(\\"old-tag\\", X)"\ncustomElements.define("cart-drawer", A)',
      ),
    ).toEqual(["cart-drawer"]);
  });

  it("ignores defines that are not direct customElements.define calls (prefixed identifier)", () => {
    expect(
      readStaticDefinedTags(
        'xyzCustomElements.define("cart-drawer", A)\ncustomElements.define("real-tag", B)',
      ),
    ).toEqual(["real-tag"]);
  });

  it("returns empty array when no defines found", () => {
    expect(readStaticDefinedTags("class CartDrawer extends HTMLElement {}")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// analyzeTagOwnership — registeredTag mode
// ---------------------------------------------------------------------------

describe("analyzeTagOwnership — registeredTag mode", () => {
  const getFileContent = (path: string) =>
    path.endsWith("CartDrawer.ts")
      ? 'customElements.define("cart-drawer", CartDrawer)'
      : path.endsWith("MiniCart.ts")
        ? 'customElements.define("mini-cart", MiniCart)'
        : null;

  it("derives tag from registered tag", () => {
    const records = analyzeTagOwnership({
      files: [
        { absoluteFilePath: "/project/islands/CartDrawer.ts", filePath: "/islands/CartDrawer.ts" },
      ],
      tagSource: "registeredTag",
      getFileContent,
    });
    expect(records).toEqual([
      {
        absoluteFilePath: "/project/islands/CartDrawer.ts",
        filePath: "/islands/CartDrawer.ts",
        defaultTag: "cart-drawer",
        resolvedTag: "cart-drawer",
      },
    ]);
  });

  it("accepts CamelCase filenames when registered tag is valid", () => {
    const records = analyzeTagOwnership({
      files: [
        { absoluteFilePath: "/project/islands/CartDrawer.ts", filePath: "/islands/CartDrawer.ts" },
      ],
      tagSource: "registeredTag",
      getFileContent,
    });
    expect(records[0]?.resolvedTag).toBe("cart-drawer");
  });

  it("applies resolveTag() override using registered tag as defaultTag", () => {
    const records = analyzeTagOwnership({
      files: [
        { absoluteFilePath: "/project/islands/CartDrawer.ts", filePath: "/islands/CartDrawer.ts" },
      ],
      tagSource: "registeredTag",
      resolveTag: ({ defaultTag }) => `${defaultTag}-v2`,
      getFileContent,
    });
    expect(records[0]?.resolvedTag).toBe("cart-drawer-v2");
  });

  it("respects resolveTag() returning false", () => {
    const records = analyzeTagOwnership({
      files: [
        { absoluteFilePath: "/project/islands/CartDrawer.ts", filePath: "/islands/CartDrawer.ts" },
      ],
      tagSource: "registeredTag",
      resolveTag: () => false,
      getFileContent,
    });
    expect(records[0]?.resolvedTag).toBe(false);
  });

  it("throws when no static registered tag found", () => {
    expect(() =>
      analyzeTagOwnership({
        files: [
          { absoluteFilePath: "/project/islands/NoDefine.ts", filePath: "/islands/NoDefine.ts" },
        ],
        tagSource: "registeredTag",
        getFileContent: () => "class NoDefine extends HTMLElement {}",
      }),
    ).toThrow("no static customElements.define");
  });

  it("throws when multiple static registered tags found", () => {
    expect(() =>
      analyzeTagOwnership({
        files: [{ absoluteFilePath: "/project/islands/Multi.ts", filePath: "/islands/Multi.ts" }],
        tagSource: "registeredTag",
        getFileContent: () =>
          'customElements.define("tag-a", A)\ncustomElements.define("tag-b", B)',
      }),
    ).toThrow("found 2 static customElements.define");
  });

  it("throws when file content is unreadable", () => {
    expect(() =>
      analyzeTagOwnership({
        files: [
          { absoluteFilePath: "/project/islands/Missing.ts", filePath: "/islands/Missing.ts" },
        ],
        tagSource: "registeredTag",
        getFileContent: () => null,
      }),
    ).toThrow("no static customElements.define");
  });

  it("throws on duplicate final tag ownership across files", () => {
    expect(() =>
      analyzeTagOwnership({
        files: [
          {
            absoluteFilePath: "/project/islands/CartDrawer.ts",
            filePath: "/islands/CartDrawer.ts",
          },
          { absoluteFilePath: "/project/islands/MiniCart.ts", filePath: "/islands/MiniCart.ts" },
        ],
        tagSource: "registeredTag",
        resolveTag: () => "cart-drawer",
        getFileContent,
      }),
    ).toThrow("Multiple island entrypoints resolve to <cart-drawer>");
  });
});

// ---------------------------------------------------------------------------
// analyzeTagOwnership — filename mode
// ---------------------------------------------------------------------------

describe("analyzeTagOwnership — filename mode", () => {
  it("derives tag from filename", () => {
    const records = analyzeTagOwnership({
      files: [
        {
          absoluteFilePath: "/project/islands/product-form.ts",
          filePath: "/islands/product-form.ts",
        },
      ],
      tagSource: "filename",
      getFileContent: () => null,
    });
    expect(records[0]?.defaultTag).toBe("product-form");
    expect(records[0]?.resolvedTag).toBe("product-form");
  });

  it("throws on duplicate resolved tag in filename mode", () => {
    expect(() =>
      analyzeTagOwnership({
        files: [
          { absoluteFilePath: "/p/cart.ts", filePath: "/islands/cart.ts" },
          { absoluteFilePath: "/p/Cart.ts", filePath: "/islands/Cart.ts" },
        ],
        tagSource: "filename",
        resolveTag: () => "cart",
        getFileContent: () => null,
      }),
    ).toThrow("Multiple island entrypoints resolve to <cart>");
  });
});

// ---------------------------------------------------------------------------
// recomputeFileTagOwnership
// ---------------------------------------------------------------------------

describe("recomputeFileTagOwnership", () => {
  const getFileContent = (path: string) =>
    path.endsWith("CartDrawer.ts") ? 'customElements.define("cart-drawer", CartDrawer)' : null;

  it("returns registered tag in registeredTag mode", () => {
    const result = recomputeFileTagOwnership(
      "/project/islands/CartDrawer.ts",
      "/islands/CartDrawer.ts",
      { tagSource: "registeredTag", getFileContent },
    );
    expect(result).toBe("cart-drawer");
  });

  it("applies resolveTag() in registeredTag mode", () => {
    const result = recomputeFileTagOwnership(
      "/project/islands/CartDrawer.ts",
      "/islands/CartDrawer.ts",
      {
        tagSource: "registeredTag",
        resolveTag: ({ defaultTag }) => `${defaultTag}-v2`,
        getFileContent,
      },
    );
    expect(result).toBe("cart-drawer-v2");
  });

  it("returns null when no static tag found", () => {
    const result = recomputeFileTagOwnership(
      "/project/islands/CartDrawer.ts",
      "/islands/CartDrawer.ts",
      {
        tagSource: "registeredTag",
        getFileContent: () => "class CartDrawer extends HTMLElement {}",
      },
    );
    expect(result).toBeNull();
  });

  it("returns null when multiple static tags found", () => {
    const result = recomputeFileTagOwnership(
      "/project/islands/CartDrawer.ts",
      "/islands/CartDrawer.ts",
      {
        tagSource: "registeredTag",
        getFileContent: () =>
          'customElements.define("tag-a", A)\ncustomElements.define("tag-b", B)',
      },
    );
    expect(result).toBeNull();
  });

  it("returns null in filename mode", () => {
    const result = recomputeFileTagOwnership(
      "/project/islands/product-form.ts",
      "/islands/product-form.ts",
      { tagSource: "filename", getFileContent },
    );
    expect(result).toBeNull();
  });

  it("returns null when file is unreadable", () => {
    const result = recomputeFileTagOwnership(
      "/project/islands/CartDrawer.ts",
      "/islands/CartDrawer.ts",
      { tagSource: "registeredTag", getFileContent: () => null },
    );
    expect(result).toBeNull();
  });
});
