import puppeteer from 'puppeteer';
import {writeFile} from 'node:fs/promises';
const browser=await puppeteer.launch({headless:false,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',userDataDir:'/tmp/islands-mobile-baseline/profile'});
const result={origin:'http://127.0.0.1:9293'};
try{
 const page=await browser.newPage();await page.setViewport({width:412,height:823,deviceScaleFactor:1.75,isMobile:true,hasTouch:true});
 const response=await page.goto(result.origin,{waitUntil:'domcontentloaded',timeout:60000});if(response.status()!==200)throw Error(`HTTP ${response.status()}`);
 await page.waitForSelector('mobile-menu:defined',{timeout:15000});
 const inspect=()=>page.evaluate(()=>[...document.querySelectorAll('accordion-rows')].map((el,index)=>({index,directives:[...el.attributes].filter(a=>a.name.startsWith('client:')).map(a=>[a.name,a.value]),defined:el.matches(':defined'),region:el.closest('header,footer,nav,main')?.tagName,top:Math.round(el.getBoundingClientRect().top),labels:[...el.querySelectorAll('summary')].slice(0,3).map(s=>s.textContent?.trim())})));
 result.initial=await inspect();
 await page.locator('[data-menu-trigger]').setTimeout(10000).click();await page.waitForSelector('mobile-menu[data-state="open"]',{timeout:5000});
 result.menuOpen=await inspect();
 await page.locator('button[data-menu-close]').setTimeout(10000).click();
 await page.$eval('footer',el=>el.scrollIntoView());
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 result.footerVisible=await inspect();
 result.footerScrollY=await page.evaluate(()=>scrollY);
 await page.$eval('main accordion-rows',el=>el.scrollIntoView({block:'center'}));
 await page.waitForSelector('accordion-rows:defined',{timeout:10000});
 result.faqVisible=await inspect();
}catch(error){result.error=error.message;process.exitCode=1;}
finally{await writeFile('/tmp/golfballs-next-gate.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));await browser.close();}
