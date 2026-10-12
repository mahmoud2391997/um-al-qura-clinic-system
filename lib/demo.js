import {linkSessionBilling} from './session-billing.js';
import {financeRequest,correctCashClosure} from './finance-workflow.js';
import {saveDocument} from './documents.js';
import {followupProgram} from './clinical-programs.js';
import {approveClinicalSession} from './session-resources.js';
import {sellPackage} from './appointment-workflow.js';
import {tickAutomation} from './automation.js';
import {replaceComponent,renewLicense,payObligation} from './equipment-renewals.js';
import {saveExtras} from './purchasing-extras.js';
import {savePurchasing} from './purchasing.js';
import {recordPayment,discountInvoice} from './finance.js';
import {closeCashDay,clinicDay} from './cashbox.js';
import {createDatabase} from './db.js';
import {defaultRoles} from './permissions.js';
import {saveClinicalDetails} from './clinical.js';
import {queueIntegration} from './integrations.js';
import {seedRichDemo} from './demo-data.js';
import {randomBytes} from 'node:crypto';
export function demoEnabled(){return process.env.NODE_ENV!=='production'||process.env.CLINIC_DEMO==='1';}
export const demoDatabase=createDatabase(':memory:');
for(const [role,label] of defaultRoles){
 const name=role==='physio'?'أخصائي تجريبي':label+' — عرض تجريبي';
 demoDatabase.prepare('INSERT INTO users(id,name,email,password,role) VALUES(?,?,?,?,?)').run('demo-'+role,name,role+'@demo.invalid','disabled',role);
}
const patients=[['مريض تجريبي ١','0500000001','Google','1990-01-01','male'],['مريضة تجريبية ٢','0500000002','Referral','1985-06-01','female'],['مريض تجريبي ٣','0500000003','Walk in','2000-03-10','male']];
for(const p of patients)demoDatabase.prepare('INSERT INTO patients(name,phone,source,birth,gender) VALUES(?,?,?,?,?)').run(...p);
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
for(const [patient,time,status] of [[1,'09:00','Completed'],[2,'10:00','Waiting'],[3,'11:00','Confirmed']])demoDatabase.prepare('INSERT INTO appointments(patient_id,provider,start,end,room,service,status) VALUES(?,?,?,?,?,?,?)').run(patient,'أخصائي تجريبي',today+'T'+time,today+'T'+time.slice(0,3)+'30','غرفة ١','جلسة علاج طبيعي',status);
for(const [kind,content,approved] of [['Assessment','مثال توضيحي لحقول التقييم؛ بيانات وهمية لا تمثل حالة حقيقية.',1],['Plan','مثال لخطة موثقة تشمل أهدافًا وتكرار جلسات وموعد إعادة تقييم؛ ليست توصية علاجية.',0],['Session','مثال لتوثيق تدخلات الجلسة واستجابة المريض وخطة الزيارة التالية.',0]])demoDatabase.prepare('INSERT INTO clinical(patient_id,provider,kind,episode,content,approved) VALUES(?,?,?,?,?,?)').run(1,'demo-physio',kind,'حالة علاجية تجريبية',content,approved);
demoDatabase.prepare('INSERT INTO invoices(patient_id,service,amount,paid) VALUES(?,?,?,?)').run(1,'جلسة علاج طبيعي',200,200);
demoDatabase.prepare('INSERT INTO invoices(patient_id,service,amount,paid) VALUES(?,?,?,?)').run(2,'تقييم أولي',300,100);
demoDatabase.prepare('INSERT INTO tasks(title,owner,due,priority,status) VALUES(?,?,?,?,?)').run('تأكيد مواعيد الغد','الاستقبال',today+'T16:00','Normal','Open');
demoDatabase.prepare('INSERT INTO tasks(title,owner,due,priority,status) VALUES(?,?,?,?,?)').run('مراجعة المستندات التجريبية','مدير التشغيل',today+'T14:00','High','In Progress');
demoDatabase.prepare('INSERT INTO audit(actor,action,entity,before_value,after_value) VALUES(?,?,?,?,?)').run('demo-owner','demo.seed','بيانات العرض','null','{"synthetic":true}');
export function demoSession(role){if(!defaultRoles.some(([id])=>id===role))return null;const token=role+'.'+(Date.now()+3600000)+'.'+randomBytes(32).toString('hex');demoDatabase.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());demoDatabase.prepare('INSERT INTO sessions VALUES(?,?,?)').run(token,'demo-'+role,Date.now()+3600000);return {token};}
demoDatabase.prepare('INSERT INTO equipment(name,model,serial,location,status,component,capacity,used,replacement_cost) VALUES(?,?,?,?,?,?,?,?,?)').run('جهاز موجات تصادمية تجريبي','Demo Model','DEMO-001','غرفة ١','Active','رأس تجريبي',100000,85000,500);
demoDatabase.prepare('INSERT INTO equipment(name,model,serial,location,status,capacity) VALUES(?,?,?,?,?,?)').run('جهاز تجريبي للصيانة','Demo Model','DEMO-002','غرفة ٢','Out of Service',0);
demoDatabase.prepare('INSERT INTO maintenance(equipment_id,kind,description,priority,owner,due,cost) VALUES(?,?,?,?,?,?,?)').run(2,'Corrective','بلاغ عطل تجريبي','Critical','مسؤول صيانة تجريبي',today,0);
demoDatabase.prepare('INSERT INTO inventory(name,sku,unit,supplier,location,minimum,quantity,average_cost) VALUES(?,?,?,?,?,?,?,?)').run('جل تجريبي','DEMO-GEL','عبوة','مورد تجريبي','المخزن',5,3,2);
demoDatabase.prepare('INSERT INTO stock_movements(item_id,kind,quantity,cost,reference,reason,actor) VALUES(?,?,?,?,?,?,?)').run(1,'Receipt',3,2,'DEMO-RECEIPT','رصيد عرض تجريبي','demo-owner');
demoDatabase.prepare('INSERT INTO expenses(title,category,supplier,amount,date,method,cost_center,reference) VALUES(?,?,?,?,?,?,?,?)').run('مصروف تجريبي','تشغيل','مورد تجريبي',50,today,'Cash','العلاج الطبيعي','DEMO-EXPENSE');
demoDatabase.prepare('INSERT INTO obligations(title,amount,owner,due,recurrence,reference) VALUES(?,?,?,?,?,?)').run('اشتراك تجريبي',20,'مدير التشغيل',today,'Monthly','DEMO-CONTRACT');
demoDatabase.prepare('INSERT INTO licenses(title,entity,issuer,issued,expiry,owner,reference) VALUES(?,?,?,?,?,?,?)').run('ترخيص عرض تجريبي','منشأة تجريبية','جهة تجريبية','2026-01-01',today,'مدير التشغيل','DEMO-LICENSE');

