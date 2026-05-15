
-- =========================================================================
-- SOSCO Phase 2: Funding refactor, RBAC, atomic accounting engine
-- =========================================================================

-- 0. Drop old triggers / functions that we're replacing
DROP TRIGGER IF EXISTS trg_validate_expense_balance ON public.expenses;
DROP TRIGGER IF EXISTS trg_create_expense_journal ON public.expenses;
DROP FUNCTION IF EXISTS public.validate_expense_balance() CASCADE;
DROP FUNCTION IF EXISTS public.create_expense_journal() CASCADE;

-- =========================================================================
-- 1. RBAC core tables
-- =========================================================================
CREATE TABLE public.roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  module TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.role_permissions (
  role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- Seed roles
INSERT INTO public.roles (code, name, description, is_system) VALUES
  ('admin',           'مدير النظام',     'صلاحيات كاملة على النظام',            true),
  ('finance_manager', 'مدير مالي',       'إدارة التمويل واعتماد المصروفات',     true),
  ('accountant',      'محاسب',           'تسجيل المصروفات والقيود اليومية',     true),
  ('viewer',          'مشاهد',           'صلاحية القراءة فقط',                  true);

-- Seed permissions
INSERT INTO public.permissions (code, name, module) VALUES
  -- projects
  ('projects.view',   'عرض المشاريع',    'projects'),
  ('projects.create', 'إنشاء مشروع',     'projects'),
  ('projects.edit',   'تعديل مشروع',     'projects'),
  ('projects.delete', 'حذف مشروع',       'projects'),
  -- funders
  ('funders.view',    'عرض الممولين',    'funders'),
  ('funders.create',  'إنشاء ممول',      'funders'),
  ('funders.edit',    'تعديل ممول',      'funders'),
  ('funders.delete',  'حذف ممول',        'funders'),
  -- funding checks
  ('funding.view',    'عرض الصكوك',      'funding'),
  ('funding.create',  'إضافة صك تمويل',  'funding'),
  ('funding.edit',    'تعديل صك',        'funding'),
  ('funding.delete',  'حذف صك',          'funding'),
  ('funding.approve', 'اعتماد التمويل',  'funding'),
  -- expenses
  ('expenses.view',    'عرض المصروفات',   'expenses'),
  ('expenses.create',  'تسجيل مصروف',     'expenses'),
  ('expenses.edit',    'تعديل مصروف',     'expenses'),
  ('expenses.delete',  'حذف/عكس مصروف',   'expenses'),
  ('expenses.approve', 'اعتماد مصروف',    'expenses'),
  -- journal
  ('journal.view',    'عرض القيود',      'journal'),
  ('journal.create',  'إنشاء قيد',       'journal'),
  -- accounts
  ('accounts.view',   'عرض الحسابات',    'accounts'),
  ('accounts.manage', 'إدارة شجرة الحسابات', 'accounts'),
  -- reports
  ('reports.view',    'عرض التقارير',    'reports'),
  -- users / settings
  ('users.view',      'عرض المستخدمين',  'users'),
  ('users.manage',    'إدارة المستخدمين والصلاحيات', 'users'),
  ('settings.view',   'عرض الإعدادات',   'settings'),
  ('settings.manage', 'إدارة الإعدادات', 'settings'),
  -- categories & cash accounts
  ('categories.manage', 'إدارة فئات المصروفات', 'settings'),
  ('cash.manage',       'إدارة حسابات الصندوق',  'settings');

-- Default role-permission mappings
-- Admin: all
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p WHERE r.code = 'admin';

-- Finance Manager: everything except user/settings management
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r, public.permissions p
WHERE r.code = 'finance_manager'
  AND p.code IN (
    'projects.view','projects.create','projects.edit',
    'funders.view','funders.create','funders.edit',
    'funding.view','funding.create','funding.edit','funding.approve',
    'expenses.view','expenses.create','expenses.edit','expenses.approve',
    'journal.view','journal.create',
    'accounts.view',
    'reports.view',
    'settings.view','categories.manage','cash.manage'
  );

-- Accountant: operational data entry
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r, public.permissions p
WHERE r.code = 'accountant'
  AND p.code IN (
    'projects.view',
    'funders.view',
    'funding.view',
    'expenses.view','expenses.create','expenses.edit',
    'journal.view','journal.create',
    'accounts.view',
    'reports.view'
  );

-- Viewer: read-only
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r, public.permissions p
WHERE r.code = 'viewer'
  AND p.code IN (
    'projects.view','funders.view','funding.view','expenses.view',
    'journal.view','accounts.view','reports.view'
  );

-- =========================================================================
-- 2. Profiles extension
-- =========================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE u.id = p.id AND p.email IS NULL;

-- =========================================================================
-- 3. Migrate user_roles from enum to FK
-- =========================================================================
-- Temporarily preserve old role -> remap to roles.id
ALTER TABLE public.user_roles ADD COLUMN role_id UUID REFERENCES public.roles(id) ON DELETE CASCADE;

UPDATE public.user_roles ur
SET role_id = r.id
FROM public.roles r
WHERE r.code = ur.role::text;

-- Drop old policies + column
DROP POLICY IF EXISTS user_roles_admin_all ON public.user_roles;
DROP POLICY IF EXISTS user_roles_select_authenticated ON public.user_roles;

ALTER TABLE public.user_roles DROP COLUMN role;
ALTER TABLE public.user_roles ALTER COLUMN role_id SET NOT NULL;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_role_unique UNIQUE (user_id, role_id);

-- =========================================================================
-- 4. Permission helpers (security definer, search_path locked)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.has_permission(_user_id UUID, _perm_code TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.permissions p       ON p.id = rp.permission_id
    JOIN public.profiles pr         ON pr.id = ur.user_id
    WHERE ur.user_id = _user_id AND p.code = _perm_code AND pr.is_active = true
  )
$$;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = _user_id AND r.code = 'admin'
  )
