# نظام مجمع أم القرى

Current development status: [development checklist](docs/DEVELOPMENT-CHECKLIST.md).


تطبيق عربي بـ Next.js وReact وSQLite، على Node.js 22. المستودع الشخصي: https://github.com/mahmoud2391997/um-al-qura-clinic-system

## التشغيل المحلي

```sh
npm install
npm run dev
```

عند أول تشغيل، أنشئ حساب المالك؛ لا توجد كلمة مرور افتراضية. قاعدة البيانات المحلية في `data/clinic.sqlite` مستبعدة من Git. الديمو عبر `/?demo=1` يستخدم بيانات وهمية مستقلة داخل الذاكرة، مع 13 دورًا تجريبيًا. التغييرات مشتركة بين زوار الديمو وتُصفّر عند إعادة تشغيل السيرفر أو تشغيل نسخة أخرى.

## الوظائف المنفذة

- حسابات الموظفين وأدوار وصلاحيات قابلة لتعديل المالك، تحقق على السيرفر، جلسة HttpOnly وكلمات مرور scrypt وسجل تدقيق.
- تسجيل المرضى وتنبيه التكرار، المواعيد وكشف التعارض والحضور وأوقات الخدمة، تقويم يومي وأسبوعي، نقل الموعد بسبب موثق وقائمة انتظار مع حجز مرة واحدة.
- تقييم وخطة وجلسات وإعادة تقييم وخروج مرتبط بالحالة؛ قياس ألم وقياسات مسماة بوحداتها، مقارنة البداية والحالي، مراجعة العلامات التحذيرية وتوثيق الإجراء. الاعتماد يقفل السجل؛ التصحيح بإضافة موثقة، والخروج المعتمد يقفل الحالة.
- فواتير وتحصيل واسترداد وخصومات ووسائل دفع، وحدود مالية يضبطها المالك وإقفال صندوق بتوقيت عمان. بيع الباقة ينشئ فاتورة مرة واحدة؛ الدفع عملية مستقلة، وخصم الجلسة مرة واحدة عند إتمام الموعد.
- الأجهزة والعدادات وسجل استخدام، منع الأجهزة المتوقفة أو ذات العطل الحرج، سجل استبدال قطع يحفظ العداد القديم ويبدأ الجديد، بلاغ صيانة وقطع وتكلفة ومدة توقف.
- المخزون ودفعاته وصلاحيتها والصرف من الأقرب انتهاءً مع استبعاد المنتهي، وتخصيص الدفعات في سجل الحركة. اعتماد الجلسة يخصم عدة أجهزة ومستهلكات بمعاملة ذرية، ويمنع تكرار الخصم.
- طلبات شراء ومسودات وإرسال واعتماد منفصل عن مقدم الطلب، حدود مبالغ، عروض موردين واعتمادها وأوامر شراء، استلام جزئي يضيف دفعة دون تجاوز المتبقي أو تكرار العملية. مرفقات مشتريات وفواتير موردين وسداد مرتبط بمصروف، مع حماية اليوم النقدي المقفل.
- التراخيص وسجل نسخ التجديد، الالتزامات وسجل السداد وترحيل الاستحقاق الشهري/السنوي مع ضبط نهاية الشهر. واجهة السداد ترسل الاستحقاق المعروض لمنع تكرار سداد نفس الفترة.
- تنبيهات انخفاض المخزون والصلاحية والتراخيص والاستحقاقات والعدادات، وحدود يضبطها المالك؛ مهام متكررة يمكن إيقافها وتصعيد المتأخر، ومنع تكرار المهام لنفس الحدث. زوال الحالة يغلق مهمة التنبيه تلقائيًا.
- تكلفة جلسة محفوظة عند الاعتماد: زمن الممارس وسعر ساعته، تكلفة الدفعة المصروفة، استهلاك رأس الجهاز وحصة التشغيل. التقرير يبيّن نقص الزمن أو سعر الممارس؛ تغيير السعر لاحقًا لا يغيّر التكلفة التاريخية.
- الحملات والاستفسارات ونسبة المريض لحملة واحدة، صافي التحصيل منذ النسبة بعد الاسترداد وعائد الحملة، الشكاوى والرضا والإجراءات الوقائية مع دليل إتمام.
- تقارير وتصدير CSV بصلاحية مستقلة، مع حماية من صيغ الجداول وعدم تصدير كلمات المرور. التوثيق السريري والمهام والمشتريات والتنبيهات لها قيود نطاق بحسب الحساب والصلاحية.
- واجهات جداول مع البحث والترتيب والتصفح، نماذج إضافة مغلقة افتراضيًا، قائمة جانبية مقسمة بأيقونات وطي وتوسيع وفتح/قفل جميع الأقسام.

