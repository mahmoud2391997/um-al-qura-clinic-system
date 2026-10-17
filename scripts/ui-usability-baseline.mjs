// Measure a disposable local demo; never points at the production clinic.
import {chromium,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const base=process.argv[2]||'http://127.0.0.1:4317';
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Local synthetic instance required');
const output=resolve(process.env.CLINIC_UI_ARTIFACTS||'.local/usability-baseline');mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}),results=[];
try{
 for(const width of [1366,390])for(const role of ['owner','reception','finance','physio']){
  const context=await browser.newContext({viewport:{width,height:900}});
  const login=await context.request.post(base+'/api/demo',{headers:{Origin:base},data:{role}});if(!login.ok())throw Error('Demo fixture login failed');
  const page=await context.newPage();page.setDefaultTimeout(15000);await page.goto(base);await expect(page.locator('.dashboardmetrics')).toBeVisible();
  const geometry=await page.locator('.dashboard').evaluate(el=>({firstContentTop:Math.round(el.getBoundingClientRect().top),pageWidth:document.documentElement.scrollWidth,viewport:innerWidth}));
  const menu=page.getByRole('button',{name:'القائمة',exact:true});if(width===390&&await menu.count())await menu.click();
  const expand=page.getByRole('button',{name:'فتح كل الأقسام',exact:true});if(await expand.count())await expand.click();
  const menus=await page.locator('#sidebar-navigation').evaluate(el=>({groups:el.querySelectorAll(':scope > .navgroup').length,topLevel:el.children.length,leaves:el.querySelectorAll('.subnav button').length,labels:[...el.querySelectorAll('.subnav button')].map(b=>b.textContent.trim())}));
  const entry={width,role,...geometry,...menus};
  await page.screenshot({path:resolve(output,role+'-'+width+'.png'),fullPage:true});
  if(width===390&&await menu.count())await page.getByRole('button',{name:'إغلاق القائمة',exact:true}).click();
  if(role==='reception'){
   await page.getByRole('button',{name:'حجز موعد',exact:false}).click();await expect(page.locator('form')).toBeVisible();
   entry.appointmentForm=await page.locator('form').evaluate(el=>({visibleFields:[...el.querySelectorAll('input,select,textarea')].filter(x=>x.getClientRects().length).map(x=>({label:x.closest('label')?.textContent.trim(),required:x.required})),formTop:Math.round(el.getBoundingClientRect().top),documentHeight:document.documentElement.scrollHeight}));
   await page.screenshot({path:resolve(output,'appointment-'+width+'.png'),fullPage:true});
  }
  results.push(entry);await context.close();
 }
 writeFileSync(resolve(output,'measurements.json'),JSON.stringify({date:new Date().toISOString(),source:'local synthetic demo; no real staff timing',results},null,2));console.log(JSON.stringify(results.map(({labels,...r})=>r),null,2));
}finally{await browser.close()}
