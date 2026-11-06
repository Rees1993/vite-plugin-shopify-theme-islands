import puppeteer from 'puppeteer';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const origin = 'http://127.0.0.1:9293';
const runtimeUrl = 'http://localhost:5175/@fs' + fileURLToPath(new URL('../../dist/runtime.js', import.meta.url));
const preflight = await fetch(runtimeUrl);
if (preflight.status !== 200) throw Error('Local runtime preflight failed');
const expectedHash = createHash('sha256').update(await preflight.text()).digest('hex');
const browser = await puppeteer.launch({ headless: false, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', userDataDir: '/tmp/islands-mobile-baseline/profile' });
const report = { origin, runtimeUrl, expectedHash, errors: [], results: [] };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 412, height: 823, isMobile: true, hasTouch: true });
  const cdp = await page.createCDPSession();
  await cdp.send('Network.clearBrowserCache');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  page.on('pageerror', error => report.errors.push(error.message));
  report.navigationAttempts = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const response = await page.goto(origin + '/collections/golf-balls', { waitUntil: 'networkidle2', timeout: 60000 });
    report.status = response.status();
    report.navigationAttempts.push({ attempt, status: report.status });
    if (report.status !== 500) break;
  }
  report.theme = await page.evaluate(() => window.Shopify?.theme);
  if (report.status !== 200 || report.theme?.role !== 'development') throw Error('Expected actual development theme');
  const runtimeResponse = await page.evaluate(async url => {
    const response = await fetch(url, { cache: 'no-store' });
    return { status: response.status, body: await response.text() };
  }, runtimeUrl);
  report.runtimeStatus = runtimeResponse.status;
  report.runtimeHash = createHash('sha256').update(runtimeResponse.body).digest('hex');
  if (report.runtimeStatus !== 200 || report.runtimeHash !== expectedHash) throw Error('Runtime fingerprint mismatch');
  report.results = await page.evaluate(async url => {
    const { revive } = await import(url);
    const results = [];
    for (const action of ['retain', 'exclude', 'detach', 'disconnect']) {
      const parentTag = `dev-cascade-parent-${action}`;
      const childTag = `dev-cascade-child-${action}`;
      const excludedTag = `dev-cascade-excluded-${action}`;
      const host = document.createElement('section');
      host.innerHTML = `<${parentTag}><section data-probe-child><${childTag}></${childTag}></section><${excludedTag}></${excludedTag}></${parentTag}>`;
      document.body.append(host);
      let finish;
      let childLoads = 0;
      let excludedLoads = 0;
      const runtime = revive({ islands: {
        [`/${parentTag}.ts`]: async () => { await new Promise(resolve => { finish = resolve; }); customElements.define(parentTag, class extends HTMLElement {}); },
        [`/${childTag}.ts`]: async () => { childLoads++; customElements.define(childTag, class extends HTMLElement {}); },
        [`/${excludedTag}.ts`]: async () => { excludedLoads++; customElements.define(excludedTag, class extends HTMLElement {}); },
      } });
      try {
        const deadline = performance.now() + 5000;
        while (!finish && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
        if (!finish) throw Error('Parent import did not start');
        const child = host.querySelector('[data-probe-child]');
        runtime.observe(child);
        runtime.unobserve(host);
        const before = childLoads;
        if (action === 'exclude') runtime.unobserve(child);
        else if (action === 'detach') child.remove();
        else if (action === 'disconnect') runtime.disconnect();
        finish();
        await new Promise(resolve => setTimeout(resolve, 100));
        const expected = action === 'retain' ? 1 : 0;
        results.push({ action, before, childLoads, excludedLoads, registered: !!customElements.get(childTag), pass: before === 0 && childLoads === expected && excludedLoads === 0 && !!customElements.get(childTag) === (expected === 1) });
      } finally { runtime.disconnect(); host.remove(); }
    }
    return results;
  }, runtimeUrl);
  report.pass = report.results.length === 4 && report.results.every(result => result.pass) && report.errors.length === 0;
  if (!report.pass) process.exitCode = 1;
} catch (error) {
  report.pass = false;
  report.error = error.message;
  process.exitCode = 1;
} finally {
  await mkdir('/tmp/islands-included-child-dev', { recursive: true });
  await writeFile('/tmp/islands-included-child-dev/report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await browser.close();
}
