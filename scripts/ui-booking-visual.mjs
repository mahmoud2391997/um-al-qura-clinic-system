import {chromium,expect} from '@playwright/test';
import {resolve} from 'node:path';import {mkdirSync,writeFileSync} from 'node:fs';
const base=process.argv[2]||'http://127.0.0.1:4337';if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Local demo only');
const output=resolve(process.env.CLINIC_UI_ARTIFACTS||'.local/booking-visual');mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}),results=[];
try{for(const width of [1366,390]){
 const context=await browser.newContext({viewport:{width,height:844}});await context.request.post(base+'/api/demo',{headers:{Origin:base},data:{role:'reception'}});
 const page=await context.newPage();await page.goto(base);await expect(page.locator('.dashboardmetrics')).toBeVisible();const trigger=page.getByRole('button',{name:/حجز موعد/});await trigger.click();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
 await expect(dialog.locator('.patientmatches button')).toHaveCount(1); // Only inline registration until searching.
 const search=dialog.getByRole('searchbox');await search.fill('DEMO-0150');await expect(dialog.locator('.patientmatches button')).toHaveCount(2);await search.press('ArrowDown');await search.press('Enter');await expect(dialog.getByRole('button',{name:'تغيير المريض'})).toBeVisible();
 const provider=dialog.getByRole('combobox',{name:'الممارس',exact:true});await provider.selectOption('demo-physio');const service=dialog.getByRole('combobox',{name:'الخدمة والسعر الساري',exact:true});await expect(service.locator('option')).toHaveCount(3);await service.selectOption({index:1});await expect(dialog.getByText('النهاية حسب مدة الخدمة المعتمدة',{exact:false})).toBeVisible();await expect(dialog.getByRole('textbox',{name:'النهاية',exact:true})).toHaveCount(0);
 const bounds=await dialog.boundingBox();if(width===390){expect(bounds.y).toBe(0);expect(bounds.width).toBe(390);expect(bounds.height).toBe(844)}
 await dialog.evaluate(el=>el.scrollTop=el.scrollHeight);await expect(dialog.getByRole('button',{name:'حفظ',exact:true})).toBeInViewport();await page.screenshot({path:resolve(output,'booking-'+width+'.png')});
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(page.getByRole('button',{name:'＋ إضافة جديدة',exact:true})).toBeFocused();
 results.push({width,dialog:bounds,keyboardSelection:true,computedEnd:true,stickySave:true,escapeReturnsFocus:true});await context.close();
}writeFileSync(resolve(output,'results.json'),JSON.stringify(results,null,2));console.log('PASS booking catalog, search keyboard, phone geometry, sticky save and focus return');}finally{await browser.close()}
