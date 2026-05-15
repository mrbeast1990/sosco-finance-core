
-- ============= ENUMS =============
CREATE TYPE public.app_role AS ENUM ('admin', 'accountant', 'viewer');
CREATE TYPE public.account_type AS ENUM ('asset', 'liability', 'equity', 'revenue', 'expense');
CREATE TYPE public.project_status AS ENUM ('active', 'completed', 'on_hold', 'cancelled');
CREATE TYPE public.check_status AS ENUM ('active', 'depleted', 'cancelled');

-- ============= PROFILES =============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ============= USER ROLES =============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.can_write()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant')
$$;

-- Auto-create profile + assign first user as admin
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  user_count INT;
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));

  SELECT COUNT(*) INTO user_count FROM public.profiles;
  IF user_count = 1 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'viewer');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============= PROJECTS =============
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  status project_status NOT NULL DEFAULT 'active',
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- ============= FUNDERS =============
CREATE TABLE public.funders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.funders ENABLE ROW LEVEL SECURITY;

-- ============= EXPENSE CATEGORIES =============
CREATE TABLE public.expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  account_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;

-- ============= CHART OF ACCOUNTS =============
CREATE TABLE public.accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID REFERENCES public.accounts(id),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type account_type NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.expense_categories
  ADD CONSTRAINT fk_category_account FOREIGN KEY (account_id) REFERENCES public.accounts(id);

-- ============= FUNDING CHECKS =============
CREATE TABLE public.funding_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  funder_id UUID NOT NULL REFERENCES public.funders(id),
  check_number TEXT NOT NULL,
  amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  received_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status check_status NOT NULL DEFAULT 'active',
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.funding_checks ENABLE ROW LEVEL SECURITY;

-- ============= JOURNAL ENTRIES =============
CREATE SEQUENCE public.journal_entry_seq START 1000;

CREATE TABLE public.journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_number TEXT NOT NULL UNIQUE DEFAULT ('JE-' || nextval('public.journal_entry_seq')::text),
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT,
  source_type TEXT,
  source_id UUID,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.journal_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id UUID NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id),
  debit NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);
ALTER TABLE public.journal_lines ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_journal_lines_entry ON public.journal_lines(journal_entry_id);
CREATE INDEX idx_journal_lines_account ON public.journal_lines(account_id);

