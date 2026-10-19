import {translateLabel} from '../lib/ui-translations.js';
import {chromium,expect} from '@playwright/test';
import {resolve} from 'node:path';import {mkdirSync,writeFileSync} from 'node:fs';
const base=process.argv[2]||'http://127.0.0.1:4337';if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Local demo only');
const output=resolve(process.env.CLINIC_UI_ARTIFACTS||'.local/booking-visual');mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}),results=[];
try{for(const [width,height] of [[360,640],[768,1024],[1440,900]])for(const language of ['ar','en']){
 const t=value=>translateLabel(value,language);
 const context=await browser.newContext({viewport:{width,height}});await context.request.post(base+'/api/demo',{headers:{Origin:base},data:{role:'reception'}});
 const page=await context.newPage();await page.goto(base);await expect(page.locator('.dashboardmetrics')).toBeVisible();if(language==='en')await page.getByRole('button',{name:'Switch to English',exact:true}).click();const trigger=page.getByRole('button',{name:new RegExp(t('حجز موعد'))});await trigger.click();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
 await expect(dialog.locator('.patientmatches button')).toHaveCount(1); // Only inline registration until searching.
 const search=dialog.getByRole('searchbox');await search.fill('DEMO-0150');await expect(dialog.locator('.patientmatches button')).toHaveCount(2);await search.press('ArrowDown');await search.press('Enter');await expect(dialog.getByRole('button',{name:t('تغيير المريض')})).toBeVisible();await expect(search).not.toHaveAttribute('aria-controls');await expect(search).not.toHaveAttribute('aria-expanded');
 const provider=dialog.getByRole('combobox',{name:t('الممارس'),exact:true});await provider.selectOption('demo-physio');const service=dialog.getByRole('combobox',{name:t('الخدمة والسعر الساري'),exact:true});await expect(service.locator('option')).toHaveCount(3);await service.selectOption({index:1});await expect(dialog.getByText(t('النهاية حسب مدة الخدمة المعتمدة'),{exact:false})).toBeVisible();await expect(dialog.getByRole('textbox',{name:t('النهاية'),exact:true})).toHaveCount(0);
 const bounds=await dialog.boundingBox();if(width===360){expect(bounds.y).toBe(0);expect(bounds.width).toBe(360);expect(bounds.height).toBe(640)}
 await dialog.evaluate(el=>el.scrollTop=el.scrollHeight);await expect(dialog.getByRole('button',{name:t('حفظ'),exact:true})).toBeInViewport();await page.screenshot({path:resolve(output,'booking-'+language+'-'+width+'.png')});
 await page.addScriptTag({path:resolve('node_modules/axe-core/axe.min.js')});
 const violations=await page.evaluate(async()=> (await window.axe.run(document)).violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)})));expect(violations).toEqual([]);
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(page.getByRole('button',{name:t('＋ إضافة جديدة'),exact:true})).toBeFocused();
 results.push({width,height,language,violations,dialog:bounds,keyboardSelection:true,computedEnd:true,stickySave:true,escapeReturnsFocus:true});await context.close();
}writeFileSync(resolve(output,'results.json'),JSON.stringify(results,null,2));console.log('PASS booking catalog, search keyboard, phone geometry, sticky save and focus return');}finally{await browser.close()}