$$;

CREATE OR REPLACE FUNCTION public.my_permissions()
RETURNS TABLE(code TEXT) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT p.code
  FROM public.user_roles ur
  JOIN public.role_permissions rp ON rp.role_id = ur.role_id
  JOIN public.permissions p ON p.id = rp.permission_id
  WHERE ur.user_id = auth.uid()
$$;

-- Drop legacy helpers that referenced enum
DROP FUNCTION IF EXISTS public.can_write() CASCADE;
DROP FUNCTION IF EXISTS public.has_role(UUID, app_role) CASCADE;
DROP TYPE IF EXISTS public.app_role;

-- =========================================================================
-- 5. Cash accounts (payment sources)
-- =========================================================================
DO $$ BEGIN CREATE TYPE public.cash_account_type AS ENUM ('cashbox','bank','field'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.cash_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  account_id UUID NOT NULL REFERENCES public.accounts(id),
  type public.cash_account_type NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed ledger leaves under 1010 Cash & matching cash_accounts
WITH cash_parent AS (SELECT id FROM public.accounts WHERE code = '1010'),
ins AS (
  INSERT INTO public.accounts (code, name, type, parent_id)
  SELECT v.code, v.name, 'asset'::account_type, cash_parent.id
  FROM cash_parent, (VALUES
    ('1011','الصندوق الرئيسي'),
    ('1012','الحساب البنكي'),
    ('1013','صندوق الميدان')
  ) AS v(code,name)
  ON CONFLICT (code) DO NOTHING
  RETURNING id, code
)
INSERT INTO public.cash_accounts (name, account_id, type)
SELECT a.name, a.id,
  CASE a.code WHEN '1011' THEN 'cashbox'::cash_account_type
              WHEN '1012' THEN 'bank'
              ELSE 'field' END
FROM public.accounts a
WHERE a.code IN ('1011','1012','1013');

-- =========================================================================
-- 6. Expense categories: rename + tighten
-- =========================================================================
ALTER TABLE public.expense_categories RENAME COLUMN account_id TO expense_account_id;
-- Backfill any nulls to a default expense leaf (5050 Materials)
UPDATE public.expense_categories
SET expense_account_id = (SELECT id FROM public.accounts WHERE code = '5050')
WHERE expense_account_id IS NULL;
ALTER TABLE public.expense_categories ALTER COLUMN expense_account_id SET NOT NULL;
ALTER TABLE public.expense_categories
  ADD CONSTRAINT expense_categories_account_fk
  FOREIGN KEY (expense_account_id) REFERENCES public.accounts(id);

-- =========================================================================
-- 7. Funding checks: drop status (derived from remaining)
-- =========================================================================
ALTER TABLE public.funding_checks DROP COLUMN IF EXISTS status;
DROP TYPE IF EXISTS public.check_status;

-- =========================================================================
-- 8. Expenses refactor (drop direct check link; add payment + audit)
-- =========================================================================
ALTER TABLE public.expenses DROP COLUMN IF EXISTS funding_check_id;
ALTER TABLE public.expenses
  ADD COLUMN payment_account_id UUID REFERENCES public.cash_accounts(id),
  ADD COLUMN updated_by UUID REFERENCES auth.users(id),
  ADD COLUMN updated_at TIMESTAMPTZ;

-- Allocations
CREATE TABLE public.expense_funding_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  funding_check_id UUID NOT NULL REFERENCES public.funding_checks(id),
  amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_alloc_expense ON public.expense_funding_allocations(expense_id);
CREATE INDEX idx_alloc_check ON public.expense_funding_allocations(funding_check_id);

-- =========================================================================
-- 9. Audit log
-- =========================================================================
CREATE TABLE public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity ON public.audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_actor ON public.audit_log(actor_id);

-- =========================================================================
-- 10. Updated remaining function (allocations-based)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.check_remaining(_check_id UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT fc.amount - COALESCE((
    SELECT SUM(a.amount)
    FROM public.expense_funding_allocations a
    JOIN public.expenses e ON e.id = a.expense_id AND e.deleted_at IS NULL
    WHERE a.funding_check_id = _check_id
  ), 0)
  FROM public.funding_checks fc WHERE fc.id = _check_id
$$;

-- =========================================================================
-- 11. Atomic expense creation (RPC)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.create_expense_atomic(
  _project_id UUID,
  _category_id UUID,
  _payment_account_id UUID,
  _amount NUMERIC,
  _expense_date DATE,
  _description TEXT,
  _attachment_url TEXT,
  _allocations JSONB    -- [{funding_check_id: uuid, amount: numeric}]
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_expense_id UUID;
  v_entry_id UUID;
  v_expense_account UUID;
  v_cash_account UUID;
  v_alloc_total NUMERIC := 0;
  v_alloc JSONB;
  v_check_id UUID;
  v_amt NUMERIC;
  v_remaining NUMERIC;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'غير مصرح: يجب تسجيل الدخول';
  END IF;
  IF NOT public.has_permission(v_user_id, 'expenses.create') THEN
    RAISE EXCEPTION 'غير مصرح بتسجيل المصروفات';
  END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'مبلغ المصروف يجب أن يكون أكبر من صفر'; END IF;

  -- Validate allocations sum
  FOR v_alloc IN SELECT * FROM jsonb_array_elements(_allocations) LOOP
    v_alloc_total := v_alloc_total + (v_alloc->>'amount')::NUMERIC;
  END LOOP;
  IF ROUND(v_alloc_total, 2) <> ROUND(_amount, 2) THEN
    RAISE EXCEPTION 'مجموع التخصيصات (%) لا يساوي مبلغ المصروف (%)', v_alloc_total, _amount;
  END IF;

  -- Resolve ledger accounts
  SELECT expense_account_id INTO v_expense_account FROM public.expense_categories WHERE id = _category_id;
  SELECT account_id INTO v_cash_account FROM public.cash_accounts WHERE id = _payment_account_id AND is_active = true;
  IF v_expense_account IS NULL THEN RAISE EXCEPTION 'فئة المصروف غير صالحة'; END IF;
  IF v_cash_account IS NULL THEN RAISE EXCEPTION 'حساب الدفع غير صالح'; END IF;

  -- Insert expense
  INSERT INTO public.expenses (project_id, category_id, payment_account_id, amount, expense_date, description, attachment_url, created_by)
  VALUES (_project_id, _category_id, _payment_account_id, _amount, _expense_date, _description, _attachment_url, v_user_id)
  RETURNING id INTO v_expense_id;

  -- Allocations + per-check balance check
  FOR v_alloc IN SELECT * FROM jsonb_array_elements(_allocations) LOOP
    v_check_id := (v_alloc->>'funding_check_id')::UUID;
    v_amt := (v_alloc->>'amount')::NUMERIC;

    INSERT INTO public.expense_funding_allocations (expense_id, funding_check_id, amount)
    VALUES (v_expense_id, v_check_id, v_amt);

    v_remaining := public.check_remaining(v_check_id);
    IF v_remaining < 0 THEN
      RAISE EXCEPTION 'تم تجاوز رصيد الصك (المتبقي: %)', v_remaining;
    END IF;
  END LOOP;

  -- Journal entry
  INSERT INTO public.journal_entries (entry_date, description, source_type, source_id, created_by)
  VALUES (_expense_date, COALESCE(_description, 'مصروف'), 'expense', v_expense_id, v_user_id)
  RETURNING id INTO v_entry_id;

  INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, description) VALUES
    (v_entry_id, v_expense_account, _amount, 0, COALESCE(_description, 'مصروف')),
    (v_entry_id, v_cash_account, 0, _amount, 'دفع من حساب');

  UPDATE public.expenses SET journal_entry_id = v_entry_id WHERE id = v_expense_id;

  -- Audit
  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user_id, 'create', 'expense', v_expense_id,
          jsonb_build_object('amount', _amount, 'allocations', _allocations,
                             'project_id', _project_id, 'category_id', _category_id,
                             'payment_account_id', _payment_account_id));

  RETURN v_expense_id;
END $$;

-- Reversal
CREATE OR REPLACE FUNCTION public.reverse_expense_atomic(_expense_id UUID, _reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_exp public.expenses%ROWTYPE;
  v_entry_id UUID;
  v_expense_account UUID;
  v_cash_account UUID;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  IF NOT public.has_permission(v_user_id, 'expenses.delete') THEN
    RAISE EXCEPTION 'غير مصرح بعكس/حذف المصروفات';
  END IF;

  SELECT * INTO v_exp FROM public.expenses WHERE id = _expense_id AND deleted_at IS NULL;
  IF v_exp.id IS NULL THEN RAISE EXCEPTION 'المصروف غير موجود أو محذوف'; END IF;

  SELECT expense_account_id INTO v_expense_account FROM public.expense_categories WHERE id = v_exp.category_id;
  SELECT account_id INTO v_cash_account FROM public.cash_accounts WHERE id = v_exp.payment_account_id;

  -- Reversing journal entry (mirror lines)
  INSERT INTO public.journal_entries (entry_date, description, source_type, source_id, created_by)
  VALUES (CURRENT_DATE, 'عكس مصروف: ' || COALESCE(_reason,''), 'expense_reversal', _expense_id, v_user_id)
  RETURNING id INTO v_entry_id;

  INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, description) VALUES
    (v_entry_id, v_cash_account, v_exp.amount, 0, 'استرجاع نقدية'),
    (v_entry_id, v_expense_account, 0, v_exp.amount, 'عكس قيد المصروف');

  UPDATE public.expenses SET deleted_at = now(), updated_by = v_user_id, updated_at = now() WHERE id = _expense_id;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user_id, 'reverse', 'expense', _expense_id, jsonb_build_object('reason', _reason));
