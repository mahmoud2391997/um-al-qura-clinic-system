export const modules = {patients:'المرضى',appointments:'المواعيد',clinical:'الملف السريري',finance:'المالية',tasks:'المهام',equipment:'الأجهزة',inventory:'المخزون',compliance:'التراخيص',marketing:'التسويق',quality:'الجودة',reports:'التقارير',users:'المستخدمون',roles:'الأدوار',audit:'سجل التدقيق'};
export const actions = {view:'عرض',create:'إضافة',edit:'تعديل',approve:'اعتماد',archive:'أرشفة',export:'تصدير'};
const grant=(ms,as=['view','create','edit'])=>ms.flatMap(m=>as.map(a=>`${m}.${a}`));
export const defaultRoles = [
['owner','مالك المجمع',grant(Object.keys(modules),Object.keys(actions))],
['manager','مدير التشغيل',grant(['patients','appointments','tasks','equipment','inventory','compliance','reports','quality'])],
['reception','الاستقبال',grant(['patients','appointments','tasks']).concat(['finance.view','finance.create'])],
['doctor','الطبيب',grant(['clinical'],['view','create','edit','approve']).concat(grant(['patients','appointments','tasks'],['view']))],
['physio_lead','مسؤول العلاج الطبيعي',grant(['clinical'],['view','create','edit','approve']).concat(grant(['patients','appointments','tasks'],['view']))],
['physio','أخصائي العلاج الطبيعي',grant(['clinical'],['view','create','edit','approve']).concat(grant(['patients','appointments','tasks'],['view']))],
['assistant','المساعد الإداري',grant(['patients','appointments','tasks'])],
['finance','المالية',grant(['finance','reports'],['view','create','edit','approve','export']).concat(['patients.view','tasks.view'])],
['store','المخزون والمشتريات',grant(['inventory','tasks'])],['maintenance','الصيانة',grant(['equipment','tasks'])],
['marketing','التسويق وعلاقات العملاء',grant(['marketing','tasks'])],['quality','مسؤول الجودة',grant(['quality','tasks','reports'])],
['technical','مسؤول النظام التقني',grant(['users'])]
];
export function allowed(user,permissions,module,action){return !!user?.active && permissions.includes(`${module}.${action}`);}
export function validPermissions(p){return Array.isArray(p)&&p.every(x=>Object.keys(modules).some(m=>Object.keys(actions).some(a=>x===`${m}.${a}`)));}
