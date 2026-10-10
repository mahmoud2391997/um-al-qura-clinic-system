import {validateSessionResources} from './session-resources.js';
const kinds=['Assessment','Plan','Session','Home Program','Reassessment','Discharge','Addendum'];
export function validateClinical(body){
 if(!kinds.includes(body.kind))throw Error('نوع التوثيق غير صحيح');
 const structured=body.structured||{};
 if(typeof structured!=='object'||Array.isArray(structured))throw Error('حقول التقييم غير صحيحة');
 if(['Assessment','Reassessment'].includes(body.kind)){
  if(!structured.symptoms||!structured.findings)throw Error('الأعراض ونتائج الفحص مطلوبان');
  if(structured.pain===''||structured.pain===undefined||!Number.isFinite(Number(structured.pain))||Number(structured.pain)<0||Number(structured.pain)>10)throw Error('قياس الألم من صفر إلى عشرة');
  if(!['None','Present'].includes(structured.red_flag))throw Error('حدد نتيجة مراجعة العلامات التحذيرية');
  if(structured.red_flag==='Present'&&!structured.flag_action?.trim())throw Error('وثّق الإجراء أو الإحالة عند وجود علامة تحذيرية');
 }
 if(body.kind==='Plan'){
  for(const key of ['goals','interventions','frequency','duration','review'])if(!String(structured[key]||'').trim())throw Error('أكمل الأهداف والتدخلات والتكرار والمدة وإعادة التقييم');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(structured.review))throw Error('تاريخ إعادة التقييم غير صحيح');
 }
 if(body.kind==='Session')validateSessionResources(structured);
 if(body.kind==='Discharge'){
  for(const key of ['outcome','discharge_reason','recommendations'])if(!String(structured[key]||'').trim())throw Error('أكمل نتيجة العلاج وسبب الخروج والتوصيات');
 }
 return structured;
}
export function saveClinicalDetails(db,id,body,provider){
 const structured=validateClinical(body);
 const r=db.prepare('SELECT patient_id,episode FROM clinical WHERE id=?').get(id);
 db.prepare('INSERT OR IGNORE INTO episodes(patient_id,provider,title) VALUES(?,?,?)').run(r.patient_id,provider,r.episode);
 const episode=db.prepare('SELECT id FROM episodes WHERE patient_id=? AND provider=? AND title=?').get(r.patient_id,provider,r.episode);
 db.prepare('INSERT INTO clinical_details(clinical_id,episode_id,structured) VALUES(?,?,?) ON CONFLICT(clinical_id) DO UPDATE SET structured=excluded.structured').run(id,episode.id,JSON.stringify(structured));
}
