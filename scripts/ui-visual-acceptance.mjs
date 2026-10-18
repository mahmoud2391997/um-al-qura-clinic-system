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
for(const width of [1366,390])for(const role of ['owner','reception','finance','physio']){
 const context=await browser.newContext({viewport:{width,height:width===390?844:850}});
 const response=await context.request.post(base+'/api/demo',{headers:{Origin:base},data:{role}});expect(response.ok()).toBeTruthy();
 const page=await context.newPage();await page.goto(base);await expect(page.locator('.dashboardmetrics')).toBeVisible();await page.evaluate(()=>document.fonts.ready);
 await expect(page.locator('header .languagetoggle')).toBeVisible();
 const geometry=await page.locator('.dashboard').evaluate(el=>({top:el.getBoundingClientRect().top,width:innerWidth,documentWidth:document.documentElement.scrollWidth}));
 expect(geometry.documentWidth).toBeLessThanOrEqual(width);if(width===390)expect(geometry.top).toBeLessThan(160);
 await page.screenshot({path:resolve(output,role+'-'+width+'.png')});
 const checks=[];
 for(const path of ['dashboard','patients','appointments','finance']){
  // Existing navigation remains permission filtered; inaccessible pages are skipped, never granted.
  const me=await (await context.request.get(base+'/api/me')).json();if(path!=='dashboard'&&!me.permissions.includes(path+'.view'))continue;
  if(path!=='dashboard'){
   if(width===390)await page.getByRole('button',{name:'القائمة',exact:true}).click();
   const label={patients:'المرضى',appointments:'المواعيد والاستقبال',finance:'الفواتير والمدفوعات'}[path];
   const nav=page.locator('#sidebar-navigation');const target=nav.getByRole('button',{name:label,exact:true});
   if(await target.count())await target.click();else {if(width===390)await page.getByRole('button',{name:'إغلاق القائمة',exact:true}).click();continue;}
  }
  await page.addScriptTag({path:resolve('node_modules/axe-core/axe.min.js')});
  const violations=await page.evaluate(async()=>{const r=await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return r.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}))});
  checks.push({path,violations});
 }
 results.push({role,width,geometry,checks});await context.close();
}
writeFileSync(resolve(output,'results.json'),JSON.stringify(results,null,2));
expect(results.flatMap(r=>r.checks.flatMap(c=>c.violations))).toEqual([]);
console.log('PASS visual geometry and accessibility for tested role screens');
}finally{await browser.close()}
