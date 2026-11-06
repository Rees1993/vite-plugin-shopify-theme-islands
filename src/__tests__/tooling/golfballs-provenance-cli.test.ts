import { afterEach, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const script = resolve(
  import.meta.dir,
  "../../../.scratch/golfballs-validation/check-provenance.mjs",
);
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function check(data: unknown) {
  const root = mkdtempSync(join(tmpdir(), "golfballs-provenance-"));
  roots.push(root);
  const file = join(root, "report.json");
  writeFileSync(file, JSON.stringify(data));
  return spawnSync("node", [script, file], { encoding: "utf8" });
}

it("accepts a local flow only when the expected runtime response and fingerprint are present", () => {
  const expected = { url: "http://localhost:5175/@fs/local-plugin/dist/runtime.js", sha256: "abc" };
  const row = { localModuleResponses: [{ ...expected, status: 200 }] };
  expect(check({ mode: "local", expected, row }).status).toBe(0);
  expect(check({ mode: "local", expected, row: { localModuleResponses: [] } }).status).not.toBe(0);
  expect(
    check({
      mode: "local",
      expected,
      row: { localModuleResponses: [{ ...expected, status: 200, sha256: "wrong" }] },
    }).status,
  ).not.toBe(0);
});

it("rejects an overridden flow that fell back to a deployed bootstrap", () => {
  const expected = { file: "theme.candidate.min.js", sha256: "candidate-hash" };
  expect(
    check({
      mode: "override",
      expected,
      row: { overrides: [{ served: expected.file, sha256: expected.sha256 }] },
    }).status,
  ).toBe(0);
  expect(check({ mode: "override", expected, row: { overrides: [] } }).status).not.toBe(0);
  expect(
    check({
      mode: "override",
      expected,
      row: { overrides: [{ served: expected.file, sha256: "deployed-hash" }] },
    }).status,
  ).not.toBe(0);
});

it("reads the prepared build's source reference and rejects changed bootstrap bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "golfballs-build-"));
  roots.push(root);
  mkdirSync(join(root, "baseline/assets"), { recursive: true });
  const asset = join(root, "baseline/assets/theme.fixture.js");
  writeFileSync(asset, "prepared baseline");
  const metadata = {
    variant: "baseline",
    pluginCommit: "alternate-baseline",
    themeCommit: "prepared-theme",
    bootstrap: {
      file: "theme.fixture.js",
      sha256: createHash("sha256").update("prepared baseline").digest("hex"),
    },
  };
  writeFileSync(join(root, "baseline/validation-build.json"), JSON.stringify(metadata));
  const request = { mode: "build", root, variant: "baseline" };
  const result = check(request);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout).pluginCommit).toBe("alternate-baseline");
  expect(JSON.parse(result.stdout).themeCommit).toBe("prepared-theme");
  writeFileSync(asset, "changed after preparation");
  expect(check(request).status).not.toBe(0);
});

it("rejects a route filter that would silently run zero flow checks", () => {
  const result = spawnSync("node", [resolve(script, "../flows.mjs")], {
    encoding: "utf8",
    timeout: 2000,
    env: { ...process.env, GOLFBALLS_FLOW_ROUTE: "misspelled-route" },
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Unknown flow route");
});

it("rejects zero measurement rounds before preparing or launching a browser", () => {
  const result = spawnSync("node", [resolve(script, "../validate.mjs")], {
    encoding: "utf8",
    timeout: 2000,
    env: { ...process.env, GOLFBALLS_ROUNDS: "0" },
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("GOLFBALLS_ROUNDS must be a positive integer");
});