## التحديث الأخير والحدود المتبقية

- قوالب تخصص قابلة للتعديل، وبرنامج منزلي منظم بجرعات وتكرار وتعليمات وروابط HTTPS، وتنزيل نصي بعد الاعتماد ومتابعة الالتزام. القوالب لا تختار العلاج تلقائيًا؛ الإرسال الخارجي غير مفعل.
- مرفقات إدارية وسريرية وتراخيص منفصلة، مع تحقق صلاحيات وبصمة نوع الملف: PDF/PNG/JPEG حتى 2 ميجابايت وعشرة ملفات لكل مرجع وثلاثين ميجابايت إجمالًا في الديمو. فحص البرمجيات الخبيثة والتخزين الخارجي غير مفعلين.
- طلبات خصم واسترداد معلقة بمراجعة شخص آخر، وإعادة فحص الرصيد والحدود قبل التنفيذ ومنع تكرار الاعتماد. تصحيح النقد المعدود بعد الإقفال للمالك بسجل مستقل ومرجع يمنع التكرار؛ الإقفال الأصلي وحركات اليوم تظل محفوظة ومقفلة. هذا لا يعيد فتح اليوم أو يصحح حركاته القديمة. رد جلسة الباقة متاح بطلب ومراجعة موظف آخر، ويعيد الرصيد مرة واحدة مع حفظ الخصم الأصلي.
- نطاق المرضى والمواعيد والملف السريري لكل دور يضبطه المالك: الجميع أو السجلات المرتبطة بالحساب؛ الافتراضي للممارسين المرتبط فقط، ويشمل التصدير والمرفقات. المهام والمشتريات تحت نطاقهما القائم، وبقية الوحدات تحت صلاحيات وحدتها. بعض أسماء ممارسي المواعيد القديمة في الديمو نصوص لا معرفات حسابات.
- حظر مؤقت بعد خمس محاولات دخول فاشلة في ربع ساعة، وإبطال الجلسات بواسطة المالك وعند تغيير كلمة المرور أو الدور أو تعطيل الحساب. إعادة تعيين كلمة المرور بواسطة المالك متاحة؛ مسار استعادة البريد الذاتية جاهز واختُبر، لكنه يحتاج خدمة بريد مُعدّة؛ الديمو لا يرسل بريدًا. أداة النسخ الاحتياطي المشفر والاستعادة لملف جديد اختُبرت محليًا، ولم تُفعّل جدولة أو تخزين نسخ خارجي.
- ربط الجلسة المعتمدة بفاتورة للمريض نفسه وحصة لا تتجاوز قيمة الفاتورة، مع منع تكرار الربط. التحصيل الصافي يوزع نسبيًا على حصص الجلسات بعد الخصم والاسترداد. التقرير يعرض التحصيل المنسوب والفرق عن التكلفة. هذا توزيع نسبي، وليس إسناد كل عملية دفع إلى جلسة محددة أو محاسبة شاملة. نسبة الحملة للمريض لا تدعم إعادة النسبة التاريخية أو نسبة متعددة.
- الأتمتة تعمل عند استخدام النظام؛ لا تشغيل مجدول عندما يكون مغلقًا. يلزم تخزين دائم ومجدول موثوق للتشغيل الحقيقي، مع بقاء الديمو في الذاكرة حسب الاتفاق.
- الإرسال والدفع الخارجي غير مفعلين؛ يوجد طابور محلي يمنع تكرار الطلب، دون ناقل خارجي أو webhook. يلزم اختيار المزودين وإعداداتهم.
- سجل التدقيق تطبيقي ويمكن لمسؤول قاعدة البيانات تعديل التخزين. التحصيل القديم لا يتحول تلقائيًا إلى حركات تاريخية. هذه نسخة تطوير وديمو، وليست إعلانًا باكتمال متطلبات التشغيل الطبي.

