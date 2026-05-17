# خطة تحويل SOSCO إلى PWA + Offline-First

## ⚠️ ملاحظات حرجة قبل البدء

1. **PWA لا يعمل في معاينة Lovable** (iframe). جميع ميزات الأوفلاين والتثبيت ستعمل فقط على `sosco-finance-core.lovable.app` بعد النشر.
2. **الكتابة أوفلاين في نظام محاسبي = خطر مقبول لكن موثق**: المستخدم يفهم أن:
   - الـ RPCs الذرية (`create_expense_atomic`) ستتحقق من الأرصدة **عند المزامنة**، ليس عند الإنشاء أوفلاين
   - إذا أنشأ مستخدمان مصروفاً من نفس الصك أوفلاين، الأول ينجح والثاني يفشل عند المزامنة
   - الفشل يُحفظ في الطابور مع رسالة الخطأ، ولا يدخل قاعدة البيانات
3. **لن نلمس** الـ RPCs، الـ RLS، أو منطق المحاسبة. فقط طبقة عميل.

---

## النطاق (V1)

### 1. PWA Shell
- إضافة `vite-plugin-pwa` + `workbox`
- `manifest.webmanifest` (اسم عربي، أيقونة، display: standalone، theme color)
- توليد أيقونتي PWA (192px, 512px)
- Service Worker مع استراتيجيات:
  - HTML navigations: `NetworkFirst` (3s timeout)
  - JS/CSS/fonts: `StaleWhileRevalidate`
  - Supabase REST API (GET): `NetworkFirst` مع cache 24h
- **حماية ضد iframe/preview**: عدم تسجيل SW على `id-preview-*` أو داخل iframe
- `devOptions.enabled: false` (لا يعمل في dev)

### 2. تخزين القراءة أوفلاين
- تثبيت `@tanstack/query-sync-storage-persister` + `@tanstack/react-query-persist-client`
- استخدام `localStorage` (بسيط، يكفي لحجم بيانات سوسكو الحالي)
- مدة `maxAge`: 7 أيام
- مفاتيح القراءة الحالية (dashboard, expenses, funders, projects, journal-entries, reports) تُحفظ تلقائياً

### 3. طابور كتابة (Write Queue) — أوفلاين فقط
**النطاق محصور**:
- ✅ إنشاء مصروف جديد (`expenses.create`)
- ✅ إنشاء صك تمويل جديد (`funding.create`)
- ❌ **التعديل والحذف معطّلان أوفلاين** (رسالة: "يتطلب اتصال إنترنت")
- ❌ رفع الملفات (صور الصكوك/الفواتير) معطّل أوفلاين

**التنفيذ**:
- مكتبة `idb-keyval` لتخزين الطابور في IndexedDB
- ملف `src/lib/offline-queue.ts`:
  - `enqueue(op)`, `processQueue()`, `getQueue()`, `removeItem(id)`
- العمليات المُخزّنة تحمل: `id, type, payload, createdAt, attempts, lastError`
- عند العودة للأونلاين (`window.addEventListener('online')`): تشغيل تلقائي للطابور
- زر يدوي "مزامنة الآن" في الـ Header

### 4. مؤشرات UI
- **شارة في الـ Header**: 
  - 🟢 متصل / 🔴 أوفلاين
  - عداد العمليات المعلقة (مثلاً "3 معلقة")
- **شاشة الطابور** (`/offline-queue`): قائمة بالعمليات المعلقة + الفاشلة، مع زر "إعادة المحاولة" و"حذف"
- Toast عند نجاح/فشل المزامنة لكل عملية

### 5. سلوك خاص أوفلاين
- في صفحة المصروفات/الصكوك: عند الإرسال أوفلاين → يُحفظ في الطابور + toast "سيتم الإرسال عند عودة الاتصال" + لا يظهر في القائمة (لأن البيانات الحقيقية تأتي من Supabase)
- صفحة الطابور تُظهر المعلق

---

## الملفات المتأثرة

**جديدة**:
- `public/manifest.webmanifest`
- `public/icon-192.png`, `public/icon-512.png` (مولّدة)
- `src/lib/offline-queue.ts`
- `src/lib/use-online-status.ts`
- `src/components/OfflineBadge.tsx`
- `src/components/PWAProvider.tsx` (تسجيل SW + persistence)
- `src/routes/_authenticated/offline-queue.tsx`

**معدّلة (بحذر، إضافات فقط)**:
- `package.json` — إضافة `vite-plugin-pwa`, `idb-keyval`, `@tanstack/react-query-persist-client`, `@tanstack/query-sync-storage-persister`
- `vite.config.ts` — إضافة plugin PWA
- `src/routes/__root.tsx` — تركيب PWAProvider + روابط manifest
- `src/routes/_authenticated.tsx` — إضافة OfflineBadge في الـ Header
- `src/routes/_authenticated/expenses.tsx` — التقاط الإرسال إذا أوفلاين → enqueue
- `src/routes/_authenticated/funders.$funderId.tsx` — نفس الشيء لإنشاء الصكوك
- `src/components/AppSidebar.tsx` — رابط "العمليات المعلقة"

**لن نلمس**:
- ❌ أي شيء في `supabase/migrations/`
- ❌ الـ RPCs
- ❌ RLS
- ❌ `src/integrations/supabase/*`
- ❌ منطق المصادقة

---

## ما لن يعمل أوفلاين (مقبول)
- التعديل والحذف
- رفع المرفقات (صور صكوك / Excel)
- التقارير الجديدة (تعتمد على بيانات لحظية)
- مركز التدقيق (يتطلب فحص لحظي)
- صفحات الإدارة (الصلاحيات، المستخدمين)

---

## مخاطر متبقية (موثقة)

| الخطر | التخفيف |
|---|---|
| مستخدمان يستهلكان نفس الصك أوفلاين | الـ RPC يرفض الثاني عند المزامنة، الخطأ يظهر في شاشة الطابور |
| تجاوز رصيد عند المزامنة | نفس الشيء — الـ RPC يحمي |
| الـ session ينتهي أثناء عمل أوفلاين | المزامنة تفشل، المستخدم يسجل دخول، يضغط "إعادة المحاولة" |
| المستخدم يحذف من جهاز آخر بينما الأول يعمل أوفلاين | عند المزامنة قد يفشل (الصك محذوف)، خطأ واضح |
| طابور ضخم في حالة انقطاع طويل | محدود بـ 100 عملية، تحذير عند الـ50 |

---

## التحقق بعد التنفيذ
1. بناء ناجح
2. تشغيل التطبيق أونلاين → كل شيء يعمل كالعادة
3. قطع الإنترنت في DevTools → الشارة تتحول 🔴، التنقل يعمل، البيانات المحفوظة تظهر
4. تسجيل مصروف أوفلاين → يدخل الطابور
5. إعادة الاتصال → مزامنة تلقائية + toast نجاح
6. في النسخة المنشورة: تثبيت التطبيق من المتصفح

هل تعتمد الخطة؟