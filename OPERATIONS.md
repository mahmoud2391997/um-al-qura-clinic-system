# إعداد التشغيل واستعادة البيانات

الديمو المنشور على Vercel مؤقت داخل الذاكرة حسب الاتفاق. الأدوات التالية لا تحوّله إلى قاعدة إنتاج دائمة.

## رد جلسة الباقة وتصحيح المالية

المالية تنشئ طلب الرد بالموعد والسبب؛ موظف معتمد آخر يراجعه. الاعتماد يعيد الجلسة مرة واحدة مع حفظ الخصم الأصلي. لا يعاد خصم الموعد نفسه، ويُنشأ موعد جديد للخدمة اللاحقة.

لتصحيح قيد مالي، تُحدد حركة التحصيل أو المصروف أو سداد المورد والسبب. المالك يراجع طلبًا أنشأه موظف آخر. ينشأ قيد تعويضي في التاريخ الحالي؛ لا تُحذف الحركة الأصلية ولا يُفتح يوم الصندوق القديم. قيود سداد المورد ومصروفه تتعوض معًا. إذا تغير المصدر بعد الطلب أو لم يسمح رصيد الفاتورة أو كان يوم التصحيح النقدي مقفلًا، يُرفض التنفيذ دون أثر جزئي. هذه إلغاء كامل للقيد وليست تعديلًا جزئيًا أو ردًا ماليًا خارجيًا.

## PostgreSQL backup and restore (primary production path)

Production uses the shared PostgreSQL procedure in `infra/RUNBOOK.md`: owner-configured private settings, `sh infra/backup.sh`, then `sh infra/restore-drill.sh <encrypted archive>` in an isolated environment. The backup includes database dumps, per-table counts/content fingerprints and file checksums, with authenticated encryption. The restore drill compares those values in a separate PostgreSQL container. Configure retention/offsite destination and test restored application behavior before real use.

Run `node scripts/postgres-backup-drill.mjs` for a self-contained synthetic-only rehearsal of those actual shell scripts. It creates a private temporary infra copy and isolated PostgreSQL 17 containers with no network or published ports, generates a temporary encryption key, verifies corrupt-archive rejection, restores the good archive and prints recovery time. It never reads operator settings or real databases. Requires Docker and cached PostgreSQL 17 images.

## النسخ الاحتياطي المشفر المحلي (SQLite — legacy/development)

الأداة تنتج لقطة SQLite متسقة مشفرة بـ AES-256-GCM، بملف صلاحياته 600. يلزم تعيين `CLINIC_BACKUP_KEY` بمفتاح عشوائي من 32 بايت، ممثلًا بـ64 حرف hexadecimal، وحفظه في مدير أسرار منفصل عن النسخ. فقد المفتاح يمنع الاستعادة. لا تحفظه في Git أو تشاركه في المحادثة.

بعد إعداد المفتاح في البيئة:

```sh
mkdir -p backups
node scripts/backup.mjs backup data/clinic.sqlite backups/clinic.uqb
```

الأداة ترفض استبدال ملف موجود. استخدم اسمًا جديدًا لكل لقطة. انقل النسخ المشفرة إلى تخزين مستقل بحسب سياسة المجمع؛ الجدولة والاحتفاظ والرفع الخارجي لم تُفعّل.

الاستعادة تتم إلى ملف جديد دون الكتابة فوق قاعدة قائمة:

```sh
node scripts/backup.mjs restore backups/clinic.uqb data/clinic-restored.sqlite
```

تتحقق الأداة من التشفير وسلامة SQLite وجداول المجمع، وتبطل الجلسات وروابط الاستعادة القديمة. اختبر القاعدة المستعادة في بيئة منفصلة، ثم أوقف التطبيق قبل تحويل مسار قاعدة التشغيل إليها. لا تستخدم اسم قاعدة حية كوجهة استعادة.

## استعادة الحساب بالبريد

مسار الطلب متاح من «نسيت كلمة المرور». الرابط صالح لنصف ساعة ولمرة واحدة، والتخزين يحتفظ ببصمة الرمز فقط. عند التغيير تُبطل جلسات الحساب. الرمز في جزء الرابط بعد علامة # لتجنب وصوله إلى سجل طلب الصفحة.

