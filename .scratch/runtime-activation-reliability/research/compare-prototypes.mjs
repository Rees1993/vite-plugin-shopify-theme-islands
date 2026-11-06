// Research-only native benchmark. PROTOTYPES is a JSON map of label -> isolated source root.
import { createHash } from 'node:crypto';
import puppeteer from 'puppeteer';
import { validateNativeReport } from '../../../scripts/validate-native-report.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const temporary = await mkdtemp(join(tmpdir(), 'islands-design-comparison-'));
const reference = process.env.REFERENCE_REF ?? '77856c7';
const artifacts = resolve(process.env.RESEARCH_ARTIFACT_ROOT ?? '/tmp/islands-design-comparison');
const prototypes = JSON.parse(process.env.PROTOTYPES ?? '{}');
if (Object.hasOwn(prototypes, 'current')) throw new Error('current is the reserved reference label');
const variants = { current: join(temporary, 'current'), ...prototypes };
for (const [label, root] of Object.entries(variants)) {
  if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(label) || typeof root !== 'string') throw new Error('Invalid prototype label/root');
}
await mkdir(variants.current);
const archive = execFileSync('git', ['-C', repo, 'archive', reference, 'src']);
execFileSync('tar', ['-xf', '-', '-C', variants.current], { input: archive });
if (process.env.PROTOTYPE_PATCH) {
  if (variants.patched) throw new Error('patched is reserved when using PROTOTYPE_PATCH');
  variants.patched = join(temporary, 'patched');
  await mkdir(variants.patched);
  execFileSync('tar', ['-xf', '-', '-C', variants.patched], { input: archive });
  execFileSync('patch', ['--batch', '-p1', '-d', variants.patched, '-i', resolve(process.env.PROTOTYPE_PATCH)], { stdio: 'pipe' });
}
const bundles = {};
for (const [label, root] of Object.entries(variants)) {
  const output = join(temporary, label + '.js');
  execFileSync('bun', ['build', join(root, 'src/runtime.ts'), '--outfile', output, '--target', 'browser', '--format', 'esm'], { stdio: 'pipe' });
  bundles[label] = await readFile(output);
}
const server = createServer(async (request, response) => {
  if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return; }
  const native = request.url.split('?')[0].match(/^\/native\/([a-zA-Z][a-zA-Z0-9-]*)\/(native-recovery\.html|native-policy\.html|runtime(?:-debug)?\.js)$/);
  if (native && bundles[native[1]]) {
    const javascript = native[2].endsWith('.js');
    response.setHeader('Content-Type', javascript ? 'application/javascript' : 'text/html');
    if (native[2] === 'runtime-debug.js') response.end(`import { revive as execute } from '/${native[1]}.js'; export const revive = payload => execute({...payload, options:{...payload.options, debug:true}});`);
    else if (native[2] === 'runtime.js') response.end(bundles[native[1]]);
    else {
      let html = await readFile(join(repo, 'tests/native/fixtures', native[2]), 'utf8');
      if (request.url.includes('?debug=1')) html = html.replaceAll('./runtime.js', './runtime-debug.js');
      response.end(html);
    }
    return;
  }
  if (request.url === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Runtime design comparison</title><body></body>'); return; }
  const label = request.url.slice(1, -3);
  if (!bundles[label]) { response.writeHead(404); response.end(); return; }
  response.setHeader('Content-Type', 'application/javascript'); response.end(bundles[label]);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

let browser;
try {
  browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => errors.push(`Request failed: ${request.url()}`));
  page.on('response', response => { if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
  const client = await page.createCDPSession();
  const data = {
    capturedAt: new Date().toISOString(), browserVersion: await browser.version(),
    referenceCommit: execFileSync('git', ['-C', repo, 'rev-parse', reference], { encoding: 'utf8' }).trim(),
    bundleSha256: Object.fromEntries(Object.entries(bundles).map(([label, bytes]) => [label, createHash('sha256').update(bytes).digest('hex')])),
    methodology: 'One native Chrome process; rotating variant order; five warm-up rounds then 40 samples per variant/scenario at normal CPU and 4x CPU throttling. No network or element registrations. Startup excludes DOM construction. Mutation timings include DOM mutation plus two microtask checkpoints. Synthetic repeated warm runtime measurements, not storefront page performance.',
    samples: [], nativeChecks: [],
    prototypePatchSha256: process.env.PROTOTYPE_PATCH ? createHash('sha256').update(await readFile(resolve(process.env.PROTOTYPE_PATCH))).digest('hex') : undefined,
  };
  if (process.env.NATIVE_ONLY === 'true') {
    data.methodology = 'Real native Chrome customElements/MutationObserver fixtures; each variant runs with debug disabled and enabled. No timing measurements in this mode.';
    for (const label of Object.keys(variants)) for (const debug of [false, true]) for (const fixture of ['native-recovery.html', 'native-policy.html']) {
      await page.goto(`http://127.0.0.1:${server.address().port}/native/${label}/${fixture}${debug ? "?debug=1" : ""}`, { waitUntil: 'load' });
      await page.waitForSelector('#results', { timeout: 30000 });
      const checks = JSON.parse(await page.$eval('#results', element => element.textContent));
      data.nativeChecks.push({ label, fixture, debug, results: checks, errors: [...errors] });
    }
  }
  if (process.env.NATIVE_ONLY !== 'true') for (const cpuRate of [1, 4]) {
    await client.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
    const rows = await page.evaluate(async ({ labels, cpuRate }) => {
      const modules = {};
      for (const label of labels) modules[label] = await import('/' + label + '.js');
      const result = [];
      const scenarios = ['setup-interaction-1000', 'setup-nested-interaction-1000', 'scan-nested-after-exclusion-1000', 'setup-visible-1000', 'setup-visible-unique-100', 'owner-removal-1000', 'parked-removal-1000', 'exclude-parent-1000', 'disconnect-1000'];
      for (const scenario of scenarios) {
        const unique = scenario === 'setup-visible-unique-100';
        const count = unique ? 100 : 1000;
        const interaction = scenario.includes('interaction') || scenario === 'scan-nested-after-exclusion-1000' || scenario === 'disconnect-1000';
        const gate = interaction ? 'interaction' : 'visible';
        const islands = {};
        const elements = Array.from({ length: count }, (_, index) => {
          const tag = unique ? 'research-island-' + index : 'research-island';
          islands['/' + tag + '.ts'] = async () => {};
          return `<${tag} client:${gate} style="display:none"></${tag}>`;
        });
        let html = scenario === 'exclude-parent-1000'
          ? `<section id="outer">${elements.slice(0, 500).join('')}<section id="inner">${elements.slice(500).join('')}</section></section>`
          : elements.join('');
        if (scenario.includes('nested')) html = '<div>'.repeat(6) + html + '</div>'.repeat(6);
        for (let round = -5; round < 40; round++) {
          const order = labels.map((_, index) => labels[(index + round + 5) % labels.length]);
          for (const label of order) {
            document.body.innerHTML = html;
            let runtime;
            let startedAt;
            let elapsedMs;
            if (scenario === 'scan-nested-after-exclusion-1000') {
              document.body.innerHTML = '<section id="excluded"></section><section id="scan-root"></section>';
              runtime = modules[label].revive({ islands });
              runtime.unobserve(document.getElementById('excluded'));
              const scanRoot = document.getElementById('scan-root');
              scanRoot.innerHTML = html;
              startedAt = performance.now(); runtime.scan(scanRoot); elapsedMs = performance.now() - startedAt;
            } else if (scenario.startsWith('setup-')) {
              startedAt = performance.now(); runtime = modules[label].revive({ islands }); elapsedMs = performance.now() - startedAt;
            } else {
              runtime = modules[label].revive({ islands });
              await Promise.resolve();
              const targets = [...document.querySelectorAll('research-island')];
              if (scenario === 'exclude-parent-1000') runtime.observe(document.getElementById('inner'));
              startedAt = performance.now();
              if (scenario === 'owner-removal-1000') targets[0].remove();
              else if (scenario === 'parked-removal-1000') for (const element of targets.slice(500)) element.remove();
              else if (scenario === 'exclude-parent-1000') runtime.unobserve(document.getElementById('outer'));
              else runtime.disconnect();
              if (scenario === 'owner-removal-1000' || scenario === 'parked-removal-1000') { await Promise.resolve(); await Promise.resolve(); }
              elapsedMs = performance.now() - startedAt;
            }
            await Promise.resolve(); runtime.disconnect(); await Promise.resolve();
            if (round >= 0) result.push({ scenario, cpuRate, label, sample: round + 1, elapsedMs });
          }
          await new Promise(resolve => requestAnimationFrame(resolve));
        }
      }
      return result;
    }, { labels: Object.keys(variants), cpuRate });
    data.samples.push(...rows);
  }
  data.summary = [];
  for (const cpuRate of [1, 4]) for (const scenario of [...new Set(data.samples.map(row => row.scenario))]) for (const label of Object.keys(variants)) {
    const values = data.samples.filter(row => row.cpuRate === cpuRate && row.scenario === scenario && row.label === label).map(row => row.elapsedMs).sort((a, b) => a - b);
    if (!values.length) continue;
    data.summary.push({ cpuRate, scenario, label, medianMs: (values[19] + values[20]) / 2, p90Ms: values[35], rangeMs: [values[0], values[39]] });
  }
  await mkdir(artifacts, { recursive: true });
  await writeFile(join(artifacts, 'summary.json'), JSON.stringify(data, null, 2));
  for (const row of data.summary) console.log(JSON.stringify(row));
  for (const check of data.nativeChecks) console.log(JSON.stringify({ label: check.label, fixture: check.fixture, debug: check.debug, passed: check.results.filter(result => result.pass).length, total: check.results.length }));
  if (errors.length) throw new Error(errors.join('\n'));
  for (const check of data.nativeChecks) validateNativeReport(check);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
