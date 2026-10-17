// Shared by the UI and printable guides; permissions decide which steps appear.
export function roleHelp(permissions){
 const has=p=>permissions.includes(p);
 return [
  has('patients.view')&&'ابدأ بالبحث عن المريض بالاسم أو الهاتف أو رقم الملف لتجنب التكرار.',
  has('appointments.create')&&'لحجز زيارة، افتح حجز موعد؛ اختر ملفًا موجودًا أو سجل مريضًا جديدًا داخل الحجز ثم احفظ مرة واحدة.',
  has('clinical.create')&&'افتح مواعيدك ثم سجل المريض ووثّق الزيارة؛ الاعتماد للممارس المؤهل وبحسب الصلاحيات.',
  has('finance.create')&&'اختر المريض والخدمة المعتمدة لإصدار الفاتورة، ثم راجع النتيجة قبل تسجيل التحصيل.',
  has('tasks.view')&&'راجع المهام المستحقة وأكمل المهمة بالدليل المطلوب.',
  'الصفحات اليومية في القائمة، وباقي الصفحات المسموحة في المزيد أو البحث عن قسم.',
  'للبحث في المرضى والمواعيد والفواتير اضغط /؛ النتائج ضمن صلاحياتك فقط.',
 ].filter(Boolean);
}
