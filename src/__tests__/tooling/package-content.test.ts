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
      name: "vite-plugin-shopify-theme-islands",
      version: "1.0.0",
      type: "module",
      keywords: ["tanstack-intent"],
      repository: {
        type: "git",
        url: "https://github.com/example/vite-plugin-shopify-theme-islands.git",
      },
      files: ["dist", "revive.d.ts", "skills", "!skills/_artifacts"],
      main: "./dist/index.js",
      types: "./dist/index.d.ts",
      exports: {
        ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
        "./island": { types: "./dist/island.d.ts", import: "./dist/island.js" },
        "./events": { types: "./dist/events.d.ts", import: "./dist/events.js" },
        "./revive": { types: "./revive.d.ts" },
      },
      sideEffects: ["./dist/runtime.js"],
      peerDependencies: { vite: ">=6" },
    }),
    "dist/index.js": "export default function plugin() { return {}; }",
    "dist/index.d.ts": "export default function plugin(): object;",
    "dist/runtime.js": "export const revive = () => {};",
    "dist/island.js": "export default function Island(Base) { return Base; }",
    "dist/island.d.ts":
      "export default function Island<T extends new (...args: any[]) => HTMLElement>(Base: T): T;",
    "dist/events.js":
      "export function onIslandLoad(handler) { return () => {}; } export function onIslandError(handler) { return () => {}; }",
    "dist/events.d.ts":
      "export function onIslandLoad(handler: (detail: {tag: string; duration: number; attempt: number}) => void): () => void; export function onIslandError(handler: (detail: {tag: string; error: unknown; attempt: number}) => void): () => void;",
    "revive.d.ts":
      'declare module "vite-plugin-shopify-theme-islands/revive" { export const disconnect: () => void; export const scan: (root?: HTMLElement | null) => void; export const observe: typeof scan; export const unobserve: typeof scan; }',
    "skills/example/SKILL.md":
      "---\nname: example\ndescription: Use when configuring the example plugin.\nmetadata:\n  library_version: '1.0.0'\n---\n\n# Example\n\nRead [the reference](references/config.md).\n",
    "skills/example/references/config.md": "# Configuration\n\nConfigure the plugin before use.\n",
    "skills/_artifacts/plan.md": "Authoring plan, excluded from the package.",
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
it("rejects a tarball missing a public export target", () => {
  const root = fixture();
  rmSync(join(root, "dist/events.js"));
  const result = verify(root);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("dist/events.js");
});
function publishFiles(root: string, files: string[]) {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  manifest.files = files;
  writeFileSync(join(root, "package.json"), JSON.stringify(manifest));
}
it("rejects a bundled skill omitted by publishing rules", () => {
  const root = fixture();
  publishFiles(root, ["dist", "revive.d.ts"]);
  const result = verify(root);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Missing package file: skills/example/");
});
it("rejects development files accidentally included in the tarball", () => {
  const root = fixture();
  publishFiles(root, ["dist", "revive.d.ts", "skills", "!skills/_artifacts", ".scratch"]);
  const result = verify(root);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Unwanted package file: .scratch/report.json");
});
it("rejects a packaged module that cannot provide its public exports", () => {
  const root = fixture();
  writeFileSync(join(root, "dist/events.js"), "export const unrelated = true;");
  const result = verify(root);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("onIslandLoad");
});
it("rejects declarations that cannot typecheck a public consumer", () => {
  const root = fixture();
  writeFileSync(
    join(root, "dist/events.d.ts"),
    "export function onIslandLoad(handler: (detail: {tag: number; duration: number; attempt: number}) => void): () => void; export function onIslandError(handler: (detail: {tag: string; error: unknown; attempt: number}) => void): () => void;",
  );
  const result = verify(root);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("TS2322");
});
it("rejects packaged skills that cannot be discovered by the native CLI", () => {
  const root = fixture();
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  delete manifest.repository;
  writeFileSync(join(root, "package.json"), JSON.stringify(manifest));
  const result = verify(root);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Missing discovered skill");
});
it("accepts a complete tarball through imports, types and skill discovery", () => {
  const result = verify(fixture());
  expect({ status: result.status, output: result.stdout + result.stderr }).toMatchObject({
    status: 0,
  });
  expect(JSON.parse(result.stdout)).toMatchObject({
    skills: ["example"],
    checks: ["contents", "imports", "types", "skill-discovery"],
  });
});
it("rejects an omitted bundled skill reference", () => {
  const root = fixture();
  publishFiles(root, [
    "dist",
    "revive.d.ts",
    "skills",
    "!skills/_artifacts",
    "!skills/example/references",
  ]);
  const result = verify(root);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Missing package file: skills/example/references/config.md");
});
it("rejects planning artifacts included in the tarball", () => {
  const root = fixture();
  publishFiles(root, ["dist", "revive.d.ts", "skills"]);
  const result = verify(root);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Unwanted package file: skills/_artifacts/plan.md");
});
it("verifies the package without executing pack or install hooks", () => {
  const root = fixture();
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  manifest.scripts = { prepack: "exit 9", postinstall: "exit 9" };
  writeFileSync(join(root, "package.json"), JSON.stringify(manifest));
  const result = verify(root);
  expect({ status: result.status, output: result.stdout + result.stderr }).toMatchObject({
    status: 0,
  });
});
it("rejects invalid package metadata outside the exports map", () => {
  const root = fixture();
  const path = join(root, "package.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.module = "./dist/missing-module.js";
  writeFileSync(path, JSON.stringify(manifest));
  const result = verify(root);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("missing-module.js");
});
it("rejects unresolved public declarations with stage and compiler diagnostics", () => {
  const root = fixture();
  const path = join(root, "dist/events.d.ts");
  writeFileSync(path, readFileSync(path, "utf8").replace(/tag: string/g, "tag: MissingType"));
  const result = verify(root);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Typecheck consumer failed");
  expect(result.stderr).toContain("TS2304");
});