END $$;

-- =========================================================================
-- 12. handle_new_user updated for table-driven roles
-- =========================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count INT;
  v_role_code TEXT;
  v_role_id UUID;
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), NEW.email);

  SELECT COUNT(*) INTO v_count FROM public.profiles;
  v_role_code := CASE WHEN v_count = 1 THEN 'admin' ELSE 'viewer' END;
  SELECT id INTO v_role_id FROM public.roles WHERE code = v_role_code;
  INSERT INTO public.user_roles (user_id, role_id) VALUES (NEW.id, v_role_id);
  RETURN NEW;
END $$;

-- Recreate trigger if it was dropped
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================================================
-- 13. RLS — drop old policies and rebuild on permission codes
-- =========================================================================
-- Helper to keep policy DDL short
-- We rewrite policies per table.

-- profiles
DROP POLICY IF EXISTS profiles_select_authenticated ON public.profiles;
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY profiles_admin_update ON public.profiles FOR UPDATE TO authenticated USING (public.has_permission(auth.uid(),'users.manage'));
CREATE POLICY profiles_admin_insert ON public.profiles FOR INSERT TO authenticated WITH CHECK (public.has_permission(auth.uid(),'users.manage') OR auth.uid() = id);

-- user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_roles_select ON public.user_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY user_roles_manage ON public.user_roles FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(),'users.manage'))
  WITH CHECK (public.has_permission(auth.uid(),'users.manage'));