## التحقق والنشر

```sh
npm test
npm run build
```

الاختبارات الحالية (71) تستخدم قاعدة داخل الذاكرة، وتشمل الصلاحيات والاعتماد والذرية ومنع التكرار وتوقيت عمان والدفعات والمشتريات والسداد والأتمتة والتجديدات والتكلفة والتصدير. إعداد Vercel ينفذ الاختبارات قبل البناء، مع `CLINIC_DEMO=1` و`CLINIC_DEMO_ONLY=1`؛ التسجيل الحقيقي غير متاح في هذا النشر.

النشر التلقائي مرتبط بالفرع الرئيسي. GitHub Actions متوقف بسبب فوترة حساب GitHub، بصورة منفصلة عن اختبارات بناء Vercel. لا حاجة لقاعدة خارجية للديمو المؤقت حسب الاتفاق؛ تشغيل بيانات المجمع الدائمة يحتاج قرارًا منفصلًا للتخزين والاستضافة والنسخ الاحتياطي.

تفاصيل إعداد الاستعادة والنسخ والتصحيحات والجدولة واختبار الرحلة في [OPERATIONS.md](OPERATIONS.md).

## PostgreSQL ونيون

التطبيق يدعم `DATABASE_URL` على السيرفر. عند إعداد الاتصال يُنشأ مخطط PostgreSQL مرة واحدة مع الأدوار والقوالب؛ لا تُنقل ملفات SQLite المحلية أو بيانات الديمو إلى القاعدة الدائمة تلقائيًا. بيانات الدخول هي حسابات الموظفين، وليست بيانات اتصال القاعدة. يبقى زر الديمو بقاعدة مستقلة مؤقتة، وزر «الدخول بحساب المجمع» يعود إلى حسابات القاعدة الدائمة.

قبل التشغيل الفعلي على Vercel: صِل قاعدة Neon المجانية بالمشروع، واضبط `CLINIC_SETUP_TOKEN` بسر عشوائي طويل لتأمين أول إنشاء لحساب المالك. يُدخل المالك الرمز وكلمة مروره بنفسه. لا توجد كلمة مرور افتراضية. إذا غاب اتصال PostgreSQL، يبقى نشر Vercel للديمو ولا يسمح بإنشاء حساب فعلي داخل الذاكرة.

### الاختبار المحلي

قاعدة Docker الخاصة بهذا المشروع تستمع على `127.0.0.1:55432`، وملفات اتصالها في `.env.postgres.local` و`.local/` مستبعدة من Git. لتشغيل الواجهة بالوضعين:

```sh
node scripts/start-postgres-local.mjs dev --hostname 127.0.0.1 --port 3034
```

اختبار PostgreSQL يستخدم مخططًا منفصلًا ويلغيه بمعاملة بعد كل اختبار، ويرفض أي اتصال خارج الجهاز:

```sh
CLINIC_TEST_POSTGRES=1 node --env-file=.env.postgres.local --test tests/postgres.test.js
```

حسابات اختبار الرحلة تُنشأ فقط على قاعدة محلية خالية من المرضى. بياناتها تُحفظ في ملف محلي مستبعد، ولا تُنشر:

```sh
node --env-file=.env.postgres.local scripts/seed-postgres-test.mjs
CLINIC_ACCEPTANCE_REAL=1 CLINIC_ACCEPTANCE_BASE=http://127.0.0.1:3034 npm run test:acceptance
```

عمليات PostgreSQL تنفذ داخل معاملة واتصال واحد لكل طلب. قفل على مستوى المجمع يمنع تضارب الاعتمادات والأرصدة بين نسخ السيرفر؛ يحد ذلك من التوازي، ويمكن استبداله بأقفال على السجلات بعد قياس الأحمال. أدوات النسخ المشفر الحالية خاصة بـSQLite؛ يلزم إعداد النسخ والاستعادة الخاصة بـPostgreSQL قبل التشغيل الفعلي.

## English — development and operations

Use Node.js 22, `npm ci`, then `npm run dev` and open http://127.0.0.1:3000. Local SQLite data lives in `data/clinic.sqlite`; demo data is separate and synthetic. On an empty installation, the owner creates the first account. There is no default password. `.env.example` lists application/test settings without credentials; copy only the settings needed for the chosen environment into a private, ignored file. A real environment requires PostgreSQL and the checks in `scripts/check-env.mjs`.

Architecture: Next.js 16 App Router + React 19, with an Arabic-first interface and core English support. The catch-all API delegates to `lib/api-handlers`; domain services use the SQLite/PostgreSQL adapters. `lib/endpoint-policy.js` is the explicit method/path registry, re-exported by `lib/api-audit-policy.js`. New routes must be classified and pass the inventory and HTTP denial matrix. `docs/DEVELOPMENT-CHECKLIST.md` records requirements reconciliation; `docs/hardening/` contains task-specific evidence and limitations.

Validation commands:

```sh
npm test
# Disposable loopback PostgreSQL only; never use production credentials:
CLINIC_TEST_POSTGRES=1 DATABASE_URL='<disposable local test URL>' npm test
CLINIC_SECURITY_ACCEPTANCE=1 npm run test:audit
npm run lint
npm run format:check
npm run build
npm run test:backup-postgres
npm run test:ui-matrix
```

Formatting/lint coverage is intentionally scoped to the new hardening files in `quality-files.json`; this does not certify the legacy UI/source. After a reviewed router change, update its source fingerprint with `node scripts/update-router-fingerprint.mjs`, then rerun inventory and HTTP acceptance. Do not update a fingerprint merely to bypass an unexplained test failure.

Security model: server-side role grants and patient/practitioner scopes remain authoritative. Cookie mutations require same-origin requests; scheduler endpoints require a separate secret. Production cookies are Secure, HttpOnly and SameSite=Strict. Account and authenticated-proxy-IP throttles resist repeated failures; configure matching `CLINIC_TRUSTED_PROXY_TOKEN` values in the private clinic/gateway settings. Unauthenticated forwarding headers are ignored. API errors reflect only a static public vocabulary. The audit writer hashes each link; a database administrator can still replace the history, so independent anchoring is required for stronger assurance.

Attachments remain quarantined until clean scanning and a matching content digest are recorded. Configure a local `CLINIC_CLAMAV_SOCKET` and rescan with `node scripts/scan-attachments.mjs`; scanner/storage providers are not enabled automatically. Owner-created invitations require `CLINIC_INVITATION_TTL_MINUTES`. Staff capacity uses explicit owner-entered work/time-off intervals; there are no default working hours. Outbox delivery requires an operator-controlled transport module plus all retry settings; unknown delivery outcomes are held for reconciliation.

Production backup/restore uses PostgreSQL through `infra/backup.sh` and `infra/restore-drill.sh`; the SQLite tool is legacy/development. The synthetic automated drill uses isolated containers and temporary keys. Offsite destination, retention, schedules, TLS, clinic policies and user acceptance require separate configuration and verification. `sh infra/check-copies.sh` checks copied infrastructure content before release; drift is an error, not silently synchronized across unrelated repositories.
