import puppeteer from 'puppeteer';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const file='/tmp/golfballs-validation/local-dev/src/islands/MobileMenu.ts';
const original=await readFile(file,'utf8');
const b=await puppeteer.launch({headless:false,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',userDataDir:'/tmp/islands-mobile-baseline/profile'});
const report={origin:'http://127.0.0.1:9293',module:file,actions:[],messages:[],requests:[]};
try{
 const p=await b.newPage();await p.setViewport({width:412,height:823,deviceScaleFactor:1.75,isMobile:true,hasTouch:true});
 p.on('console',msg=>{if(msg.text().includes('[vite]'))report.messages.push(msg.text());});
 p.on('request',request=>{if(request.url().includes('MobileMenu.ts'))report.requests.push(request.url());});
 let navigations=0;p.on('framenavigated',frame=>{if(frame===p.mainFrame())navigations++;});
 const r=await p.goto(report.origin,{waitUntil:'domcontentloaded',timeout:60000});if(r.status()!==200)throw Error(`HTTP ${r.status()}`);
 report.theme=await p.evaluate(()=>window.Shopify?.theme);if(report.theme.role!=='development')throw Error('Expected development theme');
 const exercise=async()=>{
  await p.locator('[data-menu-trigger]').setTimeout(15000).click();
  await p.waitForSelector('mobile-menu[data-state="open"]',{timeout:10000});
  await p.locator('button[data-menu-close]').setTimeout(10000).click();
  await p.waitForFunction(()=>!document.querySelector('mobile-menu')?.hasAttribute('data-state'),{timeout:10000});
  await p.locator('a[data-trigger="search-modal"]').setTimeout(10000).click();
  await p.waitForSelector('search-modal[data-active="true"]',{timeout:10000});
  await p.locator('[data-search-modal-close]').setTimeout(10000).click();
  await p.waitForSelector('search-modal[data-active="false"]',{timeout:10000});
 };
 await exercise();report.actions.push('menu/search passed before edit');
 const before=navigations;
 const beforeRequests=report.requests.length;
 const beforeMessages=report.messages.length;
 await writeFile(file,original+'\n// local-validation-hmr-probe\n');
 const deadline=Date.now()+20000;
 while((report.requests.length===beforeRequests||!report.messages.slice(beforeMessages).some(m=>m.includes('hot updated:')&&m.includes('vite-plugin-shopify-theme-islands/revive')))&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,100));
 if(report.requests.length===beforeRequests||!report.messages.slice(beforeMessages).some(m=>m.includes('hot updated:')&&m.includes('vite-plugin-shopify-theme-islands/revive')))throw Error('Vite did not hot-update the Island runtime after the edit');
 await exercise();report.actions.push('menu/search passed after Vite hot update');
 report.reloads=navigations-before;report.pass=true;
}catch(error){report.error=error.message;report.pass=false;process.exitCode=1;}
finally{
 await writeFile(file,original);
 await mkdir('/tmp/golfballs-local-hmr',{recursive:true});await writeFile('/tmp/golfballs-local-hmr/summary.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));await b.close();
}