-- roles
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY roles_select ON public.roles FOR SELECT TO authenticated USING (true);
CREATE POLICY roles_manage ON public.roles FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(),'users.manage'))
  WITH CHECK (public.has_permission(auth.uid(),'users.manage'));

-- permissions
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY permissions_select ON public.permissions FOR SELECT TO authenticated USING (true);

-- role_permissions
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY role_permissions_select ON public.role_permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY role_permissions_manage ON public.role_permissions FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(),'users.manage'))
  WITH CHECK (public.has_permission(auth.uid(),'users.manage'));

-- projects
DROP POLICY IF EXISTS projects_select ON public.projects;
DROP POLICY IF EXISTS projects_insert ON public.projects;
DROP POLICY IF EXISTS projects_update ON public.projects;
DROP POLICY IF EXISTS projects_delete ON public.projects;
CREATE POLICY projects_select ON public.projects FOR SELECT TO authenticated USING (public.has_permission(auth.uid(),'projects.view'));
CREATE POLICY projects_insert ON public.projects FOR INSERT TO authenticated WITH CHECK (public.has_permission(auth.uid(),'projects.create'));
CREATE POLICY projects_update ON public.projects FOR UPDATE TO authenticated USING (public.has_permission(auth.uid(),'projects.edit'));
CREATE POLICY projects_delete ON public.projects FOR DELETE TO authenticated USING (public.has_permission(auth.uid(),'projects.delete'));

