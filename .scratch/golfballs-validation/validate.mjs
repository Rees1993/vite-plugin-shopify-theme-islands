// Browser-only overrides on real Golfballs pages. Does not deploy or modify the theme.
import puppeteer from 'puppeteer';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,basename,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=process.env.GOLFBALLS_BUILD_ROOT ?? '/tmp/golfballs-validation';
const output=resolve(process.env.GOLFBALLS_REPORT_ROOT ?? '/tmp/golfballs-live-validation');
const rounds=Number(process.env.GOLFBALLS_ROUNDS ?? 3);
const origin='https://golfballscom.myshopify.com';
const routes=[['home','/'],['collection','/collections/golf-balls'],['product','/products/titleist-pro-v1-golf-balls-p01155'],['search','/search?q=Pro+V1']];
const builds={};
for(const variant of ['baseline','candidate']) {
 const assets=join(root,variant,'assets');
 const manifest=JSON.parse(await readFile(join(assets,'.vite/manifest.json'),'utf8'));
 const entry=manifest['src/entrypoints/theme.ts'];
 if(!entry)throw Error('Missing theme bootstrap');
 const bytes=await readFile(join(assets,entry.file));
 builds[variant]={assets,entry:entry.file,sha256:createHash('sha256').update(bytes).digest('hex')};
}
await mkdir(output,{recursive:true});
const report={capturedAt:new Date().toISOString(),pluginCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),baselineCommit:'50331f0',themeCommit:execFileSync('git',['-C','/Users/alexrees/Documents/Lazer/Golfballs/golfballs-theme','rev-parse','HEAD'],{encoding:'utf8'}).trim(),builds,methodology:'Real authenticated storefront HTML/data; browser-only replacement of theme bootstrap and generated JS/CSS chunks from isolated matching Golfballs builds. Identical instrumentation wraps public revive() synchronously; no source/deployment change. Mobile 412x823, 4x CPU, network unthrottled, cold browser cache per navigation; alternating variants across three rounds. LCP/CLS observed over a fixed 5s post-DCL window, not field metrics. Interaction checks run after timing collection.',samples:[]};
const browser=await puppeteer.launch({headless:false,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',userDataDir:'/tmp/islands-mobile-baseline/profile'});
try {
 report.browserVersion=await browser.version();
 for(let round=1;round<=rounds;round++)for(const [route,path]of routes)for(const variant of round%2?['baseline','candidate']:['candidate','baseline']) {
  const page=await browser.newPage();
  const sample={round,route,variant,errors:[],failedRequests:[],overrides:[],actions:[]};
  try {
   const cdp=await page.createCDPSession();
   await cdp.send('Network.clearBrowserCache');
   await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
   await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
   await page.setViewport({width:412,height:823,deviceScaleFactor:1.75,isMobile:true,hasTouch:true});
   await page.evaluateOnNewDocument(()=>{
    const state={loads:[],errors:[],defined:[],lcp:0,cls:0,longTasks:[]};window.__golfballsPage=state;
    document.addEventListener('islands:load',e=>state.loads.push({tag:e.detail?.tagName,ms:performance.now()}));
    document.addEventListener('islands:error',e=>state.errors.push({tag:e.detail?.tagName,message:String(e.detail?.error?.message ?? e.detail?.error ?? 'unknown')}));
    const define=customElements.define.bind(customElements);
    customElements.define=(name,...args)=>{const result=define(name,...args);state.defined.push({name,ms:performance.now()});return result;};
    new PerformanceObserver(list=>{for(const e of list.getEntries())state.lcp=e.startTime;}).observe({type:'largest-contentful-paint',buffered:true});
    new PerformanceObserver(list=>{for(const e of list.getEntries())if(!e.hadRecentInput)state.cls+=e.value;}).observe({type:'layout-shift',buffered:true});
    new PerformanceObserver(list=>{for(const e of list.getEntries())state.longTasks.push({start:e.startTime,duration:e.duration});}).observe({type:'longtask',buffered:true});
   });
   page.on('pageerror',error=>sample.errors.push(error.message));
   page.on('requestfailed',request=>sample.failedRequests.push({path:new URL(request.url()).pathname,error:request.failure()?.errorText}));
   await page.setRequestInterception(true);
   page.on('request',async request=>{
    try {
     const url=new URL(request.url());const name=basename(url.pathname);const build=builds[variant];
     let file;
     if(/\/cdn\/shop\/t\/\d+\/assets\/theme\.[^/]+\.min\.js$/.test(url.pathname))file=build.entry;
     else if(url.pathname.includes('/cdn/shop/t/')&&url.pathname.includes('/assets/')&&/\.(js|css)$/.test(name))file=name;
     if(file){let bytes;try{bytes=await readFile(join(build.assets,file));}catch{}
      if(bytes){sample.overrides.push({requested:name,served:file,sha256:createHash('sha256').update(bytes).digest('hex')});await request.respond({status:200,contentType:file.endsWith('.css')?'text/css':'application/javascript',headers:{'access-control-allow-origin':'*','cache-control':'no-store'},body:bytes});return;}}
     await request.continue();
    }catch(error){sample.errors.push(`Override: ${error.message}`);if(!request.isInterceptResolutionHandled())await request.abort();}
   });
   const response=await page.goto(origin+path,{waitUntil:'domcontentloaded',timeout:60000});
   sample.status=response.status();if(sample.status!==200)throw Error(`HTTP ${sample.status}`);sample.path=new URL(page.url()).pathname;
   await page.waitForFunction(()=>window.__golfballsValidation,{timeout:15000});
   await new Promise(resolve=>setTimeout(resolve,5000));
   Object.assign(sample,await page.evaluate(()=>({title:document.title,theme:window.Shopify?.theme,consent:window.Shopify?.customerPrivacy?.currentVisitorConsent?.()??null,runtime:window.__golfballsValidation,metrics:window.__golfballsPage,navigation:performance.getEntriesByType('navigation').map(n=>({dclMs:n.domContentLoadedEventEnd,loadMs:n.loadEventEnd})),islands:[...document.querySelectorAll('*')].filter(e=>e.tagName.includes('-')).map(e=>({tag:e.tagName.toLowerCase(),defined:e.matches(':defined')})).reduce((a,e)=>{const item=a[e.tag]??={count:0,defined:0};item.count++;if(e.defined)item.defined++;return a;},{})})));
   if(!sample.overrides.some(x=>x.served===builds[variant].entry))throw Error('Candidate bootstrap not served');
   const check=async(name,fn)=>{try{await fn();sample.actions.push({name,pass:true});}catch(error){process.exitCode=1;sample.actions.push({name,pass:false,reason:error.message.split('\n')[0]});}};
   if(round===1){
    await check('mobile-menu',async()=>{
     await page.locator('[data-menu-trigger]').setTimeout(5000).click();
     await page.waitForSelector('mobile-menu[data-state="open"]',{timeout:4000});
     await page.locator('button[data-menu-close]').setTimeout(4000).click();
     await page.waitForFunction(()=>!document.querySelector('mobile-menu')?.hasAttribute('data-state'),{timeout:4000});
    });
    await check('search-modal',async()=>{
     await page.locator('a[data-trigger="search-modal"]').setTimeout(4000).click();
     await page.waitForSelector('search-modal[data-active="true"]',{timeout:4000});
     await page.locator('[data-search-modal-close]').setTimeout(4000).click();
     await page.waitForSelector('search-modal[data-active="false"]',{timeout:4000});
    });
    await check('cart-drawer',async()=>{
     await page.locator('a[data-cart-drawer-trigger]').setTimeout(4000).click();
     await page.waitForSelector('cart-drawer[data-state="open"]',{timeout:4000});
     await page.locator('button[data-cart-drawer-close]').setTimeout(4000).click();
     await page.waitForFunction(()=>!document.querySelector('cart-drawer')?.hasAttribute('data-state'),{timeout:4000});
    });
    await page.screenshot({path:join(output,`${route}-${variant}.png`)});
   }
   sample.afterActions=await page.evaluate(()=>({errors:window.__golfballsPage.errors,defined:window.__golfballsPage.defined}));
   if(sample.metrics.errors.length||sample.afterActions.errors.length)throw Error('Runtime error events reported');
  }catch(error){sample.fatal=error.message;process.exitCode=1;}
  finally{report.samples.push(sample);await writeFile(join(output,'summary.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({round,route,variant,status:sample.status,setupMs:sample.runtime?.setupMs,fatal:sample.fatal,actions:sample.actions,errors:sample.errors}));await page.close();}
 }
}finally{await browser.close();}
