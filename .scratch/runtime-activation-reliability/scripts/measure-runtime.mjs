import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const featureRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(featureRoot, "../..");
const themeRoot =
  process.env.THEME_ROOT ?? "/Users/alexrees/Documents/Lazer/Golfballs/golfballs-theme";
const requireTheme = createRequire(join(themeRoot, "package.json"));
const puppeteer = requireTheme("puppeteer");
const fixture = process.env.RUNTIME_FIXTURE ?? "native-scale.html";
if (!["native-scale.html", "native-recovery.html", "native-policy.html"].includes(fixture))
  throw new Error("Unknown runtime fixture");
const output = resolve(process.env.RUNTIME_ARTIFACT_ROOT ?? "/tmp/islands-runtime-baseline");
const temporary = await mkdtemp(join(tmpdir(), "islands-runtime-scale-"));
execFileSync(
  "bun",
  [
    "build",
    join(repoRoot, "src/runtime.ts"),
    "--outfile",
    join(temporary, "runtime.js"),
    "--format",
    "esm",
    "--target",
    "browser",
  ],
  { stdio: "pipe" },
);
const server = createServer(async (request, response) => {
  try {
    const name =
      request.url === "/"
        ? join(featureRoot, "checks", fixture)
        : request.url === "/runtime.js"
          ? join(temporary, "runtime.js")
          : null;
    if (!name) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.setHeader(
      "Content-Type",
      request.url === "/" ? "text/html" : "application/javascript",
    );
    response.end(await readFile(name));
  } catch {
    response.writeHead(500);
    response.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await puppeteer.launch({
    headless: true,
    executablePath:
      process.env.CHROME_EXECUTABLE ??
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  const page = await browser.newPage();
  await page.setViewport({
    width: 412,
    height: 823,
    deviceScaleFactor: 1.75,
    isMobile: true,
    hasTouch: true,
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "load" });
  await page.waitForSelector("#results", { timeout: 30000 });
  const results = JSON.parse(await page.$eval("#results", (el) => el.textContent));
  await mkdir(output, { recursive: true });
  const data = {
    capturedAt: new Date().toISOString(),
    pluginCommit: execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    runtimeBundleSha256: createHash("sha256").update(await readFile(join(temporary, "runtime.js"))).digest("hex"),
    browserVersion: await browser.version(),
    fixture,
    methodology:
      fixture === "native-scale.html"
        ? "Native Chromium; normal CPU/network; real hidden visibility targets and real interaction listeners; five setup samples per fixture; synthetic runtime-only setup, not page speed"
        : "Native Chromium functional fixture with real customElements registration and MutationObserver",
    results,
  };
  await writeFile(join(output, "summary.json"), JSON.stringify(data, null, 2));
  console.log(JSON.stringify(data, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
