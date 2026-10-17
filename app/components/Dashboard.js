'use client';
import {useEffect,useState} from 'react';
import {useLanguage} from './LanguageProvider';
const cards=[
 ['patients','المرضى',[['total','المرضى ضمن صلاحياتك']],'patients'],
 ['appointments','مواعيد اليوم',[['today','مواعيد اليوم'],['waiting','في الانتظار'],['inService','داخل الخدمة'],['completed','مكتملة']],'appointments'],
 ['tasks','المهام والمتابعات',[['open','مهام مفتوحة'],['overdue','متأخرة']],'tasks'],
 ['finance','التحصيل والفواتير',[['outstanding','مبالغ متبقية (ر.ع.)'],['collectionsToday','صافي التحصيل اليوم (ر.ع.)']],'finance'],
 ['equipment','جاهزية الأجهزة',[['unavailable','أجهزة غير متاحة'],['maintenanceDue','صيانة مستحقة']],'equipment'],
 ['inventory','تنبيهات المخزون',[['lowStock','أصناف منخفضة الرصيد'],['expiredBatches','دفعات منتهية']],'inventory'],
];
const shortcuts=[['patients','تسجيل مريض','ابدأ ملفًا جديدًا للمريض',true],['appointments','حجز موعد','اختر المريض والممارس ووقت الزيارة',true],['clinical','توثيق جلسة','سجّل تفاصيل الرعاية ثم اعتمدها حسب صلاحيتك',true],['finance','إصدار فاتورة','أضف الخدمة وقيمة الفاتورة',true],['tasks','إضافة مهمة','حدد المسؤول وموعد الاستحقاق',true]];
export default function Dashboard({api,can,role,onNavigate}){
 const {t,language}=useLanguage();const [state,setState]=useState({loading:true,data:null,error:''}),[reload,setReload]=useState(0);
 useEffect(()=>{let active=true;setState({loading:true,data:null,error:''});api('dashboard').then(data=>{if(active)setState({loading:false,data,error:''})}).catch(error=>{if(active)setState({loading:false,data:null,error:error.message})});return()=>{active=false}},[api,reload]);
 const number=(value,currency=false)=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString(language==='en'?'en-GB':'ar-OM',{minimumFractionDigits:currency?3:0,maximumFractionDigits:currency?3:0}):'—';
 const sections=state.data?.sections||{};
 const pending=[['appointments','waiting','مراجعون في الانتظار','appointments'],['tasks','overdue','مهام تحتاج متابعة','tasks'],['equipment','maintenanceDue','صيانة تحتاج متابعة','equipment/maintenance'],['inventory','lowStock','مخزون يحتاج مراجعة','inventory'],['inventory','expiredBatches','دفعات منتهية تحتاج مراجعة','inventory/batches']].filter(([section,key,,path])=>typeof sections[section]?.[key]==='number'&&sections[section][key]>0&&can(path,'view'));
 return <div className="dashboard"><section className="dashboardwelcome card"><div><h2>{t('ابدأ يومك من هنا')}</h2><p>{t('ملخص مباشر للبيانات التي تسمح بها صلاحياتك، واختصارات للخطوة التالية.')}</p>{state.data?.date&&<small>{t('يوم العمل بتوقيت عمان')}: <time dateTime={state.data.date}>{state.data.date}</time></small>}</div><button className="secondary" disabled={state.loading} onClick={()=>setReload(value=>value+1)}>{t('تحديث الملخص')}</button></section>
 <section className="card"><h2>{t('ماذا تريد أن تفعل؟')}</h2><div className="dashboardshortcuts">{shortcuts.filter(([path,,,create])=>can(path,'view')&&can(path,create?'create':'view')).map(([path,title,description,create])=><button type="button" key={path} className="secondary" onClick={()=>onNavigate(path,create)}><b>{t(title)}</b><span>{t(description)}</span></button>)}</div>{!shortcuts.some(([path])=>can(path,'view')&&can(path,'create'))&&<p>{t('استخدم القائمة للوصول إلى الأقسام المسموحة لحسابك.')}</p>}</section>
 {state.loading&&<section className="card" role="status">{t('جاري تحميل ملخص العمل…')}</section>}
 {state.error&&<section className="card" role="alert"><p>{t('تعذر تحميل ملخص العمل. يمكنك استخدام الأقسام أو إعادة المحاولة.')}</p><button className="secondary" onClick={()=>setReload(value=>value+1)}>{t('إعادة المحاولة')}</button></section>}
 {!state.loading&&!state.error&&<section className="dashboardmetrics" aria-label={t('ملخص العمل')}>{cards.filter(([section])=>sections[section]&&!(role==='reception'&&section==='finance')).map(([section,title,metrics,path])=><article key={section} className="card"><h2>{t(title)}</h2>{section==='appointments'&&<small>{t('يشمل الإجمالي المواعيد الملغاة وعدم الحضور.')}</small>}<dl>{metrics.map(([key,label])=><div key={key}><dt>{t(label)}</dt><dd>{number(sections[section][key],section==='finance')}</dd></div>)}</dl>{can(path,'view')&&<button className="secondary" onClick={()=>onNavigate(path)}>{t('فتح القسم')}</button>}</article>)}{Object.keys(sections).length===0&&<p className="card">{t('لا توجد أقسام بيانات متاحة لهذا الحساب. اطلب من مسؤول النظام مراجعة صلاحياتك.')}</p>}</section>}

 {!state.loading&&!state.error&&<section className="card"><h2>{t('يحتاج انتباهك')}</h2>{pending.length?<ul className="dashboardpending">{pending.map(([section,key,label,path])=><li key={section+key}><span>{t(label)} <b>{number(sections[section][key])}</b></span><button className="secondary" onClick={()=>onNavigate(path)}>{t('مراجعة')}</button></li>)}</ul>:<p>{t('لا توجد تنبيهات في المؤشرات المعروضة حاليًا.')}</p>}</section>}
 <section className="card"><h2>{t('رحلة المراجع ببساطة')}</h2><ol className="dashboardjourney"><li>{t('الاستقبال: سجل المريض وحدد الموعد وسجّل وصوله.')}</li><li>{t('الممارس: راجع ملف المريض ووثّق الرعاية واعتمد السجل.')}</li><li>{t('المالية: أصدر الفاتورة وسجّل التحصيل حسب الصلاحيات.')}</li><li>{t('المتابعة: أضف المهام وراجع ما يحتاج إجراء.')}</li></ol><small>{t('كل خطوة تظهر لمن يملك صلاحيتها؛ لوحة البداية لا تمنح صلاحيات إضافية.')}</small></section></div>;
}
