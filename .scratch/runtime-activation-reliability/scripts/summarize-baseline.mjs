import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const input = resolve(process.env.ARTIFACT_ROOT ?? "/tmp/islands-mobile-baseline-before");
const output = resolve(process.env.EVIDENCE_ROOT ?? join(root, "evidence"));
await mkdir(output, { recursive: true });
const summary = JSON.parse(await readFile(join(input, "summary.json"), "utf8"));
const state = JSON.parse(await readFile(join(input, "state.json"), "utf8"));
if (state.phase !== "complete") throw new Error(`Baseline incomplete: ${state.phase}`);
const routes = ["home", "collection", "product", "search"];
const keys = [
  "lcpMs",
  "cls",
  "tbtMs",
  "fcpMs",
  "speedIndexMs",
  "jsTransferBytes",
  "totalTransferBytes",
];
const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { median: sorted[Math.floor(sorted.length / 2)], min: sorted[0], max: sorted.at(-1) };
};
const byRoute = routes.map((route) => {
  const samples = summary.measurements.filter((m) => m.route === route);
  if (samples.length !== 3)
    throw new Error(`Expected three samples for ${route}; got ${samples.length}`);
  for (const sample of samples)
    for (const key of keys)
      if (!Number.isFinite(sample[key])) throw new Error(`Missing metric ${key} for ${route}`);
  return {
    route,
    metrics: Object.fromEntries(keys.map((key) => [key, stats(samples.map((s) => s[key]))])),
    samples,
  };
});
const readiness = routes.map((route) => {
  const samples = summary.readiness.filter((m) => m.route === route);
  if (samples.length !== 3) throw new Error(`Expected three readiness samples for ${route}`);
  const names = [...new Set(samples.flatMap((s) => s.registered.map((x) => x.name)))];
  return {
    route,
    registration: Object.fromEntries(
      names.map((name) => [
        name,
        stats(samples.flatMap((s) => s.registered.filter((r) => r.name === name).map((r) => r.ms))),
      ]),
    ),
    actions: samples.flatMap((s) => (s.actions ?? []).map((a) => ({ round: s.round, ...a }))),
  };
});
let deployment = null;
try {
  deployment = JSON.parse(await readFile(join(input, "deployment.json"), "utf8"));
} catch {}
const result = {
  sourceMetadata: {
    capturedAt: summary.capturedAt,
    pluginCommit: summary.pluginCommit,
    themeCommit: summary.themeCommit,
    browserVersion: summary.browserVersion,
    lighthouseVersion: summary.lighthouseVersion,
    puppeteerVersion: summary.puppeteerVersion,
  },
  methodology: summary.methodology,
  byRoute,
  readiness,
  deployment,
};
await writeFile(join(output, "mobile-baseline.json"), JSON.stringify(result, null, 2));
const format = (value, key) =>
  key === "cls"
    ? value.toFixed(3)
    : key.includes("Bytes")
      ? (value / 1024).toFixed(0)
      : Math.round(value).toString();
const cell = (m, key) => `${format(m.median, key)} (${format(m.min, key)}–${format(m.max, key)})`;
const columns = ["lcpMs", "cls", "tbtMs", "jsTransferBytes", "totalTransferBytes"];
const mdRows = byRoute
  .map((r) => `| ${r.route} | ${columns.map((k) => cell(r.metrics[k], k)).join(" | ")} |`)
  .join("\n");
const failedActions = readiness.flatMap((r) =>
  r.actions.filter((a) => a.outcome !== "pass").map((a) => ({ route: r.route, ...a })),
);
const warningSamples = summary.measurements.filter((m) => m.warnings?.length);
const productProvisional = warningSamples.some((m) => m.route === "product");
let runtimeSetup = null;
try {
  runtimeSetup = JSON.parse(await readFile(join(output, "runtime-setup-baseline.json"), "utf8"));
} catch {}
const runtimeRows = runtimeSetup
  ? [...new Set(runtimeSetup.results.map((r) => r.fixture))]
      .map((name) => {
        const samples = runtimeSetup.results.filter((r) => r.fixture === name);
        return `<tr><th>${name}</th><td>${stats(samples.map((s) => s.synchronousSetupMs)).median.toFixed(2)} ms</td><td>${samples[0].active.observers}</td><td>${samples[0].active.interactionAdds}</td></tr>`;
      })
      .join("")
  : "";
const consentNote = deployment?.consent
  ? `Post-run consent snapshot: ${JSON.stringify(deployment.consent)}. Consent was not recorded per audit; match this state and do not label this a declined-consent baseline.`
  : "Post-run consent snapshot unavailable.";