-- funders
DROP POLICY IF EXISTS funders_select ON public.funders;
DROP POLICY IF EXISTS funders_insert ON public.funders;
DROP POLICY IF EXISTS funders_update ON public.funders;
DROP POLICY IF EXISTS funders_delete ON public.funders;
CREATE POLICY funders_select ON public.funders FOR SELECT TO authenticated USING (public.has_permission(auth.uid(),'funders.view'));
CREATE POLICY funders_insert ON public.funders FOR INSERT TO authenticated WITH CHECK (public.has_permission(auth.uid(),'funders.create'));
CREATE POLICY funders_update ON public.funders FOR UPDATE TO authenticated USING (public.has_permission(auth.uid(),'funders.edit'));
CREATE POLICY funders_delete ON public.funders FOR DELETE TO authenticated USING (public.has_permission(auth.uid(),'funders.delete'));

-- funding_checks
DROP POLICY IF EXISTS funding_checks_select ON public.funding_checks;
DROP POLICY IF EXISTS funding_checks_insert ON public.funding_checks;
DROP POLICY IF EXISTS funding_checks_update ON public.funding_checks;
DROP POLICY IF EXISTS funding_checks_delete ON public.funding_checks;
CREATE POLICY funding_checks_select ON public.funding_checks FOR SELECT TO authenticated USING (public.has_permission(auth.uid(),'funding.view'));
CREATE POLICY funding_checks_insert ON public.funding_checks FOR INSERT TO authenticated WITH CHECK (public.has_permission(auth.uid(),'funding.create'));
CREATE POLICY funding_checks_update ON public.funding_checks FOR UPDATE TO authenticated USING (public.has_permission(auth.uid(),'funding.edit'));
CREATE POLICY funding_checks_delete ON public.funding_checks FOR DELETE TO authenticated USING (public.has_permission(auth.uid(),'funding.delete'));

