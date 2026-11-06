import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

try {
  const root = new URL("../", import.meta.url);
  const project = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
  const dependency = new URL("node_modules/@tanstack/intent/", root);
  const manifest = JSON.parse(readFileSync(new URL("package.json", dependency), "utf8"));
  const cli = fileURLToPath(new URL(manifest.bin.intent, dependency));
  const stdout = execFileSync(process.execPath, [cli, "stale", "--json"], {
    cwd: fileURLToPath(root),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const reports = JSON.parse(stdout);
  if (
    !Array.isArray(reports) ||
    reports.length !== 1 ||
    reports[0]?.library !== project.name ||
    !Array.isArray(reports[0].skills) ||
    reports[0].skills.length === 0
  ) {
    throw new Error("Invalid Intent report: expected this project's nonempty skill report");
  }
  if (typeof reports[0].currentVersion !== "string" || !reports[0].currentVersion.trim())
    throw new Error("Intent could not determine the published package version");
  for (const skill of reports[0].skills) {
    if (
      !skill ||
      typeof skill.name !== "string" ||
      !skill.name.trim() ||
      typeof skill.needsReview !== "boolean" ||
      !Array.isArray(skill.reasons) ||
      !skill.reasons.every((reason) => typeof reason === "string")
    ) {
      throw new Error("Invalid Intent skill result");
    }
  }
  const stale = reports.flatMap((report) =>
    report.skills
      .filter((skill) => skill.needsReview)
      .map((skill) => ({ library: report.library, skill: skill.name, reasons: skill.reasons })),
  );
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `has_stale=${stale.length > 0}\nstale_json=${JSON.stringify(stale)}\n`,
    );
  console.log(JSON.stringify({ has_stale: stale.length > 0, stale }));
} catch (error) {
  console.error(`[skills:check] ${error.message}`);
  process.exitCode = 1;
}