seedRichDemo(demoDatabase,today);

for(let i=1;i<=12;i++)demoDatabase.prepare('INSERT INTO costing(service,price,staff,consumables,device,overhead) VALUES(?,?,?,?,?,?)').run('خدمة تجريبية '+i,60+i*5,25+i,5,8,12+i);
for(let i=1;i<=8;i++)demoDatabase.prepare('INSERT INTO campaigns(name,channel,budget,start,end) VALUES(?,?,?,?,?)').run('حملة تجريبية '+i,i%2?'Instagram':'Google',200*i,today,today);
for(let i=1;i<=90;i++)demoDatabase.prepare('INSERT INTO leads(name,phone,campaign_id,status,owner,followup) VALUES(?,?,?,?,?,?)').run('استفسار تجريبي '+i,'DEMO-LEAD-'+i,(i%8)+1,['New','Contacted','Booked','Attended','Converted','Lost'][i%6],'مسؤول تجريبي',today);
for(let i=1;i<=30;i++)demoDatabase.prepare('INSERT INTO complaints(title,category,description,owner,due,status,resolution) VALUES(?,?,?,?,?,?,?)').run('ملاحظة تجريبية '+i,i%2?'المواعيد':'الخدمة','تفاصيل وهمية لا تخص مريضًا حقيقيًا','مسؤول الجودة',today,i%3?'Open':'Closed',i%3?'':'إجراء تجريبي موثق');
for(let i=1;i<=60;i++)demoDatabase.prepare('INSERT INTO satisfaction(reference,score,comment,date) VALUES(?,?,?,?)').run('DEMO-SURVEY-'+i,(i%5)+1,'رأي تجريبي',today);

