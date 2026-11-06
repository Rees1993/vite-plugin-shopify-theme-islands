import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
const repo=resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const root=await mkdtemp(join(tmpdir(), 'islands-setup-comparison-'));
const outputRoot=resolve(process.env.RUNTIME_ARTIFACT_ROOT ?? '/tmp/islands-runtime-comparison');
const baselineRef=process.env.BASELINE_REF ?? 'af71a36d58fa21163dd9f5637a7a069132ef93d8';
await mkdir(root+'/baseline');
const archive=execFileSync('git',['-C',repo,'archive',baselineRef,'src']);
execFileSync('tar',['-xf','-','-C',root+'/baseline'],{input:archive});
const themeRoot=process.env.THEME_ROOT ?? '/Users/alexrees/Documents/Lazer/Golfballs/golfballs-theme';
const require=createRequire(join(themeRoot, 'package.json'));
const puppeteer=require('puppeteer');
const variants={baseline:root+'/baseline',candidate:repo};
for(const [label,path] of Object.entries(variants)) execFileSync('bun',['build',path+'/src/runtime.ts','--outfile',root+'/'+label+'.js','--target','browser','--format','esm'],{stdio:'pipe'});
const server=createServer(async(req,res)=>{if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Runtime cost comparison</title><body></body>');return;} const label=req.url.slice(1,-3);if(!variants[label]){res.writeHead(404);res.end();return;}res.setHeader('Content-Type','application/javascript');res.end(await readFile(root+'/'+label+'.js'));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port+'/');
 const client=await page.createCDPSession();
 const output={capturedAt:new Date().toISOString(),browser:await browser.version(),methodology:'One browser; rotating variant order; five warm-up rounds then 30 samples per variant and fixture; synchronous revive setup; no listener-count instrumentation; synthetic, not page speed',results:[]};
 for(const cpuRate of [1,4]){
  await client.send('Emulation.setCPUThrottlingRate',{rate:cpuRate});
  const samples=await page.evaluate(async({labels,cpuRate})=>{
   const modules={};for(const label of labels)modules[label]=await import('/'+label+'.js');
   const rows=[];
   for(const fixture of [{count:100,gate:'interaction'},{count:1000,gate:'interaction'},{count:1000,gate:'visible'}]){
    const html=Array(fixture.count).fill(`<cost-island client:${fixture.gate} style="display:none"></cost-island>`).join('');
    for(let round=-5;round<30;round++){
     const order=labels.map((_,i)=>labels[(i+round+5)%labels.length]);
     for(const label of order){
      document.body.innerHTML=html;
      const start=performance.now();const runtime=modules[label].revive({islands:{'/cost-island.ts':async()=>{}}});const setupMs=performance.now()-start;
      await Promise.resolve();runtime.disconnect();await Promise.resolve();
      if(round>=0)rows.push({label,cpuRate,...fixture,sample:round+1,setupMs});
     }
     await new Promise(resolve=>requestAnimationFrame(resolve));
    }
   }
   return rows;
  },{labels:Object.keys(variants),cpuRate});output.results.push(...samples);
 }
 output.baselineCommit=execFileSync('git',['-C',repo,'rev-parse',baselineRef],{encoding:'utf8'}).trim();
 output.candidateHead=execFileSync('git',['-C',repo,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
 output.candidateSourceChanges=execFileSync('git',['-C',repo,'diff','--name-only','HEAD','--','src/'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
 output.runtimeBundleSha256={};
 for(const label of Object.keys(variants))output.runtimeBundleSha256[label]=createHash('sha256').update(await readFile(root+'/'+label+'.js')).digest('hex');
 await mkdir(outputRoot,{recursive:true});
 await writeFile(join(outputRoot,'summary.json'),JSON.stringify(output,null,2));
 for(const cpuRate of [1,4])for(const gate of ['interaction','visible'])for(const count of [100,1000])for(const label of Object.keys(variants)){
  const values=output.results.filter(r=>r.cpuRate===cpuRate&&r.gate===gate&&r.count===count&&r.label===label).map(r=>r.setupMs).sort((a,b)=>a-b);if(!values.length)continue;
  console.log(JSON.stringify({cpuRate,gate,count,label,medianMs:+((values[14]+values[15])/2).toFixed(2),p90Ms:+values[26].toFixed(2),rangeMs:[values[0],values[29]]}));
 }
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
