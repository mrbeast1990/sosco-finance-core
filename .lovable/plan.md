# SOSCO Accounting System — Phase 1 Plan

## 1. Backend (Lovable Cloud / Postgres)

Enable Lovable Cloud, then create migration with:

**Tables**
- `profiles` (id → auth.users, full_name, created_at)
- `user_roles` (user_id, role enum: admin/accountant/viewer) + `has_role()` security-definer fn
- `projects` (id, name, code unique, status, deleted_at, created_at)
- `funders` (id, name, phone, notes, deleted_at, created_at)
- `funding_checks` (id, funder_id, check_number, amount, received_date, status, notes, created_at) — `remaining_amount` computed via view/function, never stored stale
- `expense_categories` (id, name unique, created_at) — seeded: Fuel, Salaries, Maintenance, Rentals, Materials, Travel
- `accounts` (id, parent_id, code unique, name, type enum) — seeded basic tree (1000 Assets → Cash/Bank; 2000 Liabilities; 3000 Equity; 4000 Revenue; 5000 Expenses → category leaves)
- `expenses` (id, project_id, funding_check_id, category_id, amount, expense_date, description, attachment_url, journal_entry_id, created_by, deleted_at, created_at)
- `journal_entries` (id, entry_number serial, date, description, source_type, source_id, created_by, created_at)
- `journal_lines` (id, journal_entry_id, account_id, debit, credit, description) + CHECK (debit≥0, credit≥0, exactly one>0)

**Triggers / Functions**
- `fn_check_remaining(check_id)` returns amount − SUM(non-deleted expenses)
- `trg_expense_before_insert`: validates `amount ≤ remaining`, raises if overspend
- `trg_expense_after_insert`: creates `journal_entry` + 2 balanced `journal_lines` (DR expense category account, CR cash/bank), stores `journal_entry_id` back on expense
- `trg_journal_balance_check`: deferred constraint ensuring SUM(debit)=SUM(credit) per entry
- Audit: `created_by` defaults to `auth.uid()`; soft delete via `deleted_at`

**RLS**
- All tables: authenticated users can SELECT
- INSERT/UPDATE/DELETE: `has_role(auth.uid(),'admin')` OR `has_role(auth.uid(),'accountant')`
- `user_roles`: only admin can modify
- Storage bucket `expense-attachments` (private) with RLS

**Storage**
- Private bucket for expense attachments (PDF/images)

## 2. Frontend (TanStack Start + shadcn, RTL Arabic)

**Global**
- `dir="rtl"` + `lang="ar"` on root, Cairo/Tajawal font
- Enterprise theme: deep navy primary, neutral surfaces, oklch tokens in `styles.css`
- `AppSidebar` with sections: لوحة التحكم، المشاريع، الممولون، الصكوك، فئات المصروفات، المصروفات، القيود اليومية، شجرة الحسابات، التقارير
- Auth gate via `_authenticated` layout, login/signup pages (email+password)

**Routes**
- `/login`, `/signup`
- `/_authenticated/` (sidebar shell)
  - `index` → Dashboard (KPI cards: total funding, total expenses, remaining, recent expenses table)
  - `projects` — CRUD table + modal form
  - `funders` — CRUD table + modal form
  - `funding-checks` — table with progress bars (used/remaining), create/edit modal
  - `expense-categories` — simple CRUD
  - `expenses` — **headline page**: filterable table + create modal with live remaining-balance preview, attachment upload, server-side overspend block
  - `journal-entries` — ledger view, expandable rows showing balanced DR/CR lines
  - `accounts` — tree view of chart of accounts
  - `reports` — tabs: Funding Report, Project Expense Report, Expense Analysis (with charts via recharts)

**Shared UI patterns**
- `DataTable` w/ search + filters + status badges
- `FormModal` w/ react-hook-form + zod validation
- Toasts via sonner
- Currency formatter (LYD)

## 3. Technical notes (for reviewers)

- TanStack Start file routes; queries via `createServerFn` + `requireSupabaseAuth`; admin operations via `supabaseAdmin` only inside server fns
- Remaining-balance computed in DB (no stale field); UI reads via RPC `get_check_remaining(check_id)`
- Auto journal: server fn `createExpense` runs as a single transaction (insert expense → trigger creates JE/lines → return)
- Soft delete preserves audit; deleted expenses excluded from balance calc
- Phase 1 scope: no manual journal entry editor (auto-only); Phase 2 can add manual entries

## 4. Out of scope (Phase 1)
- Multi-currency
- Bank reconciliation
- Fiscal period close
- Advanced permissions per project

---

Confirm and I'll execute end-to-end (enable Cloud → migration + seeds → UI). Estimated ~25 files.
