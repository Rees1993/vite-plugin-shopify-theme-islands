import { afterEach, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repo = resolve(import.meta.dir, "../../..");
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function checkSkill(frontmatter: string) {
  const root = mkdtempSync(join(tmpdir(), "intent-command-"));
  roots.push(root);
  const project = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      name: "skill-validation-fixture",
      version: "1.0.0",
      files: ["skills"],
      scripts: { "skills:check": project.scripts["skills:check"] },
    }),
  );
  symlinkSync(join(repo, "node_modules"), join(root, "node_modules"), "dir");
  mkdirSync(join(root, "skills/example"), { recursive: true });
  writeFileSync(
    join(root, "skills/example/SKILL.md"),
    `---\n${frontmatter}\n---\n\n# Example\n\nUse this skill to configure an example project. Read its configuration before editing it.\n`,
  );
  return spawnSync("bun", ["run", "skills:check"], { cwd: root, encoding: "utf8", timeout: 10000 });
}
it("accepts valid package skills through the configured validation command", () => {
  const result = checkSkill(
    "name: example\ndescription: Configure an example project when asked to change its settings.",
  );
  expect({ status: result.status, output: result.stdout + result.stderr }).toMatchObject({
    status: 0,
  });
});
it("fails malformed skills through the configured validation command", () => {
  const result = checkSkill("name: example");
  expect(result.status).toBe(1);
  expect(result.stdout + result.stderr).toContain("description");
});
it("typechecks the documented inheritance example as two real Island files", () => {
  const root = mkdtempSync(join(tmpdir(), "intent-inheritance-"));
  roots.push(root);
  const skill = readFileSync(join(repo, "skills/writing-islands/SKILL.md"), "utf8");
  for (const name of ["CartItems.ts", "CartDrawerItems.ts"]) {
    const marker = `// frontend/js/islands/${name}\n`;
    const example = skill.split(marker)[1]?.split("\n```")[0];
    expect(example).toBeDefined();
    writeFileSync(join(root, name), example!);
  }
  const result = spawnSync(
    process.execPath,
    [
      join(repo, "node_modules/typescript/bin/tsc"),
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "--target",
      "ES2020",
      "--moduleResolution",
      "bundler",
      "--module",
      "esnext",
      "--lib",
      "ES2020,DOM",
      join(root, "CartItems.ts"),
      join(root, "CartDrawerItems.ts"),
    ],
    { cwd: repo, encoding: "utf8", timeout: 10000 },
  );
  expect({ status: result.status, output: result.stdout + result.stderr }).toMatchObject({
    status: 0,
  });
});
