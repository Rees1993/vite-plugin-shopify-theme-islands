/**
 * Boundary tests for island discovery.
 * Pure functions (inDirectory, getIslandPathsForLoad) tested without plugin or I/O.
 */
import { describe, it, expect } from "bun:test";
import { inDirectory, getIslandPathsForLoad } from "../discovery";

describe("discovery", () => {
  describe("inDirectory", () => {
    it("returns true when file is under one of the absolute dirs", () => {
      const absDirs = ["/project/root/frontend/js/islands", "/project/root/other"];
      expect(inDirectory("/project/root/frontend/js/islands/product-form.ts", absDirs)).toBe(true);
      expect(inDirectory("/project/root/other/foo.ts", absDirs)).toBe(true);
    });

    it("returns false when file is not under any absDir", () => {
      const absDirs = ["/project/root/frontend/js/islands"];
      expect(inDirectory("/project/root/src/components/bar.ts", absDirs)).toBe(false);
      expect(inDirectory("/other/project/root/frontend/js/islands/x.ts", absDirs)).toBe(false);
    });

    it("does not treat sibling paths with the same prefix as inside the directory", () => {
      const absDirs = ["/project/root/frontend/js/islands"];
      expect(inDirectory("/project/root/frontend/js/islands-legacy/widget.ts", absDirs)).toBe(
        false,
      );
    });
  });

  describe("getIslandPathsForLoad", () => {
    it("returns paths relative to root with leading slash and forward slashes", () => {
      const root = "/project/root";
      const islandFiles = new Set([
        "/project/root/frontend/js/islands/product-form.ts",
        "/project/root/src/widget.ts",
      ]);
      const paths = getIslandPathsForLoad(islandFiles, root);
      expect(paths).toContain("/frontend/js/islands/product-form.ts");
      expect(paths).toContain("/src/widget.ts");
      expect(paths).toHaveLength(2);
    });

    it("returns empty array when islandFiles is empty", () => {
      expect(getIslandPathsForLoad(new Set(), "/root")).toEqual([]);
    });
  });
});
