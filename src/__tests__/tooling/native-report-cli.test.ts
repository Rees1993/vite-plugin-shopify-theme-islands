import { afterEach, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repo = resolve(import.meta.dir, "../../..");
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function report(name: string) {
  return JSON.parse(readFileSync(join(repo, "tests/native/reports", name), "utf8"));
}
function verify(data: unknown) {
  const root = mkdtempSync(join(tmpdir(), "islands-native-report-"));
  roots.push(root);
  const path = join(root, "report.json");
  writeFileSync(path, JSON.stringify(data));
  return spawnSync("node", [join(repo, "scripts/validate-native-report.mjs"), path], {
    encoding: "utf8",
  });
}
it("accepts a complete recovery fixture through the report CLI", () => {
  expect(verify(report("recovery.json")).status).toBe(0);
});

it("rejects a functional failure even when the browser produced valid JSON", () => {
  const data = report("recovery.json");
  data.results[0].pass = false;
  const result = verify(data);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("initial-success");
});

it("rejects a truncated functional report instead of accepting an empty success set", () => {
  const data = report("recovery.json");
  data.results = [];
  expect(verify(data).status).not.toBe(0);
});

it("accepts the expected resource-budget fixture", () => {
  expect(verify(report("resource-budget.json")).status).toBe(0);
});

it("rejects added listeners and disconnect leaks", () => {
  const data = report("resource-budget.json");
  data.results[0].afterDisconnect.disconnections = 0;
  expect(verify(data).status).not.toBe(0);
  const excess = report("resource-budget.json");
  excess.results.at(-1).active.interactionAdds = 3000;
  expect(verify(excess).status).not.toBe(0);
});

it("rejects browser errors even if every fixture verdict passed", () => {
  const data = report("recovery.json");
  data.errors = ["Uncaught exception"];
  expect(verify(data).status).not.toBe(0);
});
