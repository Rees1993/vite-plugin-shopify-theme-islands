import { afterEach, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repo = resolve(import.meta.dir, "../../..");
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "package-contract-"));
  roots.push(root);
  const files: Record<string, string> = {
    "package.json": JSON.stringify({
      name: "inventory-fixture",
      version: "1.0.0",
      type: "module",
      files: ["dist", "skills", "!skills/_artifacts"],
      scripts: { prepack: "exit 9" },
    }),
    "dist/runtime.js": "export {};",
    "skills/example/SKILL.md": "# Example",
    "skills/example/references/config.md": "# Configuration",
    "skills/_artifacts/plan.md": "Planning artifact",
    ".scratch/report.json": "{}",
  };
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}
function verify(root: string) {
  const before = readdirSync(root).sort();
  const result = spawnSync("node", [join(repo, "scripts/verify-package.mjs"), root], {
    cwd: repo,
    encoding: "utf8",
    timeout: 20000,
    env: { ...process.env, TMPDIR: root },
  });
  expect(readdirSync(root).sort()).toEqual(before);
  return result;
}
it("accepts a complete inventory without installing or executing a consumer", () => {
  const result = verify(fixture());
  expect({ status: result.status, output: result.stdout + result.stderr }).toMatchObject({
    status: 0,
  });
});
function publishFiles(root: string, files: string[]) {
  const path = join(root, "package.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.files = files;
  writeFileSync(path, JSON.stringify(manifest));
}
it("rejects a missing runtime asset", () => {
  const root = fixture();
  rmSync(join(root, "dist/runtime.js"));
  const result = verify(root);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Missing package file: dist/runtime.js");
});
it("rejects an omitted bundled skill reference", () => {
  const root = fixture();
  publishFiles(root, ["dist", "skills", "!skills/_artifacts", "!skills/example/references"]);
  const result = verify(root);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Missing package file: skills/example/references/config.md");
});
it.each([
  [".scratch", ".scratch/report.json"],
  ["skills/_artifacts", "skills/_artifacts/plan.md"],
])("rejects included development files from %s", (directory, leakedFile) => {
  const root = fixture();
  publishFiles(root, ["dist", "skills", "!skills/_artifacts", directory]);
  const result = verify(root);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`Unwanted package file: ${leakedFile}`);
});
