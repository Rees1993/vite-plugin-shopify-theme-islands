import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
import { validateNativeReport } from "./validate-native-report.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(process.env.RUNTIME_SOURCE_ROOT ?? repo);
const output = resolve(process.env.RUNTIME_ARTIFACT_ROOT ?? join(repo, "test-results/native"));
const fixtures = ["native-recovery.html", "native-policy.html", "native-scale.html"];
const selected = process.env.RUNTIME_FIXTURE ? [process.env.RUNTIME_FIXTURE] : fixtures;
if (selected.some((name) => !fixtures.includes(name))) throw new Error("Unknown runtime fixture");
const temporary = await mkdtemp(join(tmpdir(), "islands-native-"));
let browser;
let server;
let fixture;
try {
  execFileSync(
    "bun",
    [
      "build",
      join(source, "src/runtime.ts"),
      "--outfile",
      join(temporary, "runtime.js"),
      "--format",
      "esm",
      "--target",
      "browser",
    ],
    { stdio: "pipe" },
  );
  const bundle = await readFile(join(temporary, "runtime.js"));
  await mkdir(output, { recursive: true });
  server = createServer(async (request, response) => {
    try {
      if (request.url === "/favicon.ico") {
        response.writeHead(204);
        response.end();
        return;
      }
      if (request.url !== "/" && request.url !== "/runtime.js") {
        response.writeHead(404);
        response.end();
        return;
      }
      response.setHeader(
        "Content-Type",
        request.url === "/" ? "text/html" : "application/javascript",
      );
      response.end(
        request.url === "/" ? await readFile(join(repo, "tests/native/fixtures", fixture)) : bundle,
      );
    } catch {
      response.writeHead(500);
      response.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.CHROME_EXECUTABLE || undefined,
    args: process.env.CI === "true" ? ["--no-sandbox"] : [],
  });
  for (fixture of selected) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("requestfailed", (request) => errors.push(`Request failed: ${request.url()}`));
    page.on("response", (response) => {
      if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`);
    });
    const report = {
      capturedAt: new Date().toISOString(),
      pluginCommit: execFileSync("git", ["-C", source, "rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      sourceRoot: source,
      runtimeBundleSha256: createHash("sha256").update(bundle).digest("hex"),
      browserVersion: await browser.version(),
      fixture,
      errors,
      results: [],
      methodology:
        "Native Chromium runtime-only fixtures; timings informational; deterministic correctness and resource budgets enforced",
    };
    try {
      await page.setViewport({
        width: 412,
        height: 823,
        deviceScaleFactor: 1.75,
        isMobile: true,
        hasTouch: true,
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "load" });
      await page.waitForSelector("#results", { timeout: 30000 });
      report.results = JSON.parse(await page.$eval("#results", (element) => element.textContent));
      validateNativeReport(report);
      console.log(`${fixture}: ${report.results.length} checks passed`);
    } catch (error) {
      errors.push(error.message);
      process.exitCode = 1;
      console.error(`${fixture}: ${error.message}`);
    } finally {
      await writeFile(
        join(output, fixture.replace(".html", ".json")),
        JSON.stringify(report, null, 2),
      );
      await page.close();
    }
  }
} finally {
  await browser?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
