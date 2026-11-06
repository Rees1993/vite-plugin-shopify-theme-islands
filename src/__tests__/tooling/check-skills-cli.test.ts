import { afterEach, expect, it } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";

const repo = resolve(import.meta.dir, "../../..");
const temporary: string[] = [];
afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true });
});

function runStalenessStep(stdout: string, exitCode = 0) {
  const root = mkdtempSync(join(tmpdir(), "islands-skills-cli-"));
  temporary.push(root);
  writeFileSync(join(root, "package.json"), readFileSync(join(repo, "package.json")));
  if (existsSync(join(repo, "scripts")))
    cpSync(join(repo, "scripts"), join(root, "scripts"), { recursive: true });
  const bin = join(root, "node_modules/.bin");
  const cli = join(root, "node_modules/@tanstack/intent/dist/cli.mjs");
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(root, "node_modules/@tanstack/intent/dist"), { recursive: true });
  writeFileSync(
    cli,
    `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(stdout)});process.exit(${exitCode});\n`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(root, "node_modules/@tanstack/intent/package.json"),
    JSON.stringify({ bin: { intent: "dist/cli.mjs" } }),
  );
  symlinkSync(cli, join(bin, "intent"));
  const workflow = parse(readFileSync(join(repo, ".github/workflows/check-skills.yml"), "utf8"));
  const step = workflow.jobs.check.steps.find(
    (entry: { name: string }) => entry.name === "Check staleness",
  );
  const output = join(root, "output.txt");
  writeFileSync(output, "");
  const result = spawnSync("bash", ["-e", "-c", step.run], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PATH: bin + delimiter + process.env.PATH, GITHUB_OUTPUT: output },
  });
  return { ...result, outputs: readFileSync(output, "utf8") };
}

it("fails the actual workflow step when the scanner returns malformed JSON", () => {
  const result = runStalenessStep("not a JSON report");
  expect(result.status).not.toBe(0);
  expect(result.outputs).not.toContain("has_stale=false");
});

it("fails before publishing clean output when the scanner exits unsuccessfully", () => {
  const result = runStalenessStep(
    JSON.stringify([
      {
        library: "vite-plugin-shopify-theme-islands",
        currentVersion: "2.0.1",
        skills: [{ name: "setup", needsReview: false, reasons: [] }],
      },
    ]),
    7,
  );
  expect(result.status).not.toBe(0);
  expect(result.outputs).toBe("");
});

it("rejects an empty report rather than declaring this project's skills clean", () => {
  const result = runStalenessStep("[]");
  expect(result.status).not.toBe(0);
  expect(result.outputs).toBe("");
});

it("rejects truthy strings in place of a skill's boolean review result", () => {
  const result = runStalenessStep(
    JSON.stringify([
      {
        library: "vite-plugin-shopify-theme-islands",
        currentVersion: "2.0.1",
        skills: [{ name: "setup", needsReview: "false", reasons: [] }],
      },
    ]),
  );
  expect(result.status).not.toBe(0);
  expect(result.outputs).toBe("");
});

it("does not call an incomplete registry-version check healthy", () => {
  const result = runStalenessStep(
    JSON.stringify([
      {
        library: "vite-plugin-shopify-theme-islands",
        currentVersion: null,
        skills: [{ name: "setup", needsReview: false, reasons: [] }],
      },
    ]),
  );
  expect(result.status).not.toBe(0);
  expect(result.outputs).toBe("");
});

it("preserves a successful stale scan as stale rather than treating it as a command failure", () => {
  const result = runStalenessStep(
    JSON.stringify([
      {
        library: "vite-plugin-shopify-theme-islands",
        currentVersion: "2.0.1",
        skills: [{ name: "setup", needsReview: true, reasons: ["version drift"] }],
      },
    ]),
  );
  expect(result.status).toBe(0);
  expect(result.outputs).toContain("has_stale=true\n");
  expect(result.outputs).toContain('"skill":"setup"');
});

it("publishes clean output only for a complete valid clean report", () => {
  const result = runStalenessStep(
    JSON.stringify([
      {
        library: "vite-plugin-shopify-theme-islands",
        currentVersion: "2.0.1",
        skills: [{ name: "setup", needsReview: false, reasons: [] }],
      },
    ]),
  );
  expect(result.status).toBe(0);
  expect(result.outputs).toBe("has_stale=false\nstale_json=[]\n");
});