for(let i=1;i<=15;i++)queueIntegration(demoDatabase,{kind:i%2?'appointment_reminder':'payment_request',reference:'DEMO-'+i,payload:{synthetic:true},idempotencyKey:'demo-integration-'+i});

for(let i=1;i<=40;i++)demoDatabase.prepare('INSERT INTO packages(patient_id,service,total,expiry) VALUES(?,?,?,?)').run(i,'جلسة علاج طبيعي',6+i%6,'2027-12-31');

for(const r of demoDatabase.prepare("SELECT * FROM clinical WHERE kind IN ('Assessment','Plan','Reassessment')").all())saveClinicalDetails(demoDatabase,r.id,{kind:r.kind,structured:r.kind==='Plan'?{goals:'هدف تجريبي قابل للقياس',interventions:'تدخلات مثال للعرض',frequency:'مرتان أسبوعيًا — مثال',duration:'أربعة أسابيع — مثال',review:'2026-11-01'}:{symptoms:'أعراض وهمية للعرض',findings:'فحص وقياسات تجريبية',pain:r.id%11,red_flag:'None'}},r.provider);
for(let patient=1;patient<=24;patient++)demoDatabase.prepare('INSERT INTO patient_campaigns(patient_id,campaign_id,assigned) VALUES(?,?,?)').run(patient,1+(patient%8),today+' 00:00:00');
for(const r of demoDatabase.prepare('SELECT * FROM invoices WHERE paid>0').all())demoDatabase.prepare('INSERT INTO payments(invoice_id,kind,amount,method,reason,actor) VALUES(?,?,?,?,?,?)').run(r.id,'Payment',r.paid,['Cash','Card','Transfer'][r.id%3],'تحصيل وهمي للعرض','demo-owner');

// Financial examples use the same transactions as the app, keeping the ledger consistent.

demoDatabase.prepare('UPDATE finance_policy SET discount_limit=50,refund_limit=100 WHERE id=1').run();
for(let i=1;i<=7;i++){
 const date=new Date(Date.parse(clinicDay()+'T12:00:00Z')-i*86400000).toISOString().slice(0,10);
 const invoice=Number(demoDatabase.prepare('INSERT INTO invoices(patient_id,service,amount,paid) VALUES(?,?,?,0)').run(i,'مثال تحصيل واسترداد وخصم '+i,200+i*10).lastInsertRowid);
 recordPayment(demoDatabase,{id:invoice,payment:100+i*5,method:'Cash',reason:'تحصيل وهمي للتجربة'},'demo-finance');
 recordPayment(demoDatabase,{id:invoice,action:'refund',payment:20,method:'Cash',reason:'استرداد تجريبي موثق'},'demo-owner');
 discountInvoice(demoDatabase,{id:invoice,discount:10,reason:'خصم تجريبي معتمد'},'demo-owner');
 demoDatabase.prepare("UPDATE payments SET time=? WHERE invoice_id=?").run(date+' 10:00:00',invoice);
 demoDatabase.prepare('UPDATE discounts SET time=? WHERE invoice_id=?').run(date+' 11:00:00',invoice);
 const cash=demoDatabase.prepare("SELECT COALESCE(SUM(CASE WHEN kind='Refund' THEN -amount ELSE amount END),0) amount FROM payments WHERE method='Cash' AND date(time,'+4 hours')=?").get(date).amount;
 const expenses=demoDatabase.prepare("SELECT COALESCE(SUM(amount),0) amount FROM expenses WHERE method='Cash' AND date=?").get(date).amount;
 const opening=1000,expected=Math.round((opening+cash-expenses)*100)/100;
 closeCashDay(demoDatabase,{date,opening,counted:expected+(i%3===0?5:0),reason:i%3===0?'زيادة تجريبية موثقة في الجرد':'مطابقة تجريبية بدون فرق'},'demo-finance');
}
for(const provider of ['demo-doctor','demo-physio_lead']){
 for(const [kind,structured] of [['Assessment',{symptoms:'أعراض وهمية',findings:'قياسات للعرض',pain:4,red_flag:'None'}],['Plan',{goals:'هدف تجريبي',interventions:'تدخل توضيحي',frequency:'مرتان أسبوعيًا',duration:'أربع أسابيع',review:'2026-11-01'}],['Discharge',{outcome:'نتيجة عرض تجريبية',discharge_reason:'تحقيق أهداف المثال',recommendations:'متابعة تجريبية'}]]){
  const id=Number(demoDatabase.prepare('INSERT INTO clinical(patient_id,provider,kind,episode,content,approved) VALUES(?,?,?,?,?,0)').run(1,provider,kind,'حالة خاصة بالممارس التجريبي','مثال وهمي لشرح التوثيق؛ لا يمثل توصية علاجية.').lastInsertRowid);
  saveClinicalDetails(demoDatabase,id,{kind,structured},provider);
 }
}