يلزم إعداد خدمة بريد موثوقة متوافقة مع عقد الإرسال: طلب HTTPS يحمل `{to, subject, text}`، ومصادقة Bearer عبر `CLINIC_EMAIL_KEY`، ورابط الخدمة عبر `CLINIC_EMAIL_ENDPOINT`، ورابط التطبيق HTTPS عبر `CLINIC_BASE_URL`. هذا عقد لخدمة وسيطة وليس إعلانًا بالتوافق المباشر مع جميع مزودي البريد. يلزم اختيار المزود وبناء موائمه والتحقق من المرسل والتسليم. دون إعداد الخدمة لا تُرسل رسائل، ويُوضح النظام أنها غير مفعلة. مسار الاستعادة غير متاح في الديمو العام؛ إعادة التعيين بواسطة المالك متاحة للنظام المحلي.

## التنبيهات المجدولة

`POST /api/automation/run` نقطة تشغيل محمية بمفتاح `CLINIC_AUTOMATION_SECRET` لا يقل عن32 حرفًا، في ترويسة Authorization Bearer. ترفض الذاكرة المؤقتة ونشر Vercel الحالي. جهز التخزين الدائم والمجدول قبل تفعيل الاستدعاءات؛ لا توجد مهمة دورية مفعلة على خدمة خارجية. استمرار التنبيهات عند استخدام التطبيق قائم في الديمو.

## اختبار قبول رحلة المريض

الاختبارات العادية:

```sh
npm test
npm run build
```

لرحلة المتصفح الجديدة، استخدم قاعدة PostgreSQL محلية منفصلة باسم يدل على الاختبار، ثم:

```sh
CLINIC_UI_DATABASE_URL='<local disposable PostgreSQL URL>' npm run test:ui
```

البرنامج ينشئ نطاق بيانات مؤقتًا ويبدأ خادم اختبار، ثم يجرب التسجيل والحجز معًا والحضور والتوثيق والفاتورة والصلاحيات. يحذف نطاق الاختبار عند الانتهاء. يحتاج متصفح Playwright، أو Chrome محليًا عبر `CHROME_PATH`. لا توجهه إلى قاعدة تشغيل.

لقياس التنقل والحقول، شغّل خادم تطوير منفصلًا ببيانات وهمية فقط:

```sh
CLINIC_DB=:memory: DEMO_MODE=on npm run dev -- --port 3031
node scripts/ui-usability-baseline.mjs http://127.0.0.1:3031
```

ولرحلة الديمو عبر API على هذا الخادم فقط:

```sh
CLINIC_ACCEPTANCE_BASE=http://127.0.0.1:3031 npm run test:acceptance
```

لا تستخدم `npm start` مع `CLINIC_DEMO_ONLY=1`: فحص الإنتاج يرفض هذا الوضع عمدًا. اختبارات القبول لا تحل محل تجربة موظفي المجمع أو اعتماد التشغيل الطبي والمالي.

## القرارات اللازمة للتفعيل

التخزين الدائم، خدمة البريد، مزود الدفع وقناة رسائل المواعيد والمجدول الخارجي. لم يُشترَ اشتراك ولم تُرسل رسالة ولم يُنفذ دفع حقيقي. بعد اختيار الخدمات، يلزم إعداد الأسرار واختبارات بيئة المزود والتحقق من إعادة المحاولات وwebhooks والتسليم قبل فتح التشغيل الحقيقي.


## انتقال PostgreSQL

اتصال دائم عبر `DATABASE_URL` على السيرفر؛ الأدوار والقوالب تتهيأ لأول مرة. الديمو يظل SQLite داخل الذاكرة معزولًا عن القاعدة الدائمة، ولا تُرحَّل بياناته. إنشاء المالك على Vercel محمي بـ`CLINIC_SETUP_TOKEN` (32 حرفًا على الأقل)؛ يُدخله المالك بنفسه ولا تحفظه في Git. لا يجوز استخدام حسابات الاختبار المحلية في الإنتاج.

التنبيهات المجدولة تقبل PostgreSQL عند ضبط السر ووجود الاتصال الدائم، لكن خدمة الجدولة والبريد والدفع والرسائل لم تُفعّل. أدوات SQLite خاصة بالتطوير؛ استخدم مسار PostgreSQL أعلاه، وفعل سياسة النسخ واختبر الاستعادة على قاعدة منفصلة قبل التشغيل الطبي الفعلي. قائمة قبول الديمو لا تكفي لإعلان الجاهزية التشغيلية.