-- expense_categories
DROP POLICY IF EXISTS expense_categories_select ON public.expense_categories;
DROP POLICY IF EXISTS expense_categories_insert ON public.expense_categories;
DROP POLICY IF EXISTS expense_categories_update ON public.expense_categories;
DROP POLICY IF EXISTS expense_categories_delete ON public.expense_categories;
CREATE POLICY expense_categories_select ON public.expense_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY expense_categories_manage ON public.expense_categories FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(),'categories.manage'))
  WITH CHECK (public.has_permission(auth.uid(),'categories.manage'));

-- accounts
DROP POLICY IF EXISTS accounts_select ON public.accounts;
DROP POLICY IF EXISTS accounts_insert ON public.accounts;
DROP POLICY IF EXISTS accounts_update ON public.accounts;
DROP POLICY IF EXISTS accounts_delete ON public.accounts;
CREATE POLICY accounts_select ON public.accounts FOR SELECT TO authenticated USING (public.has_permission(auth.uid(),'accounts.view'));
CREATE POLICY accounts_manage ON public.accounts FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(),'accounts.manage'))
  WITH CHECK (public.has_permission(auth.uid(),'accounts.manage'));

-- expenses
DROP POLICY IF EXISTS expenses_select ON public.expenses;
DROP POLICY IF EXISTS expenses_insert ON public.expenses;
DROP POLICY IF EXISTS expenses_update ON public.expenses;
DROP POLICY IF EXISTS expenses_delete ON public.expenses;
CREATE POLICY expenses_select ON public.expenses FOR SELECT TO authenticated USING (public.has_permission(auth.uid(),'expenses.view'));
CREATE POLICY expenses_insert ON public.expenses FOR INSERT TO authenticated WITH CHECK (public.has_permission(auth.uid(),'expenses.create'));
CREATE POLICY expenses_update ON public.expenses FOR UPDATE TO authenticated USING (public.has_permission(auth.uid(),'expenses.edit'));
CREATE POLICY expenses_delete ON public.expenses FOR DELETE TO authenticated USING (public.has_permission(auth.uid(),'expenses.delete'));

-- expense_funding_allocations
ALTER TABLE public.expense_funding_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY alloc_select ON public.expense_funding_allocations FOR SELECT TO authenticated USING (public.has_permission(auth.uid(),'expenses.view'));
CREATE POLICY alloc_insert ON public.expense_funding_allocations FOR INSERT TO authenticated WITH CHECK (public.has_permission(auth.uid(),'expenses.create'));
CREATE POLICY alloc_delete ON public.expense_funding_allocations FOR DELETE TO authenticated USING (public.has_permission(auth.uid(),'expenses.delete'));

-- journal_entries / journal_lines
DROP POLICY IF EXISTS journal_entries_select ON public.journal_entries;
DROP POLICY IF EXISTS journal_entries_insert ON public.journal_entries;
DROP POLICY IF EXISTS journal_entries_update ON public.journal_entries;
DROP POLICY IF EXISTS journal_entries_delete ON public.journal_entries;
CREATE POLICY je_select ON public.journal_entries FOR SELECT TO authenticated USING (public.has_permission(auth.uid(),'journal.view'));
CREATE POLICY je_insert ON public.journal_entries FOR INSERT TO authenticated WITH CHECK (public.has_permission(auth.uid(),'journal.create'));
DROP POLICY IF EXISTS journal_lines_select ON public.journal_lines;
DROP POLICY IF EXISTS journal_lines_insert ON public.journal_lines;
DROP POLICY IF EXISTS journal_lines_update ON public.journal_lines;
DROP POLICY IF EXISTS journal_lines_delete ON public.journal_lines;
CREATE POLICY jl_select ON public.journal_lines FOR SELECT TO authenticated USING (public.has_permission(auth.uid(),'journal.view'));
CREATE POLICY jl_insert ON public.journal_lines FOR INSERT TO authenticated WITH CHECK (public.has_permission(auth.uid(),'journal.create'));

-- cash_accounts
ALTER TABLE public.cash_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY cash_select ON public.cash_accounts FOR SELECT TO authenticated USING (true);
CREATE POLICY cash_manage ON public.cash_accounts FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(),'cash.manage'))
  WITH CHECK (public.has_permission(auth.uid(),'cash.manage'));

-- audit_log
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_select ON public.audit_log FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