// Public demo identities can be rehydrated on a different serverless instance.
// This token only selects synthetic demo data, never a real clinic session.
export function restoreDemoSession(token){
 if(!demoEnabled()||typeof token!=='string')return false;
 const [role,expiry,random,...extra]=token.split('.');const expires=Number(expiry);
 if(extra.length||!defaultRoles.some(([id])=>id===role)||!/^\d+$/.test(expiry||'')||!Number.isSafeInteger(expires)||expires<=Date.now()||expires>Date.now()+3600000||! /^[a-f0-9]{64}$/.test(random||''))return false;
 const user=demoDatabase.prepare('SELECT active FROM users WHERE id=?').get('demo-'+role);if(!user?.active)return false;
 demoDatabase.prepare('INSERT OR IGNORE INTO sessions VALUES(?,?,?)').run(token,'demo-'+role,expires);return true;
}

const resourceDemo=Number(demoDatabase.prepare('INSERT INTO clinical(patient_id,provider,kind,episode,content,approved) VALUES(?,?,?,?,?,0)').run(1,'demo-physio','Session','تجربة استهلاك الموارد','مثال وهمي: جرّب اعتماد الجلسة لمتابعة خصم الجهاز والمستهلك.').lastInsertRowid);
saveClinicalDetails(demoDatabase,resourceDemo,{kind:'Session',structured:{equipment_id:1,equipment_quantity:10,item_id:1,item_quantity:1}},'demo-physio');

const purchaseActor=role=>({id:'demo-'+role,role,active:1,permissions:JSON.parse(demoDatabase.prepare('SELECT permissions FROM roles WHERE id=?').get(role).permissions)});
for(let i=1;i<=12;i++){
 const request=savePurchasing(demoDatabase,'purchasing/requests',{title:'طلب شراء تجريبي '+i,department:'العلاج الطبيعي',needed:today,priority:'Normal',reason:'تغطية احتياج تجريبي',supplier:'مورد تجريبي',items:[{item_id:1,quantity:5,price:2},{item_id:2,quantity:3,price:3}],action:i%4===0?'save':'submit'},purchaseActor('store')).after;
 if(i%4===1){savePurchasing(demoDatabase,'purchasing/requests',{id:request.id,action:'approve'},purchaseActor('owner'));const order=savePurchasing(demoDatabase,'purchasing/orders',{request_id:request.id,action:'convert'},purchaseActor('store')).after;
 if(i===1)savePurchasing(demoDatabase,'purchasing/orders',{id:order.id,action:'receive',item_id:1,quantity:2,batch_number:'DEMO-PO-BATCH',idempotency_key:'DEMO-PO-RECEIPT'},purchaseActor('store'));
 }
 if(i%4===2)savePurchasing(demoDatabase,'purchasing/requests',{id:request.id,action:'reject',decision_reason:'مثال تجريبي لرفض موثق'},purchaseActor('owner'));
}

