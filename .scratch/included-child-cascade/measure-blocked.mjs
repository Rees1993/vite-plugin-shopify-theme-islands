import puppeteer from 'puppeteer';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const reference = '/tmp/islands-parent-reference';
const temporary = await mkdtemp(join(tmpdir(), 'islands-blocked-timing-'));
const bundles = {};
for (const [label, root] of Object.entries({ reference, candidate: repo })) {
  const output = join(temporary, label + '.js');
  execFileSync('bun', ['build', join(root, 'src/runtime.ts'), '--outfile', output, '--target', 'browser', '--format', 'esm'], { stdio: 'pipe' });
  bundles[label] = await readFile(output);
}
const server = createServer((request, response) => {
  if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return; }
  const bundle = bundles[request.url.slice(1, -3)];
  response.setHeader('Content-Type', bundle ? 'application/javascript' : 'text/html');
  response.end(bundle ?? '<!doctype html><title>Blocked child timings</title><body></body>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await puppeteer.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const client = await page.createCDPSession();
  const report = {
    capturedAt: new Date().toISOString(), reference: execFileSync('git', ['-C', reference, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    browser: await browser.version(), hashes: Object.fromEntries(Object.entries(bundles).map(([label, bytes]) => [label, createHash('sha256').update(bytes).digest('hex')])),
    methodology: 'Synthetic 1000 repeated child Islands behind one unresolved Island import. 5 warmups then 40 samples, alternating variant order, CPU1/4. DOM construction excluded. Setup synchronous; settlement drains 12 microtasks; mutation drains two checkpoints after adding an unrelated span. No custom element registration, network or debug diagnostics. Timings informational.', samples: [], errors,
  };
  for (const cpuRate of [1, 4]) {
    await client.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
    report.samples.push(...await page.evaluate(async cpuRate => {
      const modules = { reference: await import('/reference.js'), candidate: await import('/candidate.js') };
      const samples = [];
      const html = '<timing-parent>' + '<timing-child></timing-child>'.repeat(1000) + '</timing-parent>';
      for (let round = -5; round < 40; round++) {
        const labels = round % 2 ? ['reference', 'candidate'] : ['candidate', 'reference'];
        for (const label of labels) {
          document.body.innerHTML = html;
          let finish;
          let childLoads = 0;
          const start = performance.now();
          const runtime = modules[label].revive({ islands: {
            '/timing-parent.ts': () => new Promise(resolve => { finish = resolve; }),
            '/timing-child.ts': async () => { childLoads++; },
          } });
          const setup = performance.now() - start;
          const mutationStart = performance.now();
          document.body.append(document.createElement('span'));
          await Promise.resolve(); await Promise.resolve();
          const mutation = performance.now() - mutationStart;
          const settleStart = performance.now();
          finish();
          for (let i = 0; i < 12; i++) await Promise.resolve();
          const settlement = performance.now() - settleStart;
          if (childLoads !== 1) throw Error('Invalid timing scenario: shared child loader did not run once');
          runtime.disconnect(); await Promise.resolve();
          if (round >= 0) samples.push({ cpuRate, label, sample: round + 1, setup, mutation, settlement });
        }
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      return samples;
    }, cpuRate));
  }
  report.summary = [];
  for (const cpuRate of [1, 4]) for (const metric of ['setup', 'mutation', 'settlement']) for (const label of ['reference', 'candidate']) {
    const values = report.samples.filter(row => row.cpuRate === cpuRate && row.label === label).map(row => row[metric]).sort((a, b) => a - b);
    report.summary.push({ cpuRate, metric, label, median: (values[19] + values[20]) / 2, p90: values[35], range: [values[0], values[39]] });
  }
  await mkdir('/tmp/islands-blocked-timing', { recursive: true });
  await writeFile('/tmp/islands-blocked-timing/report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.summary));
  if (errors.length) throw Error(errors.join('\n'));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
