import puppeteer from "puppeteer";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readPreparedBuild, assertFlowProvenance } from "./check-provenance.mjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
const root = process.env.GOLFBALLS_BUILD_ROOT ?? "/tmp/golfballs-validation",
  output = process.env.GOLFBALLS_FLOW_REPORT_ROOT ?? "/tmp/golfballs-live-flows";
const routes = [
  ["home", "/"],
  ["collection", "/collections/golf-balls"],
  ["product", "/products/titleist-pro-v1-golf-balls-p01155"],
  ["search", "/search?q=Pro+V1"],
];
const routeFilter = process.env.GOLFBALLS_FLOW_ROUTE?.split(",");
if (routeFilter?.some((name) => !routes.some(([route]) => route === name)))
  throw Error("Unknown flow route");
const variants = process.env.GOLFBALLS_LOCAL_URL
  ? ["candidate"]
  : ["deployed", "baseline", "candidate"];
if (process.env.GOLFBALLS_FLOW_VARIANT && !variants.includes(process.env.GOLFBALLS_FLOW_VARIANT))
  throw Error("Unknown flow variant");
const cases = variants.flatMap((variant) =>
  routes
    .filter(
      ([route]) =>
        (variant !== "deployed" || route === "home") &&
        (!routeFilter || routeFilter.includes(route)) &&
        (!process.env.GOLFBALLS_FLOW_VARIANT || variant === process.env.GOLFBALLS_FLOW_VARIANT),
    )
    .map(([route, path]) => ({ variant, route, path })),
);
if (!cases.length) throw Error("No flow cases selected");
await mkdir(output, { recursive: true });
const results = [];
let localExpected;
if (process.env.GOLFBALLS_LOCAL_URL) {
  const url = new URL(
    "/@fs" + fileURLToPath(new URL("../../dist/runtime.js", import.meta.url)),
    process.env.GOLFBALLS_VITE_ORIGIN ?? "http://localhost:5175",
  ).href;
  const response = await fetch(url);
  if (!response.ok) throw Error("Expected local Vite runtime is unavailable");
  localExpected = {
    url,
    sha256: createHash("sha256")
      .update(await response.text())
      .digest("hex"),
  };
}
const browser = await puppeteer.launch({
  headless: false,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  userDataDir: "/tmp/islands-mobile-baseline/profile",
});
try {
  for (const { variant, route, path } of cases) {
    const page = await browser.newPage();
    const row = {
      variant,
      route,
      errors: [],
      actions: [],
      localModuleResponses: [],
      overrides: [],
    };
    const moduleReads = [];
    page.on("response", (response) => {
      if (response.url().includes("/dist/runtime.js"))
        moduleReads.push(
          response
            .text()
            .then((body) =>
              row.localModuleResponses.push({
                url: response.url(),
                status: response.status(),
                bytes: body.length,
                sha256: createHash("sha256").update(body).digest("hex"),
              }),
            )
            .catch((error) => row.errors.push({ message: error.message })),
        );
    });
    page.on("pageerror", (e) => row.errors.push({ message: e.message, stack: e.stack }));
    let expected = localExpected;
    try {
      const cdp = await page.createCDPSession();
      await cdp.send("Network.clearBrowserCache");
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
      await page.setViewport({
        width: 412,
        height: 823,
        deviceScaleFactor: 1.75,
        isMobile: true,
        hasTouch: true,
      });
      if (variant !== "deployed" && !process.env.GOLFBALLS_LOCAL_URL) {
        const assets = join(root, variant, "assets");
        const metadata = readPreparedBuild(root, variant);
        expected = metadata.bootstrap;
        row.buildMetadata = metadata;
        const entry = expected.file;
        await page.setRequestInterception(true);
        page.on("request", async (request) => {
          try {
            const url = new URL(request.url());
            let file;
            if (/\/cdn\/shop\/t\/\d+\/assets\/theme\.[^/]+\.min\.js$/.test(url.pathname))
              file = entry;
            else if (
              url.pathname.includes("/cdn/shop/t/") &&
              url.pathname.includes("/assets/") &&
              /\.(js|css)$/.test(url.pathname)
            )
              file = basename(url.pathname);
            if (file) {
              let bytes;
              try {
                bytes = await readFile(join(assets, file));
              } catch {}
              if (bytes) {
                row.overrides.push({
                  served: file,
                  sha256: createHash("sha256").update(bytes).digest("hex"),
                });
                await request.respond({
                  status: 200,
                  contentType: file.endsWith(".css") ? "text/css" : "application/javascript",
                  headers: { "access-control-allow-origin": "*", "cache-control": "no-store" },
                  body: bytes,
                });
                return;
              }
            }
            await request.continue();
          } catch (e) {
            row.errors.push({ message: e.message });
            if (!request.isInterceptResolutionHandled()) await request.abort();
          }
        });
      }
      const response = await page.goto(
        (process.env.GOLFBALLS_LOCAL_URL ?? "https://golfballscom.myshopify.com") + path,
        { waitUntil: "domcontentloaded", timeout: 60000 },
      );
      row.status = response.status();
      row.environment = await page.evaluate(() => ({
        url: location.origin,
        theme: window.Shopify?.theme,
        scripts: [...document.scripts]
          .map((s) => s.src)
          .filter((s) => s.includes("5175") || s.includes("theme.")),
      }));
      if (row.status !== 200) throw Error(`HTTP ${row.status}`);
      await page.waitForFunction(() => customElements.get("cart-drawer"), { timeout: 20000 });
      const check = async (name, fn) => {
        try {
          await fn();
          row.actions.push({ name, pass: true });
        } catch (e) {
          process.exitCode = 1;
          row.actions.push({
            name,
            pass: false,
            error: e.message.split("\n")[0],
            state: await page.evaluate(() => ({
              cart: document.querySelector("cart-drawer")?.getAttribute("data-state"),
              search: document.querySelector("search-modal")?.getAttribute("data-active"),
            })),
          });
        }
      };
      if (process.env.GOLFBALLS_LOCAL_URL) {
        if (row.environment.theme?.role !== "development")
          throw Error("Expected Shopify development theme");
        await check("mobile-menu-open-close", async () => {
          await page.locator("[data-menu-trigger]").setTimeout(10000).click();
          await page.waitForSelector('mobile-menu[data-state="open"]', { timeout: 8000 });
          await page.locator("button[data-menu-close]").setTimeout(8000).click();
          await page.waitForFunction(
            () => !document.querySelector("mobile-menu")?.hasAttribute("data-state"),
            { timeout: 8000 },
          );
        });
        await check("search-open-close", async () => {
          await page.locator('a[data-trigger="search-modal"]').setTimeout(8000).click();
          await page.waitForSelector('search-modal[data-active="true"]', { timeout: 8000 });
          await page.locator("[data-search-modal-close]").setTimeout(8000).click();
          await page.waitForSelector('search-modal[data-active="false"]', { timeout: 8000 });
        });
      }
      await check("cart-open-close-repeat", async () => {
        for (let n = 0; n < 2; n++) {
          await page.locator("a[data-cart-drawer-trigger]").setTimeout(8000).click();
          await page.waitForSelector('cart-drawer[data-state="open"]', { timeout: 8000 });
          await page.locator("button[data-cart-drawer-close]").setTimeout(8000).click();
          await page.waitForFunction(
            () => !document.querySelector("cart-drawer")?.hasAttribute("data-state"),
            { timeout: 8000 },
          );
        }
      });
      if (route === "product")
        await check("quantity-stepper", async () => {
          const selector = "pdp-quantity-stepper input[data-qty-input]";
          await page.$eval("pdp-buy-box", (e) => e.scrollIntoView({ block: "center" }));
          await page.waitForSelector("pdp-quantity-stepper:defined", { timeout: 10000 });
          row.quantityControls = await page.$$eval(selector, (els) =>
            els.map((e) => ({ value: e.value, min: e.min, max: e.max })),
          );
          const before = await page.$eval(selector, (e) => Number(e.value));
          await page.locator("pdp-quantity-stepper [data-qty-increase]").setTimeout(8000).click();
          await page.waitForFunction(
            (s, v) => Number(document.querySelector(s).value) === v + 1,
            { timeout: 5000 },
            selector,
            before,
          );
          await page.locator("pdp-quantity-stepper [data-qty-decrease]").setTimeout(8000).click();
          await page.waitForFunction(
            (s, v) => Number(document.querySelector(s).value) === v,
            { timeout: 5000 },
            selector,
            before,
          );
        });
      if (route === "collection" || route === "search") {
        const tag = route === "collection" ? "collection-filters" : "search-filters";
        await check("filter-drawer-open-close", async () => {
          await page.waitForSelector(`${tag}:defined`, { timeout: 10000 });
          await page.locator(`${tag} [data-trigger="open-drawer"]`).setTimeout(8000).click();
          await page.waitForSelector(`${tag}[data-drawer-open="true"]`, { timeout: 5000 });
          await page.locator(`${tag} [data-trigger="close-drawer"]`).setTimeout(8000).click();
          await page.waitForFunction(
            (t) => !document.querySelector(t)?.hasAttribute("data-drawer-open"),
            { timeout: 5000 },
            tag,
          );
        });
        await check("desktop-sort-and-dynamic-results", async () => {
          await page.setViewport({
            width: 1440,
            height: 1000,
            deviceScaleFactor: 1,
            isMobile: false,
            hasTouch: false,
          });
          const selector = `${tag} [data-sort]`;
          const options = await page.$$eval(`${selector} option`, (els) =>
            els.map((e) => ({ value: e.value, selected: e.selected })),
          );
          const next = options.find((x) => x.value === "price-ascending");
          if (!next) throw Error("No alternative sort option");
          row.beforeSort = await page.$eval(`${tag} [data-results] l-product-card`, (e) => {
            window.__beforeSortCard = e;
            return e.innerText.slice(0, 120);
          });
          await page.select(selector, next.value);
          await page.waitForFunction(
            (v) => new URL(location.href).searchParams.get("sort_by") === v,
            { timeout: 20000 },
            next.value,
          );
          await page.waitForFunction(
            (t) =>
              document.querySelector(t)?.getAttribute("data-filter-state") === "ready" &&
              document.querySelectorAll(`${t} [data-results] l-product-card`).length > 0 &&
              !window.__beforeSortCard.isConnected &&
              document.querySelector(`${t} [data-sort]`).value === "price-ascending",
            { timeout: 20000 },
            tag,
          );
          row.sort = next.value;
          row.afterSort = await page.$eval(`${tag} [data-results] l-product-card`, (e) =>
            e.innerText.slice(0, 120),
          );
        });
      }
      await Promise.all(moduleReads);
      if (variant !== "deployed") {
        row.expectedProvenance = expected;
        assertFlowProvenance({
          mode: process.env.GOLFBALLS_LOCAL_URL ? "local" : "override",
          expected,
          row,
        });
        row.provenanceVerified = true;
      }
      await page.screenshot({ path: join(output, `${route}-${variant}.png`) });
    } catch (e) {
      row.fatal = e.message;
      process.exitCode = 1;
    } finally {
      results.push(row);
      await writeFile(join(output, "summary.json"), JSON.stringify(results, null, 2));
      console.log(JSON.stringify(row));
      await page.close();
    }
  }
} finally {
  await browser.close();
}
