import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function validateNativeReport(report) {
  if (report?.errors !== undefined && (!Array.isArray(report.errors) || report.errors.length))
    throw new Error("Browser errors in native report");
  if (!report || !Array.isArray(report.results)) throw new Error("Invalid native report");
  if (report.fixture === "native-scale.html") {
    if (report.results.length !== 25) throw new Error("Incomplete resource samples");
    const budgets = {
      "one-visible": [1, 1, 1, 0],
      "hundred-same-visible": [100, 1, 1, 0],
      "thousand-same-visible": [1000, 1, 1, 0],
      "hundred-unique-visible": [100, 100, 100, 0],
      "thousand-same-interaction": [1000, 1, 0, 3],
    };
    const seen = new Set();
    for (const row of report.results) {
      const budget = budgets[row.fixture];
      const key = `${row.fixture}:${row.sample}`;
      if (
        !budget ||
        !Number.isInteger(row.sample) ||
        row.sample < 1 ||
        row.sample > 5 ||
        seen.has(key)
      )
        throw new Error(`Invalid resource sample: ${key}`);
      seen.add(key);
      const [count, uniqueTags, observers, listeners] = budget;
      if (
        row.count !== count ||
        row.uniqueTags !== uniqueTags ||
        !Number.isFinite(row.synchronousSetupMs) ||
        row.synchronousSetupMs < 0
      )
        throw new Error(`Invalid resource measurement: ${key}`);
      for (const [phase, disconnected] of [
        ["active", false],
        ["afterDisconnect", true],
      ]) {
        const expected = {
          observers,
          observations: observers,
          disconnections: disconnected ? observers : 0,
          interactionAdds: listeners,
          interactionRemoves: disconnected ? listeners : 0,
        };
        for (const [counter, value] of Object.entries(expected)) {
          if (row[phase]?.[counter] !== value)
            throw new Error(
              `Resource budget failed: ${key} ${phase}.${counter}; expected ${value}, received ${row[phase]?.[counter]}`,
            );
        }
      }
    }
    return report;
  }
  const modes = {
    "native-recovery.html": ["initial-success", "stop", "retry", "fresh", "fresh-and-scan"],
    "native-policy.html": [
      "scan-included-child-through-excluded-parent",
      "cancelled-owner-transfers-through-native-mutation-observer",
      "included-child-pending-gate-survives-parent-exclusion",
      "included-child-resumes-after-excluded-ancestor-import",
    ],
  }[report.fixture];
  if (
    !modes ||
    report.results.length !== modes.length ||
    new Set(report.results.map((r) => r.mode)).size !== modes.length ||
    report.results.some((r) => !modes.includes(r.mode))
  )
    throw new Error("Incomplete or unknown native cases");
  for (const result of report.results) {
    if (result?.pass !== true) throw new Error(`Native case failed: ${result?.mode ?? "unknown"}`);
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    validateNativeReport(JSON.parse(readFileSync(process.argv[2], "utf8")));
    console.log("Native report passed");
  } catch (error) {
    console.error(`[native:validate] ${error.message}`);
    process.exitCode = 1;
  }
}