-- ============= EXPENSES =============
CREATE TABLE public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id),
  funding_check_id UUID NOT NULL REFERENCES public.funding_checks(id),
  category_id UUID NOT NULL REFERENCES public.expense_categories(id),
  amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT,
  attachment_url TEXT,
  journal_entry_id UUID REFERENCES public.journal_entries(id),
  created_by UUID REFERENCES auth.users(id),
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_expenses_check ON public.expenses(funding_check_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_expenses_project ON public.expenses(project_id) WHERE deleted_at IS NULL;

-- ============= REMAINING BALANCE FUNCTION =============
CREATE OR REPLACE FUNCTION public.check_remaining(_check_id UUID)
RETURNS NUMERIC LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT fc.amount - COALESCE((
    SELECT SUM(e.amount) FROM public.expenses e
    WHERE e.funding_check_id = _check_id AND e.deleted_at IS NULL
  ), 0)
  FROM public.funding_checks fc WHERE fc.id = _check_id
$$;

-- ============= EXPENSE TRIGGERS =============
-- Validate balance before insert
CREATE OR REPLACE FUNCTION public.validate_expense_balance()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  remaining NUMERIC;
  check_amt NUMERIC;
BEGIN
  SELECT amount INTO check_amt FROM public.funding_checks
    WHERE id = NEW.funding_check_id AND deleted_at IS NULL;
  IF check_amt IS NULL THEN
    RAISE EXCEPTION 'Funding check not found or deleted';
  END IF;

  remaining := check_amt - COALESCE((
    SELECT SUM(amount) FROM public.expenses
    WHERE funding_check_id = NEW.funding_check_id
      AND deleted_at IS NULL
      AND (TG_OP = 'INSERT' OR id <> NEW.id)
  ), 0);

  IF NEW.amount > remaining THEN
    RAISE EXCEPTION 'Expense amount % exceeds remaining funding balance %', NEW.amount, remaining;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_expense_balance
BEFORE INSERT OR UPDATE OF amount, funding_check_id ON public.expenses
FOR EACH ROW WHEN (NEW.deleted_at IS NULL)
EXECUTE FUNCTION public.validate_expense_balance();

-- Auto-create journal entry after expense insert
CREATE OR REPLACE FUNCTION public.create_expense_journal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_entry_id UUID;
  v_expense_account UUID;
  v_cash_account UUID;
  v_project_name TEXT;
  v_check_no TEXT;
BEGIN
  SELECT account_id INTO v_expense_account FROM public.expense_categories WHERE id = NEW.category_id;
  SELECT id INTO v_cash_account FROM public.accounts WHERE code = '1010';
  SELECT name INTO v_project_name FROM public.projects WHERE id = NEW.project_id;
  SELECT check_number INTO v_check_no FROM public.funding_checks WHERE id = NEW.funding_check_id;

  IF v_expense_account IS NULL OR v_cash_account IS NULL THEN
    RAISE EXCEPTION 'Required accounts missing for journal entry';
  END IF;

  INSERT INTO public.journal_entries (entry_date, description, source_type, source_id, created_by)
  VALUES (NEW.expense_date,
          'مصروف - ' || v_project_name || ' - صك ' || v_check_no,
          'expense', NEW.id, NEW.created_by)
  RETURNING id INTO v_entry_id;

  INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES
    (v_entry_id, v_expense_account, NEW.amount, 0, COALESCE(NEW.description, 'مصروف')),
    (v_entry_id, v_cash_account, 0, NEW.amount, 'صك ' || v_check_no);

  UPDATE public.expenses SET journal_entry_id = v_entry_id WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_create_expense_journal
AFTER INSERT ON public.expenses
FOR EACH ROW WHEN (NEW.deleted_at IS NULL)
EXECUTE FUNCTION public.create_expense_journal();

-- ============= RLS POLICIES =============
-- Profiles
CREATE POLICY "profiles_select_authenticated" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- User roles
CREATE POLICY "user_roles_select_authenticated" ON public.user_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "user_roles_admin_all" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Generic helper macro: select for authenticated, write for admin/accountant
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['projects','funders','funding_checks','expense_categories','accounts','expenses','journal_entries','journal_lines']
  LOOP
    EXECUTE format('CREATE POLICY "%I_select" ON public.%I FOR SELECT TO authenticated USING (true)', t, t);
    EXECUTE format('CREATE POLICY "%I_insert" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.can_write())', t, t);
    EXECUTE format('CREATE POLICY "%I_update" ON public.%I FOR UPDATE TO authenticated USING (public.can_write())', t, t);
    EXECUTE format('CREATE POLICY "%I_delete" ON public.%I FOR DELETE TO authenticated USING (public.has_role(auth.uid(), ''admin''))', t, t);
  END LOOP;
END $$;

-- ============= STORAGE BUCKET =============
INSERT INTO storage.buckets (id, name, public) VALUES ('expense-attachments', 'expense-attachments', false);

CREATE POLICY "attachments_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'expense-attachments');
CREATE POLICY "attachments_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'expense-attachments' AND public.can_write());
CREATE POLICY "attachments_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'expense-attachments' AND public.has_role(auth.uid(), 'admin'));

-- ============= SEED CHART OF ACCOUNTS =============
INSERT INTO public.accounts (code, name, type, is_system) VALUES
  ('1000', 'الأصول', 'asset', true),
  ('1010', 'النقدية والبنك', 'asset', true),
  ('2000', 'الخصوم', 'liability', true),
  ('3000', 'حقوق الملكية', 'equity', true),
  ('4000', 'الإيرادات', 'revenue', true),
  ('5000', 'المصروفات', 'expense', true),
  ('5010', 'مصروفات الوقود', 'expense', true),
  ('5020', 'الرواتب والأجور', 'expense', true),
  ('5030', 'الصيانة', 'expense', true),
  ('5040', 'الإيجارات', 'expense', true),
  ('5050', 'المواد والمستلزمات', 'expense', true),
  ('5060', 'السفر والانتقال', 'expense', true);

-- Set parent links
UPDATE public.accounts SET parent_id = (SELECT id FROM public.accounts WHERE code='1000') WHERE code IN ('1010');
UPDATE public.accounts SET parent_id = (SELECT id FROM public.accounts WHERE code='5000') WHERE code IN ('5010','5020','5030','5040','5050','5060');

-- ============= SEED EXPENSE CATEGORIES =============
INSERT INTO public.expense_categories (name, account_id) VALUES
  ('الوقود', (SELECT id FROM public.accounts WHERE code='5010')),
  ('الرواتب', (SELECT id FROM public.accounts WHERE code='5020')),
  ('الصيانة', (SELECT id FROM public.accounts WHERE code='5030')),
  ('الإيجارات', (SELECT id FROM public.accounts WHERE code='5040')),
  ('المواد', (SELECT id FROM public.accounts WHERE code='5050')),
  ('السفر', (SELECT id FROM public.accounts WHERE code='5060'));
