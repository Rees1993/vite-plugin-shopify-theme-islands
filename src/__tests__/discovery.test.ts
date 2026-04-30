/**
 * Boundary tests for island discovery.
 * Pure functions (inDirectory, getIslandPathsForLoad) tested without plugin or I/O.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createIslandInventory, inDirectory, getIslandPathsForLoad } from "../discovery";

const ISLAND_CONTENT =
  'import Island from "vite-plugin-shopify-theme-islands/island";\nexport default class X extends Island(HTMLElement) {}';

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

  describe("createIslandInventory", () => {
    let tmp: string;

    beforeEach(() => {
      tmp = mkdtempSync(join(tmpdir(), "islands-inventory-"));
    });

    afterEach(() => {
      rmSync(tmp, { recursive: true, force: true });
    });

    function makeInventory(directories: string[] = ["/islands/"]) {
      const inventory = createIslandInventory(directories);
      inventory.configure({ root: tmp, aliases: [] });
      return inventory;
    }

    it("scans once and keeps mixin files outside configured directories", () => {
      writeFileSync(join(tmp, "outside-widget.ts"), ISLAND_CONTENT);
      const islandsDir = join(tmp, "islands");
      mkdirSync(islandsDir);
      writeFileSync(join(islandsDir, "inside-widget.ts"), ISLAND_CONTENT);

      const inventory = makeInventory();
      const firstScan = inventory.scan();
      const secondScan = inventory.scan();

      expect(firstScan).not.toBeNull();
      expect(firstScan?.islandFiles).toEqual([join(tmp, "outside-widget.ts")]);
      expect(firstScan?.directoryTagNames).toContain("inside-widget");
      expect(secondScan).toBeNull();
    });

    it("tracks transform-based additions and removals outside scanned directories", () => {
      const inventory = makeInventory();
      inventory.scan();

      const filePath = join(tmp, "watch-widget.ts");
      const detected = inventory.applyTransform(filePath, ISLAND_CONTENT);
      const removed = inventory.applyTransform(
        filePath,
        "export default class X extends HTMLElement {}",
      );

      expect(detected).toEqual({ type: "detected", file: filePath });
      expect(removed).toEqual({ type: "removed", file: filePath });
      expect(inventory.compileState().islandFiles.size).toBe(0);
    });

    it("ignores transform additions inside configured directories", () => {
      const islandsDir = join(tmp, "islands");
      mkdirSync(islandsDir);
      const filePath = join(islandsDir, "inside-widget.ts");

      const inventory = makeInventory();
      inventory.scan();

      expect(inventory.applyTransform(filePath, ISLAND_CONTENT)).toBeNull();
      expect(inventory.compileState().islandFiles.size).toBe(0);
    });

    it("tracks watchChange create, update, and delete events", () => {
      const inventory = makeInventory(["/nonexistent/"]);
      inventory.scan();

      const filePath = join(tmp, "watch-widget.ts");
      writeFileSync(filePath, ISLAND_CONTENT);
      expect(inventory.applyWatchChange(filePath, "create")).toEqual({
        type: "detected",
        file: filePath,
      });

      writeFileSync(filePath, "export default class X extends HTMLElement {}");
      expect(inventory.applyWatchChange(filePath, "update")).toEqual({
        type: "removed",
        file: filePath,
      });

      writeFileSync(filePath, ISLAND_CONTENT);
      inventory.applyWatchChange(filePath, "create");
      expect(inventory.applyWatchChange(filePath, "delete")).toEqual({
        type: "removed",
        file: filePath,
      });
    });

    it("resolves aliases before compiling inventory directories", () => {
      const inventory = createIslandInventory(["@islands/"]);
      inventory.configure({
        root: "/project",
        aliases: [{ find: "@islands", replacement: "/project/frontend/js/islands" }],
      });

      expect(inventory.compileState().directories).toEqual(["/project/frontend/js/islands/"]);
    });

    it("compiles inventory state through one operation", () => {
      writeFileSync(join(tmp, "outside-widget.ts"), ISLAND_CONTENT);
      const inventory = makeInventory();

      expect(inventory.compileState()).toEqual({
        root: tmp,
        directories: ["/islands/"],
        directoryFiles: new Set<string>(),
        islandFiles: new Set([join(tmp, "outside-widget.ts")]),
      });
    });
  });
});
