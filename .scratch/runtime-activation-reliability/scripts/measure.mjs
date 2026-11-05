import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const themeRoot = resolve(
  process.env.THEME_ROOT ?? "/Users/alexrees/Documents/Lazer/Golfballs/golfballs-theme",
);
const artifactRoot = resolve(process.env.ARTIFACT_ROOT ?? "/tmp/islands-mobile-baseline");
const runs = Number(process.env.BASELINE_RUNS ?? 3);
const maxWaitForLoad = Number(process.env.BASELINE_MAX_WAIT_MS ?? 45000);
const phase = process.env.BASELINE_PHASE ?? "all";
const requireTheme = createRequire(join(themeRoot, "package.json"));
const puppeteer = requireTheme("puppeteer");
const { default: lighthouse } = await import(
  pathToFileURL(requireTheme.resolve("lighthouse")).href
);
const pluginCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const themeCommit = execFileSync("git", ["-C", themeRoot, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const origin = "https://golfballscom.myshopify.com";
const previewThemeId = process.env.BASELINE_PREVIEW_THEME_ID;
const routeUrl = (path) => {
  const url = new URL(path, origin);
  if (previewThemeId) url.searchParams.set("preview_theme_id", previewThemeId);
  return url.href;
};
const routeFilter = process.env.BASELINE_ROUTES?.split(",");
const pages = [
  { name: "home", path: "/" },
  { name: "collection", path: "/collections/golf-balls" },
  { name: "product", path: "/products/titleist-pro-v1-golf-balls-p01155" },
  { name: "search", path: "/search?q=Pro+V1" },
].filter((route) => !routeFilter || routeFilter.includes(route.name));
await mkdir(artifactRoot, { recursive: true });
const checkpoint = async (data) =>
  writeFile(join(artifactRoot, "state.json"), JSON.stringify(data, null, 2));
const browser = await puppeteer.launch({
  executablePath:
    process.env.CHROME_EXECUTABLE ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: process.env.BASELINE_HEADLESS === "true",
  userDataDir: process.env.PROFILE_ROOT ?? join(artifactRoot, "profile"),
  defaultViewport: {
    width: 412,
    height: 823,
    deviceScaleFactor: 1.75,
    isMobile: true,
    hasTouch: true,
  },
});
const page = await browser.newPage();
const summary = {
  capturedAt: new Date().toISOString(),
  pluginCommit,
  themeCommit,
  themeRoot,
  lighthouseVersion: requireTheme("lighthouse/package.json").version,
  puppeteerVersion: requireTheme("puppeteer/package.json").version,
  browserVersion: await browser.version(),
  samplesPerPage: runs,
  requestedPreviewThemeId: previewThemeId ?? null,
  measurements: [],
  readiness: [],
  methodology: {
    mode: "mobile Lighthouse simulated Slow 4G and 4x CPU slowdown; explicit cold HTTP cache per run; retained store authentication and consent",
    consent: "declined when banner available",
    order: "round-robin routes, sequential runs",
    readiness:
      "separate cold navigations at normal CPU/network speed; observed :defined timestamps plus menu/search/cart click-to-state checks; not field INP",
    limitations: [
      "Deployed plugin version is not inferred from the local package version.",
      "TBT is a lab metric, not field INP.",
      "No after-change comparison exists yet.",
    ],
  },
};
await writeFile(join(artifactRoot, "summary.json"), JSON.stringify(summary, null, 2));
try {
  await page.goto(routeUrl("/"), { waitUntil: "domcontentloaded", timeout: 60000 });
  if (new URL(page.url()).pathname.includes("/password")) {
    await checkpoint({ phase: "awaiting_store_access", origin });
    console.log("Store access required: unlock the Google Chrome measurement window.");
    await page.waitForFunction(() => !location.pathname.includes("/password"), { timeout: 600000 });
  }
  const decline = await page.$("#shopify-pc__banner__btn-decline");
  if (decline) await decline.click();
  await checkpoint({ phase: "measuring", completed: 0, total: pages.length * runs });
  // Passing the authenticated Puppeteer page avoids writing cookies to artifacts.
  summary.methodology.consent = await page.evaluate(
    () => window.Shopify?.customerPrivacy?.currentVisitorConsent?.() ?? null,
  );
  if (phase !== "readiness") {
    for (let round = 1; round <= runs; round++) {
      for (const route of pages) {
        const cdp = await page.createCDPSession();
        await cdp.send("Network.clearBrowserCache");
        await cdp.detach();
        const result = await lighthouse(
          routeUrl(route.path),
          {
            onlyCategories: ["performance"],
            output: "json",
            logLevel: "error",
            disableStorageReset: true,
            formFactor: "mobile",
            throttlingMethod: "simulate",
            maxWaitForLoad,
          },
          undefined,
          page,
        );
        const lhr = result.lhr;
        if (
          new URL(lhr.finalDisplayedUrl ?? lhr.finalUrl).pathname.includes("/password") ||
          lhr.runtimeError
        )
          throw new Error(
            `Invalid measurement for ${route.name}: ${lhr.runtimeError?.code ?? "password page"}`,
          );
        const audits = lhr.audits;
        const bytes = audits["resource-summary"]?.details?.items ?? [];
        const item = {
          route: route.name,
          path: route.path,
          round,
          fetchTime: lhr.fetchTime,
          performanceScore: lhr.categories.performance.score,
          lcpMs: audits["largest-contentful-paint"]?.numericValue,
          cls: audits["cumulative-layout-shift"]?.numericValue,
          tbtMs: audits["total-blocking-time"]?.numericValue,
          fcpMs: audits["first-contentful-paint"]?.numericValue,
          speedIndexMs: audits["speed-index"]?.numericValue,
          jsTransferBytes: bytes.find((x) => x.resourceType === "script")?.transferSize ?? null,
          totalTransferBytes: bytes.find((x) => x.resourceType === "total")?.transferSize ?? null,
          settings: {
            formFactor: lhr.configSettings.formFactor,
            screenEmulation: lhr.configSettings.screenEmulation,
            throttling: lhr.configSettings.throttling,
            throttlingMethod: lhr.configSettings.throttlingMethod,
            maxWaitForLoad: lhr.configSettings.maxWaitForLoad,
          },
          warnings: lhr.runWarnings,
          consentAfterAudit: await page.evaluate(
            () => window.Shopify?.customerPrivacy?.currentVisitorConsent?.() ?? null,
          ),
        };
        summary.measurements.push(item);
        // Only numeric summaries and selected settings persist; full LHRs can contain session URLs.
        await writeFile(join(artifactRoot, "summary.json"), JSON.stringify(summary, null, 2));
        await checkpoint({
          phase: "measuring",
          completed: summary.measurements.length,
          total: pages.length * runs,
          lastRoute: route.name,
        });
        console.log(
          JSON.stringify({
            completed: summary.measurements.length,
            route: route.name,
            round,
            lcpMs: item.lcpMs,
            tbtMs: item.tbtMs,
            cls: item.cls,
          }),
        );
      }
    }
  }
  if (phase !== "audit") {
    await checkpoint({ phase: "readiness", completed: 0, total: pages.length * runs });
    await page.evaluateOnNewDocument(() => {
      const records = [];
      const selectors = {
        mobileMenu: "mobile-menu",
        cart: "cart-drawer",
        search: "search-modal",
        buyBox: "pdp-buy-box",
        collectionFilters: "collection-filters",
        searchFilters: "search-filters",
      };
      const pending = new Set(Object.keys(selectors));
      const start = () => {
        const poll = () => {
          for (const name of pending) {
            const el = document.querySelector(selectors[name]);
            if (el?.matches(":defined")) {
              records.push({ name, ms: performance.now() });
              pending.delete(name);
            }
          }
          if (performance.now() < 15000 && pending.size) requestAnimationFrame(poll);
        };
        requestAnimationFrame(poll);
      };
      window.__islandsReadiness = records;
      document.addEventListener("DOMContentLoaded", start, { once: true });
    });
    for (let round = 1; round <= runs; round++) {
      for (const route of pages) {
        const cdp = await page.createCDPSession();
        await cdp.send("Network.clearBrowserCache");
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
        await cdp.send("Network.emulateNetworkConditions", {
          offline: false,
          latency: 0,
          downloadThroughput: -1,
          uploadThroughput: -1,
        });
        await cdp.detach();
        await page.setViewport({
          width: 412,
          height: 823,
          deviceScaleFactor: 1.75,
          isMobile: true,
          hasTouch: true,
        });
        await page.goto(routeUrl(route.path), { waitUntil: "domcontentloaded", timeout: 60000 });
        const actions = [];
        const checkAction = async (name, action) => {
          const started = await page.evaluate(() => performance.now());
          try {
            await action();
            const completed = await page.evaluate(() => performance.now());
            actions.push({
              name,
              outcome: "pass",
              completedSinceNavigationMs: completed,
              interactionMs: completed - started,
            });
          } catch (error) {
            actions.push({ name, outcome: "fail", reason: error.message.split("\n")[0] });
          }
        };
        await checkAction("mobile-menu", async () => {
          await page.waitForSelector("mobile-menu:defined [data-menu-trigger]", {
            visible: true,
            timeout: 15000,
          });
          await page.locator("[data-menu-trigger]").click();
          await page.waitForSelector('mobile-menu[data-state="open"]', { timeout: 5000 });
          await page.locator("button[data-menu-close]").click();
          await page.waitForFunction(
            () => !document.querySelector("mobile-menu")?.hasAttribute("data-state"),
            { timeout: 5000 },
          );
        });
        await checkAction("search-modal", async () => {
          await page.waitForSelector("search-modal:defined", { timeout: 15000 });
          await page.locator('a[data-trigger="search-modal"]').click();
          await page.waitForSelector('search-modal[data-active="true"]', { timeout: 5000 });
          await page.locator("[data-search-modal-close]").click();
          await page.waitForSelector('search-modal[data-active="false"]', { timeout: 5000 });
        });
        await checkAction("cart-drawer", async () => {
          await page.waitForSelector("cart-drawer:defined", { timeout: 15000 });
          await page.locator("a[data-cart-drawer-trigger]").click();
          await page.waitForSelector('cart-drawer[data-state="open"]', { timeout: 5000 });
          await page.locator("button[data-cart-drawer-close]").click();
          await page.waitForFunction(
            () => !document.querySelector("cart-drawer")?.hasAttribute("data-state"),
            { timeout: 5000 },
          );
        });
        await new Promise((r) => setTimeout(r, 2000));
        await page.screenshot({
          path: join(artifactRoot, `${route.name}-${round}.png`),
          fullPage: false,
        });
        const data = await page.evaluate(() => ({
          registered: window.__islandsReadiness,
          navigation: performance.getEntriesByType("navigation").map((n) => ({
            domContentLoadedMs: n.domContentLoadedEventEnd,
            loadMs: n.loadEventEnd,
          })),
          scripts: Array.from(document.scripts)
            .filter(
              (s) =>
                s.src &&
                new URL(s.src).pathname.includes("/assets/") &&
                /\.js$/.test(new URL(s.src).pathname),
            )
            .map((s) => new URL(s.src).pathname),
          themeId: window.Shopify?.theme?.id ?? null,
        }));
        summary.readiness.push({ route: route.name, round, actions, ...data });
        await writeFile(join(artifactRoot, "summary.json"), JSON.stringify(summary, null, 2));
        await checkpoint({
          phase: "readiness",
          completed: summary.readiness.length,
          total: pages.length * runs,
        });
        console.log(
          JSON.stringify({
            readinessCompleted: summary.readiness.length,
            route: route.name,
            round,
          }),
        );
      }
    }
  }
  await checkpoint({
    phase: "complete",
    completed: summary.measurements.length,
    readinessCompleted: summary.readiness.length,
  });
  console.log(`Complete: ${join(artifactRoot, "summary.json")}`);
} catch (error) {
  await checkpoint({
    phase: "failed",
    reason: error.message,
    page: new URL(page.url()).pathname,
    title: await page.title(),
  });
  await page.screenshot({ path: join(artifactRoot, "failed-measurement.png") }).catch(() => {});
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
