import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath)
  throw new Error(
    "Usage: node compare-baseline.mjs <before/mobile-baseline.json> <after/mobile-baseline.json>",
  );
const before = JSON.parse(await readFile(resolve(beforePath), "utf8"));
const after = JSON.parse(await readFile(resolve(afterPath), "utf8"));
if (!before.deployment?.theme?.id || !after.deployment?.theme?.id)
  throw new Error("Missing deployed theme fingerprint");
if (JSON.stringify(before.deployment.consent) !== JSON.stringify(after.deployment.consent))
  throw new Error("Consent changed; rerun a matched baseline");
for (const key of ["browserVersion", "lighthouseVersion", "puppeteerVersion"])
  if (before.sourceMetadata[key] !== after.sourceMetadata[key])
    throw new Error(`Incomparable ${key}: rerun a matched baseline`);
for (const route of before.byRoute) {
  const candidate = after.byRoute.find((r) => r.route === route.route);
  if (!candidate) throw new Error(`Missing candidate route ${route.route}`);
  if (route.samples[0].path !== candidate.samples[0].path)
    throw new Error(`Route changed for ${route.route}`);
  if (route.samples.length !== candidate.samples.length)
    throw new Error(`Sample count changed for ${route.route}`);
  if (JSON.stringify(route.samples[0].settings) !== JSON.stringify(candidate.samples[0].settings))
    throw new Error(`Emulation/throttling changed for ${route.route}`);
  for (const sample of [...route.samples, ...candidate.samples])
    if (JSON.stringify(sample.settings) !== JSON.stringify(route.samples[0].settings))
      throw new Error(`Inconsistent settings within ${route.route}`);
  if ([...route.samples, ...candidate.samples].some((sample) => sample.warnings?.length)) {
    console.log(
      JSON.stringify({
        route: route.route,
        status: "provisional",
        reason:
          "Capture warnings present; no performance improvement classification is produced for this route.",
      }),
    );
    continue;
  }
  const metrics = Object.fromEntries(
    ["lcpMs", "cls", "tbtMs", "jsTransferBytes", "totalTransferBytes"].map((key) => {
      const b = route.metrics[key],
        a = candidate.metrics[key];
      return [
        key,
        {
          before: b,
          after: a,
          medianDelta: a.median - b.median,
          medianPercent: b.median ? (100 * (a.median - b.median)) / b.median : null,
          outsideBeforeRange: a.median < b.min || a.median > b.max,
        },
      ];
    }),
  );
  console.log(JSON.stringify({ route: route.route, metrics }));
}
console.log(
  "Descriptive comparison only. Verify deployed asset identity, matched consent/routes, functional correctness and variance before claiming improvement. Range flags are investigation signals, not statistical significance.",
);
