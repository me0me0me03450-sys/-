# منصة نداء — شركة تربية الأجيال الأهلية

منصة إلكترونية متكاملة لإدارة استدعاء وخروج الطالبات لصالح **شركة تربية الأجيال الأهلية**، مصممة بواجهات عربية متجاوبة باتجاه RTL، مع فصل كامل بين واجهة ولي الأمر والواجهة الداخلية للموظفات، وعزل صلاحيات مراقبة الدور لكل مرحلة.

---

## الروابط الرئيسية

- **واجهة ولي الأمر:** `/` (بدون أي روابط أو أيقونات تخص الموظفات)
- **البوابة الداخلية للموظفات:** `/staff`
- **مراقبة الدور:** `/staff/queue` (مقيدة تلقائياً بقسم الموظفة المسجّلة)
- **إدارة النظام (Super Admin):** `/staff/admin`

---

## البنية التقنية للمشروع

```text
├── server.ts                        # خادم Express API + SSE Realtime + Vite
├── server/
│   ├── db.ts                        # طبقة تخزين دائمة على الخادم للجداول الـ 9
│   └── security.ts                  # تشفير scrypt + توقيع الجلسات + Rate Limiting
├── src/
│   ├── components/                  # الشعار الرسمي والتذييل الموحد
│   ├── services/
│   │   ├── apiClient.ts             # عميل الواجهات + التزامن اللحظي (SSE / Supabase)
│   │   ├── supabaseClient.ts        # تهيئة عميل Supabase الرسمي
│   │   └── reportExportService.ts   # استيراد وتصدير Excel (.xlsx) و Word (.docx)
│   ├── types/nidaa.ts               # النماذج البرمجية المطابقة لجداول قاعدة البيانات
│   ├── utils/formatters.ts          # التوقيت بتوقيت Asia/Riyadh وحساب مدة الانتظار
│   └── views/                       # الواجهات الأربع
├── supabase/
│   ├── migrations/                  # ملفات إنشاء قاعدة البيانات و RLS و الدوال
│   └── functions/parent-pickup/     # Edge Function للتحقق من ولي الأمر
├── public/_redirects                # توجيه SPA لمنصة Cloudflare Pages
└── .env.example                     # متغيرات البيئة المطلوبة (بدون أسرار)
```

---

## الجداول المعتمدة في PostgreSQL / Supabase

1. `sections` — الأقسام (الروضة، الابتدائي، المتوسط والثانوي، الدبلومة، وغيرها)
2. `grades` — الصفوف الدراسية داخل كل قسم
3. `classrooms` — الفصول الدراسية داخل كل صف
4. `students` — الطالبات (الرقم السري مشفّر بـ Hash ولا يُحفظ كنص مكشوف)
5. `staff_accounts` — حسابات مديرة النظام ومراقبات الدور (كلمات المرور مشفّرة)
6. `pickup_requests` — طلبات النداء مع أوقات الخادم الفعلية بتوقيت `Asia/Riyadh`
7. `audit_logs` — سجل التدقيق لجميع العمليات الإدارية وتحديثات النداء
8. `academic_years` — الأعوام الدراسية
9. `settings` — الإعدادات العامة وحدود محاولات التحقق المتكررة

---

## التشغيل المحلي

```bash
npm install
cp .env.example .env
npm run dev
```

سيعمل الخادم على المنفذ `3000` (`http://localhost:3000`).

---

## الربط مع Supabase Free

1. أنشئ مشروعاً مجانياً على [Supabase](https://supabase.com).
2. من **SQL Editor** نفّذ الملفين بالترتيب:
   - `supabase/migrations/001_nidaa_schema.sql`
   - `supabase/migrations/002_rls_and_functions.sql`
3. انشر دالة التحقق (اختياري للواجهات السحابية المباشرة):
   ```bash
   supabase functions deploy parent-pickup
   ```
4. انسخ `Project URL` و `anon public key` وأضفها في متغيرات البيئة:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

---

## الربط مع GitHub (مستودع عام)

```bash
git init
git add .
git commit -m "Initial Nidaa production platform"
git branch -M main
git remote add origin https://github.com/me0me0me03450-sys/-.git
git push -u origin main
```

> تنبيه أمني: ملف `.gitignore` يستبعد `.env*` و مجلد `data/` تلقائياً حتى لا تُرفع أي بيانات طالبات أو مفاتيح سرية إلى GitHub.

---

## حالة النشر الحالية
المشروع الحالي ليس تطبيقاً ثابتاً يصلح نشره على Cloudflare Pages وحدها. ملف `server.ts` يشغّل خادم Express ومسارات `/api/*` واتصالاً لحظياً عبر SSE، بينما `npm run build` ينشئ ملفات الواجهة فقط.
كما أن `server/db.ts` يحفظ البيانات في ملفات محلية داخل `data/`؛ لذلك يحتاج التشغيل الفعلي إلى استضافة تدعم عملية Node.js مستمرة وقرصاً دائماً قابلاً للكتابة. الاستضافة التي تحذف الملفات عند إعادة التشغيل قد تفقد بيانات النداءات والحسابات.
**قبل تشغيله للمدرسة:** انشريه على خادم Node مع قرص دائم، واضبطي `NIDAA_SESSION_SECRET` و`NIDAA_ADMIN_PASSWORD` كأسرار في إعدادات الاستضافة، واتركي `NIDAA_TRUST_PROXY_HOPS` فارغاً إلا إذا عرفتِ عدد البروكسيات الموثوقة أمام الخادم.
أما تشغيله كلياً على Cloudflare Pages فيتطلب نقل API وSSE والتخزين إلى خدمات مناسبة مثل Workers وقاعدة بيانات، أو إكمال ربط التطبيق بـ Supabase. وجود ملفات الترحيل ودالة Supabase بالمستودع وحده لا يعني أن خادم Express الحالي يستخدمها لتخزين بياناته.
---
مهندسة النظم : موضي البديني  
شركة تربية الأجيال الأهلية