const notes = `Three mobile Lighthouse samples per route, cold HTTP cache and retained store access/consent. Entries are median (min–max). Readiness interactions were collected separately at normal CPU/network speed, so they must not be compared directly with simulated Lighthouse timing. No field INP or after-change speedup is established. ${productProvisional ? "Product samples carry capture-limit warnings and are provisional." : ""}`;
const md = `# Before-change baseline\n\nRevision: ${summary.pluginCommit}. Local theme: ${summary.themeCommit}. Browser: ${summary.browserVersion}; Lighthouse ${summary.lighthouseVersion}; Puppeteer ${summary.puppeteerVersion}.\n\n${notes}\n\n| Route | LCP ms | CLS | TBT ms | JS KiB | Total KiB |\n| --- | --- | --- | --- | --- | --- |\n${mdRows}\n\n## Validity\n\n- ${consentNote}\n- ${warningSamples.length} samples carry Lighthouse warnings; preserve them in mobile-baseline.json. Product capture-limit samples remain provisional.\n- The earlier headed run failed with NO_FCP and is excluded. A headless smoke audit established capability; the table uses the subsequent predeclared three-round run only.\n- ${failedActions.length} failed menu/search/cart checks across ${readiness.reduce((n, r) => n + r.actions.length, 0)} separate interaction checks. See mobile-baseline.json for outcomes, per-sample settings and observed registration timings.\n- ${deployment ? "Deployed theme and script fingerprints are in mobile-baseline.json. They were captured after the audits, not at every sample." : "Deployment fingerprint is pending; do not claim a matched deployed package version."}\n- Local source revision does not prove what plugin code Shopify serves. A matched candidate deployment is a later validation gate.\n- Correctness: the standard baseline has 336 passing tests; type check and lint pass. The opt-in regression pack has 3 passing controls and 4 intended failures.\n- Native recovery matrix was verified twice with real registration: four controls pass and later-success recovery fails.\n\n## Repeat\n\nRun scripts/measure.mjs with BASELINE_HEADLESS=true and an isolated unlocked PROFILE_ROOT, then scripts/fingerprint-deployment.mjs, then scripts/summarize-baseline.mjs. All scripts resolve installed dependencies from THEME_ROOT; no installation is performed. Credentials and Chrome profile remain outside the repository.\n\n## Decision\n\nPrioritize Activation reliability for correctness. Investigate measured page costs before attributing any LCP/TBT improvement to the runtime. Discovery's sub-millisecond local scan saving is not a storefront performance claim.\n`;
await writeFile(join(output, "BASELINE.md"), md);
const rows = byRoute
  .map(
    (r) =>
      `<tr><th>${r.route}</th>${columns.map((k) => `<td>${cell(r.metrics[k], k)}</td>`).join("")}</tr>`,
  )
  .join("");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Activation reliability prerequisites</title><style>body{max-width:1100px;margin:48px auto;padding:0 24px;background:#f5f3ee;color:#24312d;font:16px/1.6 system-ui}h1,h2{font-family:Georgia,serif;font-weight:400}h1{font-size:44px}table{border-collapse:collapse;width:100%;background:white}th,td{padding:12px;border:1px solid #d2dad2;text-align:left}small{color:#68766c}.callout{background:#183e32;color:white;padding:24px}a{color:#286b4f}code{font-size:13px} @media(max-width:700px){.scroll{overflow-x:auto}}</style></head><body><small>Before implementation · 5 November 2026 · ${summary.pluginCommit.slice(0, 7)}</small><h1>Activation reliability: prerequisite evidence</h1><div class="callout">Correctness is the established reason to change the runtime. The measurements below establish a mobile baseline, not a promised speedup.</div><h2>Mobile Lighthouse baseline</h2><p>${notes}</p><div class="scroll"><table><thead><tr><th>Route</th><th>LCP ms</th><th>CLS</th><th>TBT ms</th><th>JS KiB</th><th>Total KiB</th></tr></thead><tbody>${rows}</tbody></table></div><p><small>${summary.browserVersion} · Lighthouse ${summary.lighthouseVersion} · Puppeteer ${summary.puppeteerVersion}. Exact emulation and throttling settings, timestamps and individual samples are in the JSON.</small></p><h2>Runtime setup cost</h2><p>Separate synthetic native-browser fixtures at normal CPU speed; five samples per case. These are not page-load times.</p><div class="scroll"><table><thead><tr><th>Fixture</th><th>Median setup</th><th>Observers</th><th>Interaction listeners</th></tr></thead><tbody>${runtimeRows}</tbody></table></div><p>Compare setup, observer/listener counts and disconnect cleanup for the runtime correctness fixes. These synthetic counts are distinct from storefront performance.</p><h2>Readiness and functionality</h2><p>${readiness.reduce((n, r) => n + r.actions.length, 0)} menu/search/cart checks across 12 separate navigations; ${failedActions.length} failed checks. Registration readiness is measured separately from simulated Lighthouse; it is not field INP. Review outcomes in <a href="mobile-baseline.json">the machine-readable evidence</a>.</p><h2>Regression gates</h2><ul><li>Standard suite: 336 pass, zero fail. Type check and lint pass.</li><li>Opt-in desired-behavior pack: three controls pass; four regressions fail at baseline.</li><li>Native recovery: first success, exhaustion stop, automatic retry and explicit-scan controls pass; recovery after a later successful fresh load fails.</li><li>Detailed behavior, race, cleanup, compatibility and candidate-comparison requirements are in <a href="../PRD.md">the implementation brief</a>.</li></ul><h2>Limits and next step</h2><p>${consentNote}</p><p>The headed NO_FCP run was discarded. This table uses the subsequent three-round headless run. Deployment fingerprint ${deployment ? "was captured after the audit and is included in the JSON" : "has not been captured"}. The deployed package version is not inferred from local source. A candidate preview must be matched before making a before/after claim.</p><p>These are lab observations. Three samples are directional evidence; large asset costs and third-party variability can dominate runtime changes. No code fix, deployment or package release is included here.</p><p><a href="BASELINE.md">Baseline notes</a> · <a href="../PRD.md">Implementation brief</a> · <a href="../issues/01-tag-cancellation-and-settlement.md">First implementation issue</a></p></body></html>`;
await writeFile(join(output, "report.html"), html);
console.log(
  JSON.stringify(
    {
      byRoute: byRoute.map((r) => ({
        route: r.route,
        ...Object.fromEntries(columns.map((k) => [k, r.metrics[k]])),
      })),
      failedActions,
    },
    null,
    2,
  ),
);