const quoteRequest=savePurchasing(demoDatabase,'purchasing/requests',{title:'طلب مقارنة عروض الموردين',department:'التشغيل',needed:today,priority:'Normal',reason:'مثال مقارنة أسعار',supplier:'مورد تجريبي',items:[{item_id:1,quantity:5,price:2},{item_id:2,quantity:3,price:3}],action:'submit'},purchaseActor('store')).after;
savePurchasing(demoDatabase,'purchasing/requests',{id:quoteRequest.id,action:'approve'},purchaseActor('owner'));
const demoQuote=saveExtras(demoDatabase,'purchasing/quotes',{request_id:quoteRequest.id,supplier:'مورد عرض سعر تجريبي',items:[{item_id:1,price:1.8},{item_id:2,price:2.5}]},purchaseActor('store')).after;
saveExtras(demoDatabase,'purchasing/quotes',{id:demoQuote.id,action:'approve'},purchaseActor('owner'));

const demoInvoice=saveExtras(demoDatabase,'purchasing/invoices',{order_id:1,number:'DEMO-SUPPLIER-001',amount:4,date:today},purchaseActor('owner')).after;
saveExtras(demoDatabase,'purchasing/invoices',{id:demoInvoice.id,action:'pay',amount:1,method:'Transfer',date:today,reference:'DEMO-SUPPLIER-PAY',idempotency_key:'demo-supplier-payment'},purchaseActor('owner'));
const demoPdfParts=['%PDF-1.4\n','1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n','2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n','3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n','4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n'];
const demoPdfStream='BT /F1 12 Tf 30 100 Td (Synthetic supplier quote preview) Tj ET';demoPdfParts.push('5 0 obj\n<< /Length '+Buffer.byteLength(demoPdfStream)+' >>\nstream\n'+demoPdfStream+'\nendstream\nendobj\n');let demoPdf='',demoOffsets=[0];for(const [i,part] of demoPdfParts.entries()){if(i)demoOffsets.push(Buffer.byteLength(demoPdf));demoPdf+=part;}const xrefOffset=Buffer.byteLength(demoPdf);demoPdf+='xref\n0 6\n0000000000 65535 f \n'+demoOffsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xrefOffset+'\n%%EOF';
saveExtras(demoDatabase,'purchasing/attachments',{request_id:quoteRequest.id,name:'demo-quote.pdf',mime:'application/pdf',data:Buffer.from(demoPdf).toString('base64')},purchaseActor('store'));

saveExtras(demoDatabase,'purchasing/quotes',{request_id:quoteRequest.id,supplier:'مورد بديل للمقارنة',items:[{item_id:1,price:2.2},{item_id:2,price:2.8}]},purchaseActor('store'));

demoDatabase.prepare('INSERT INTO recurring_tasks(title,owner,due,every_days,priority) VALUES(?,?,?,?,?)').run('مراجعة مخزون أسبوعية','demo-store',today,7,'Normal');
replaceComponent(demoDatabase,{equipment_id:2,name:'رأس بديل تجريبي',serial:'DEMO-HEAD-2',capacity:100000,cost:350,reason:'مثال استبدال مع حفظ العداد السابق'},'demo-owner');
renewLicense(demoDatabase,{id:1,issued:today,expiry:new Date(Date.parse(today)+365*86400000).toISOString().slice(0,10),reference:'DEMO-RENEWED'},'demo-owner');
payObligation(demoDatabase,1,'demo-owner');tickAutomation(demoDatabase);

for(let i=1;i<=6;i++)demoDatabase.prepare('INSERT INTO waiting_list(patient_id,service,provider,desired,priority) VALUES(?,?,?,?,?)').run(i,'جلسة علاج طبيعي','ممارس انتظار تجريبي',today,i%2?'High':'Normal');

