import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
const themeRoot =
  process.env.THEME_ROOT ?? "/Users/alexrees/Documents/Lazer/Golfballs/golfballs-theme";
const requireTheme = createRequire(join(themeRoot, "package.json"));
const puppeteer = requireTheme("puppeteer");
const output = resolve(process.env.ARTIFACT_ROOT ?? "/tmp/islands-mobile-baseline-before");
const browser = await puppeteer.launch({
  headless: true,
  executablePath:
    process.env.CHROME_EXECUTABLE ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  userDataDir: process.env.PROFILE_ROOT ?? "/tmp/islands-mobile-baseline/profile",
});
try {
  const page = await browser.newPage();
  await page.setViewport({
    width: 412,
    height: 823,
    deviceScaleFactor: 1.75,
    isMobile: true,
    hasTouch: true,
  });
  const captured = [];
  page.on("response", async (response) => {
    const url = new URL(response.url());
    if (
      response.request().resourceType() !== "script" ||
      !url.pathname.includes("/assets/") ||
      !url.pathname.includes("/cdn/shop/")
    )
      return;
    try {
      const bytes = await response.buffer();
      captured.push({
        path: url.pathname,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        decodedBytes: bytes.length,
      });
    } catch {}
  });
  const requestedUrl = new URL("https://golfballscom.myshopify.com/");
  if (process.env.BASELINE_PREVIEW_THEME_ID)
    requestedUrl.searchParams.set("preview_theme_id", process.env.BASELINE_PREVIEW_THEME_ID);
  await page.goto(requestedUrl.href, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  if (new URL(page.url()).pathname.includes("/password"))
    throw new Error("Store session expired; deployment fingerprint not captured.");
  await page.waitForSelector("mobile-menu:defined", { timeout: 15000 });
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const deployment = await page.evaluate(() => ({
    consent: window.Shopify?.customerPrivacy?.currentVisitorConsent?.() ?? null,
    theme: window.Shopify?.theme
      ? {
          id: window.Shopify.theme.id,
          role: window.Shopify.theme.role,
          name: window.Shopify.theme.name,
        }
      : null,
    scripts: Array.from(document.scripts)
      .filter((s) => s.src && new URL(s.src).pathname.includes("/assets/"))
      .map((s) => ({ origin: new URL(s.src).origin, path: new URL(s.src).pathname })),
  }));
  const local = [];
  for (const file of captured) {
    const name = file.path.split("/").at(-1);
    try {
      const bytes = await readFile(join(themeRoot, "assets", name));
      local.push({
        file: name,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        matchesServedAsset: createHash("sha256").update(bytes).digest("hex") === file.sha256,
      });
    } catch {
      local.push({ file: name, present: false });
    }
  }
  const result = {
    capturedAt: new Date().toISOString(),
    ...deployment,
    servedScriptHashes: captured,
    localBuiltAssetComparison: local,
    limitation:
      "Captured after baseline runs; does not prove a deployment was unchanged during every sample or that served package internals match the local plugin source.",
  };
  await writeFile(join(output, "deployment.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
