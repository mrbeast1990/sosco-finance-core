# خطة العمل: المسحوبات + الأصول + تحديث المصروفات

سأضيف وحدتين جديدتين ووسّع نظام المصروفات. كل التغييرات آمنة على البيانات الموجودة وتحافظ على التصميم العربي/RTL والصلاحيات والـ Audit Log.

---

## 1) قاعدة البيانات (Migration واحدة)

### حسابات جديدة في `accounts`
- `1020` البنك (نوع أصول، فرعي)
- `1500` الأصول الثابتة (نوع أصول، رئيسي)
- `3100` مسحوبات الشركاء/المالكين (نوع حقوق ملكية)

### جدول `owner_withdrawals`
كل الحقول المطلوبة + `withdrawal_no` يولّد تلقائياً من sequence (`WD-1`, `WD-2`, ...).

### جدول `assets`
كل الحقول المطلوبة + `asset_code` فريد.

### تعديل `expenses`
- إضافة `expense_scope text not null default 'project'`
- إضافة `asset_id uuid` (nullable)
- إضافة `asset_expense_type text` (nullable)
- إضافة `asset_cost_treatment text` (nullable)
- تحديث السجلات الموجودة: `expense_scope = 'project'` (الافتراضي يغطيها)
- إزالة قيد NOT NULL عن `project_id` ليسمح بـ general/asset

### الصلاحيات الجديدة (insert in `permissions`)
`withdrawals.view/create/update/approve/cancel/delete/reports`
`assets.view/create/update/delete/reports`
+ ربطها بدور admin تلقائياً.

### دوال SECURITY DEFINER جديدة
- `create_withdrawal_atomic(...)` — ينشئ السجل بحالة draft فقط
- `approve_withdrawal_atomic(_id)` — يولّد القيد المحاسبي ويغيّر الحالة لـ approved
- `cancel_withdrawal_atomic(_id, _reason)` — لو كانت approved يعكس القيد
- تعديل `create_expense_atomic` لقبول `_expense_scope`, `_asset_id`, `_asset_expense_type`, `_asset_cost_treatment`:
  - scope=project ⇒ يتطلب project_id
  - scope=asset ⇒ يتطلب asset_id، ولو treatment=capital_improvement يستخدم حساب 1500 + يزيد `assets.current_value`
  - scope=general ⇒ لا project ولا asset

### RLS
كل الجداول الجديدة: `has_permission(auth.uid(), '...')` لكل عملية. لا `USING (true)` على الجداول الحساسة.

### Storage
استخدام bucket `expense-attachments` الموجود نفسه لمرفقات السحوبات والأصول (لتقليل التغييرات).

---

## 2) الواجهة الأمامية

### Sidebar (`AppSidebar.tsx`)
إضافة بندين في مجموعة "العمليات المالية":
- المسحوبات → `/withdrawals` (perm: `withdrawals.view`)
- الأصول → `/assets-registry` (perm: `assets.view`)

### صفحات جديدة
- `src/routes/_authenticated/withdrawals.tsx` — قائمة + فلاتر (تاريخ، شخص، دور، طريقة دفع، حالة، مشروع) + بطاقات إجماليات + Dialog إنشاء/تعديل + أزرار اعتماد/إلغاء + رفع مرفق.
- `src/routes/_authenticated/assets-registry.tsx` — قائمة الأصول + Dialog إنشاء/تعديل + Dialog تفاصيل (معلومات + قيمة شرائية + قيمة حالية + إجمالي مصروفات تشغيلية + إجمالي تحسينات رأسمالية + سجل المصروفات).

### تحديث نموذج المصروف (`expenses.tsx`)
إضافة حقل **نوع الارتباط** (RadioGroup أو Select) في الأعلى:
- مشروع (افتراضي — يحافظ على السلوك الحالي)
- أصل → يظهر منتقي الأصول + نوع المصروف + المعالجة (تشغيلي/تحسين رأسمالي)
- مصروف عام → يخفي الكل

إضافة عمود "النطاق" في جدول المصروفات + فلتر.

### Dashboard (`dashboard.tsx`)
بطاقات إضافية:
- إجمالي مصروفات المشاريع
- إجمالي مصروفات الأصول التشغيلية
- إجمالي المصروفات العامة
- إجمالي المسحوبات
- إجمالي التحسينات الرأسمالية
- صافي الربح التشغيلي

### تحديث `types.ts`
سيتم تجديده تلقائياً بعد الـ migration.

---

## 3) الأمان والـ Audit
- كل عملية (create/update/approve/cancel/delete) على المسحوبات والأصول تُسجَّل في `audit_log` عبر الدوال atomic.
- صلاحية `withdrawals.approve` مستقلة عن `withdrawals.create` (فصل المهام).

---

## 4) خطوات التنفيذ

1. **Migration** واحدة شاملة (جداول + حسابات + صلاحيات + دوال + RLS).
2. تحديث `AppSidebar.tsx`.
3. إنشاء صفحتي `withdrawals.tsx` و`assets-registry.tsx`.
4. تحديث `expenses.tsx` بحقل النطاق والمنطق المرتبط.
5. تحديث `dashboard.tsx` بالبطاقات الجديدة.
6. التحقق من الـ build.

---

## ملاحظات مهمة
- لن أعدّل ملفات `client.ts` / `types.ts` يدوياً.
- البيانات الموجودة آمنة: الـ default `'project'` يغطي السجلات القديمة.
- لن ألمس `journal_entries`/`journal_lines` schema — أستخدمها كما هي.
- التقارير التفصيلية للمسحوبات/الأصول سأضيفها كأقسام داخل صفحة `reports.tsx` (filter حسب النوع) بدلاً من صفحات منفصلة، للحفاظ على البساطة.

هل توافق على هذه الخطة؟
