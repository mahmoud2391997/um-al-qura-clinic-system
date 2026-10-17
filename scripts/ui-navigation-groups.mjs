// Local synthetic demo only; never run against a live clinic.
import {chromium,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const base=process.argv[2]||'http://127.0.0.1:4327';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Local demo required');
const output=resolve(process.env.CLINIC_UI_ARTIFACTS||'.local/navigation-groups');mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const results=[];
try{
 for(const role of ['owner','reception','finance','physio']){
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const login=await context.request.post(base+'/api/demo',{headers:{Origin:base},data:{role}});expect(login.ok()).toBeTruthy();
  const page=await context.newPage();await page.goto(base);await expect(page.locator('.dashboardmetrics')).toBeVisible();
  const top=await page.locator('.dashboard').evaluate(el=>el.getBoundingClientRect().top);expect(top).toBeLessThan(160);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button',{name:'القائمة',exact:true}).click();
  const more=page.getByRole('button',{name:'المزيد / الإعدادات',exact:true});await more.click();
  const sections=page.locator('.navsection');expect(await sections.count()).toBeGreaterThan(0);
  expect(await page.locator('.navsection[open]').count()).toBe(0);
  const labels=await sections.locator('button').allTextContents();expect(new Set(labels).size).toBe(labels.length);
  const sectionLabel=await sections.first().locator('summary').innerText();await page.locator('.navsearch input').fill(sectionLabel);await expect(page.locator('.navsection summary').filter({hasText:sectionLabel})).toBeVisible();
  const target=labels[0].trim();
  await page.locator('.navsearch input').fill(target);await expect(page.locator('.navsection button').filter({hasText:target}).first()).toBeVisible();
  await page.screenshot({path:resolve(output,role+'-search.png'),fullPage:true});
  await page.locator('.navsearch input').fill('');await sections.first().locator('summary').click();
  await expect(sections.first().locator('button').first()).toBeVisible();
  await sections.first().locator('button').first().click();await expect(page.locator('.shell')).not.toHaveClass(/mobilenavopen/);
  await page.getByRole('button',{name:'القائمة',exact:true}).click();if(await more.getAttribute('aria-expanded')!=='true')await more.click();
  await page.screenshot({path:resolve(output,role+'-groups.png'),fullPage:true});
  results.push({role,firstContentTop:Math.round(top),sections:await sections.count(),pages:labels.length});await context.close();
 }
 writeFileSync(resolve(output,'results.json'),JSON.stringify(results,null,2));console.log('PASS: four role menus grouped, deduplicated, searchable, clickable and RTL390 without overflow; content before160px',JSON.stringify(results));
}finally{await browser.close()}
