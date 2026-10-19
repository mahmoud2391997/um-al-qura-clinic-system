import {translateLabel as translate} from '../lib/ui-translations.js';
// Disposable local demo only; never runs against production or real patient data.
import {chromium,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {defaultRoles} from '../lib/permissions.js';
const base=process.argv[2]||'http://127.0.0.1:4337';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Local synthetic demo required');
const output=resolve(process.env.CLINIC_UI_ARTIFACTS||'.local/visual-acceptance');mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}),results=[];
try{
for(const [role] of defaultRoles){
 const context=await browser.newContext({viewport:{width:390,height:844}});await context.request.post(base+'/api/demo',{headers:{Origin:base},data:{role}});const page=await context.newPage();await page.goto(base);await expect(page.locator('.dashboardmetrics')).toBeVisible();
 const me=await (await context.request.get(base+'/api/me')).json();
 for(const [module,title] of [['patients','المرضى'],['appointments','مواعيد اليوم'],['tasks','المهام والمتابعات'],['finance','التحصيل والفواتير'],['equipment','جاهزية الأجهزة'],['inventory','تنبيهات المخزون']]){const card=page.locator('.dashboardmetrics').getByRole('heading',{name:title,exact:true});if(!me.permissions.includes(module+'.view')||role==='reception'&&module==='finance')await expect(card).toHaveCount(0);else await expect(card).toBeVisible();}
 await context.close();
}
for(const [width,height] of [[360,640],[768,1024],[1440,900]])for(const language of ['ar','en'])for(const role of ['owner','reception','finance','physio']){
 const context=await browser.newContext({viewport:{width,height}});
 const response=await context.request.post(base+'/api/demo',{headers:{Origin:base},data:{role}});expect(response.ok()).toBeTruthy();
 const page=await context.newPage();const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));await page.goto(base);await expect(page.locator('.dashboardmetrics')).toBeVisible();if(language==='en')await page.getByRole('button',{name:'Switch to English',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('dir',language==='ar'?'rtl':'ltr');await page.evaluate(()=>document.fonts.ready);
 await expect(page.locator('header .languagetoggle')).toBeVisible();
 const geometry=await page.locator('.dashboard').evaluate(el=>({top:el.getBoundingClientRect().top,width:innerWidth,documentWidth:document.documentElement.scrollWidth}));
 expect(geometry.documentWidth).toBeLessThanOrEqual(width);if(width===360)expect(geometry.top).toBeLessThan(200);
 await page.screenshot({path:resolve(output,role+'-'+language+'-'+width+'.png')});
 const checks=[];
 for(const path of ['dashboard','patients','appointments','finance']){
  // Existing navigation remains permission filtered; inaccessible pages are skipped, never granted.
  const me=await (await context.request.get(base+'/api/me')).json();if(path!=='dashboard'&&!me.permissions.includes(path+'.view'))continue;
  if(path!=='dashboard'){
   const menu=page.getByRole('button',{name:translate('القائمة',language),exact:true});if(await menu.isVisible())await menu.click();
   const label={patients:'المرضى',appointments:'المواعيد والاستقبال',finance:'الفواتير والمدفوعات'}[path];
   const nav=page.locator('#sidebar-navigation');const target=nav.getByRole('button',{name:translate(label,language),exact:true});
   if(await target.count())await target.click();else {const close=page.getByRole('button',{name:translate('إغلاق القائمة',language),exact:true});if(await close.isVisible())await close.click();continue;}
  }
  await page.addScriptTag({path:resolve('node_modules/axe-core/axe.min.js')});
  const violations=await page.evaluate(async()=>{const r=await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return r.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}))});
  checks.push({path,violations});await page.screenshot({path:resolve(output,role+'-'+language+'-'+width+'-'+path+'.png'),fullPage:true});
 }
 expect(pageErrors).toEqual([]);results.push({role,language,width,height,geometry,checks});console.log('Checked '+role+' '+language+' '+width+'x'+height);await context.close();
}
writeFileSync(resolve(output,'results.json'),JSON.stringify(results,null,2));
expect(results.flatMap(r=>r.checks.flatMap(c=>c.violations))).toEqual([]);
console.log('PASS visual geometry and accessibility for tested role screens');
}finally{await browser.close()}