demoDatabase.prepare('INSERT INTO cost_rates(provider,hourly,overhead) VALUES(?,?,?)').run('demo-physio',20,3);
const costSample=Number(demoDatabase.prepare('INSERT INTO clinical(patient_id,provider,kind,episode,content) VALUES(?,?,?,?,?)').run(1,'demo-physio','Session','جلسة تكلفة تجريبية','مثال تكلفة؛ جميع القيم وهمية.').lastInsertRowid);
saveClinicalDetails(demoDatabase,costSample,{kind:'Session',structured:{minutes:30,equipment:[{id:1,quantity:10}],items:[{id:1,quantity:1}]}},'demo-physio');approveClinicalSession(demoDatabase,costSample,'demo-physio');
for(const [kind,pain,value] of [['Assessment',6,20],['Reassessment',3,30]]){const id=Number(demoDatabase.prepare('INSERT INTO clinical(patient_id,provider,kind,episode,content) VALUES(?,?,?,?,?)').run(1,'demo-physio',kind,'مقارنة قياسات تجريبية','أرقام وهمية لعرض المقارنة فقط.').lastInsertRowid);saveClinicalDetails(demoDatabase,id,{kind,structured:{symptoms:'مثال تجريبي',findings:'مثال قياس',pain,red_flag:'None',measurements:[{name:'قياس تجريبي',unit:'وحدة عرض',value}]}},'demo-physio');approveClinicalSession(demoDatabase,id,'demo-physio');}
demoDatabase.prepare('INSERT INTO preventive_actions(title,source,owner,due,status,evidence) VALUES(?,?,?,?,?,?)').run('مراجعة إجراء استقبال تجريبي','شكوى وهمية','demo-quality',today,'Open','');
sellPackage(demoDatabase,{id:1,price:100},'demo-owner');

for(const r of demoDatabase.prepare("SELECT * FROM clinical WHERE kind='Home Program'").all())saveClinicalDetails(demoDatabase,r.id,{kind:r.kind,structured:{instructions:'تعليمات وهمية لعرض النموذج؛ يكتب الممارس التعليمات الفعلية.',duration:'مدة تجريبية',review:today,exercises:[{name:'تمرين عرض وهمي',dose:'جرعة يحددها الممارس',frequency:'تكرار يحدده الممارس',instructions:'شرح وهمي لطريقة عرض التعليمات، وليس توصية علاجية.',url:''}]}},r.provider);
const homeSample=demoDatabase.prepare("SELECT id FROM clinical WHERE kind='Home Program' AND provider='demo-physio' LIMIT 1").get();if(homeSample)approveClinicalSession(demoDatabase,homeSample.id,'demo-physio');if(homeSample)followupProgram(demoDatabase,{program_id:homeSample.id,date:today,completed:3,planned:5,note:'مثال متابعة وهمية للعرض'},{id:'demo-physio',role:'physio',active:1,permissions:['clinical.edit']});

for(const path of ['patients/attachments','clinical/attachments','compliance/attachments'])saveDocument(demoDatabase,path,{target_id:1,name:'document-demo.pdf',mime:'application/pdf',data:Buffer.from('%PDF-1.4\n1 0 obj <</Type /Catalog>> endobj\n%%EOF').toString('base64')},{id:'demo-owner',role:'owner',active:1,permissions:['patients.view','patients.create','clinical.view','clinical.create','compliance.view','compliance.create']});

const refundInvoice=demoDatabase.prepare('SELECT id FROM invoices WHERE paid>=1 LIMIT 1').get();if(refundInvoice)financeRequest(demoDatabase,{invoice_id:refundInvoice.id,kind:'refund',amount:1,method:'Card',reason:'طلب وهمي لمراجعة التدفق'},{id:'demo-finance',role:'finance',active:1,permissions:['finance.create']});
const closedSample=demoDatabase.prepare('SELECT * FROM cash_closures LIMIT 1').get();if(closedSample)correctCashClosure(demoDatabase,{closure_id:closedSample.id,counted:closedSample.counted+1,reference:'DEMO-CORRECTION',reason:'تصحيح نقد معدود وهمي لعرض السجل'},{id:'demo-owner',role:'owner',active:1,permissions:['finance.approve']});

const sessionInvoice=Number(demoDatabase.prepare('INSERT INTO invoices(patient_id,service,amount,paid) VALUES(?,?,?,?)').run(1,'فاتورة جلسة تكلفة تجريبية',30,0).lastInsertRowid);recordPayment(demoDatabase,{id:sessionInvoice,payment:20,method:'Card',reason:'تحصيل وهمي لعرض الربحية'},'demo-finance');linkSessionBilling(demoDatabase,{clinical_id:costSample,invoice_id:sessionInvoice,amount:30},'demo-finance');
