
# SOSCO Phase 2 — Funding Refactor + Accounting Engine + RBAC

This is a structural refactor. I'll do it in three coordinated waves so the app stays runnable between steps.

---

## Wave 1 — Database refactor (single migration)

### Funding model
- Keep `funders`, `funding_checks` as-is (remove `status` column — funding lifecycle is now derived from `remaining = amount − allocated`).
- **Drop** `expenses.funding_check_id`.
- **New** `expense_funding_allocations(id, expense_id, funding_check_id, amount, created_at)` — supports partial / multi-source funding per expense.

### Cash accounts (real ledger payment sources)
- **New** `cash_accounts(id, name, account_id → accounts, type ['cashbox'|'bank'|'field'], is_active, created_at)`.
- Seed: Main Cashbox, Bank Account, Field Cash — each linked to a child account under `1010 Cash`.

### Expense category → ledger
- **Rename** `expense_categories.account_id` → `expense_account_id` (clearer intent). Keep NOT NULL; backfill existing rows to current expense leaves.

### Expenses
- **Add** `expenses.payment_account_id → cash_accounts` (NOT NULL going forward; backfill to default cashbox for any existing rows).
- **Add** `updated_by`, `updated_at` for audit.

### RBAC (replace current 3-role enum with table-driven permissions)
- **New** `roles(id, code unique, name, description, is_system, created_at)` — seed Admin, Finance Manager, Accountant, Viewer (system roles, undeletable).
- **New** `permissions(id, code unique, name, module, created_at)` — seed full permission set across modules: projects, funders, funding, expenses, journal, accounts, reports, users, settings (view/create/edit/delete/approve where relevant).
- **New** `role_permissions(role_id, permission_id)` — seed defaults per role.
- **Migrate** `user_roles` → `(user_id, role_id)` (drop the old enum column). Backfill existing admin/accountant/viewer rows by code.
- Extend `profiles` with `email`, `avatar_url`, `is_active`.

### Security-definer functions
- `has_permission(_user_id uuid, _perm_code text) returns boolean` — checks via user_roles → role_permissions → permissions.
- `is_admin(_user_id)` thin wrapper.
- Replace `can_write()` with `has_permission(auth.uid(), '...')` calls in RLS policies (per-table per-action codes).
- Keep old `has_role(uuid, app_role)` only if needed for back-compat during migration; otherwise drop.

### Triggers & accounting
- **Drop** old `create_expense_journal` trigger and `validate_expense_balance` trigger — replaced by server-side service (atomic & reversal-safe).
- New SQL helper: `validate_check_remaining(_check_id, _delta)` used by service layer for last-mile defense.
- Optional defensive trigger on `journal_lines`: enforce SUM(debit)=SUM(credit) per entry on COMMIT (deferred constraint via statement trigger).

### RLS rewrite
- Every table: SELECT requires `has_permission(auth.uid(), '<module>.view')`; INSERT/UPDATE/DELETE require matching codes.
- `roles`, `permissions`, `role_permissions`, `user_roles`, `profiles.is_active` writes → `users.manage` permission only.

---

## Wave 2 — Accounting service (server functions)

Centralized in `src/lib/accounting.functions.ts` + `accounting.server.ts`:

- `createExpense({ project_id, category_id, payment_account_id, amount, expense_date, description, attachment_url, allocations: [{ funding_check_id, amount }] })`
  1. Validate `Σ allocations.amount === amount`.
  2. For each allocation: call `check_remaining` and ensure it covers the slice.
  3. Insert expense row.
  4. Insert allocation rows.
  5. Resolve `expense_account_id` from category and `account_id` (cash leaf) from `cash_accounts.payment_account_id`.
  6. Insert `journal_entries` (source_type='expense') + balanced `journal_lines` (DR expense_account total; CR cash_account total). All in one PG transaction via `supabaseAdmin.rpc('create_expense_atomic', {...})` — implemented as a `plpgsql` function so the whole flow is atomic.
  7. Return composed result.

- `reverseExpense(expense_id, reason)` — soft-delete expense, soft-delete allocations, post a reversing journal entry (source_type='expense_reversal'). Audit row.

- `updateExpense(...)` — implemented as reverse + recreate (keeps full audit trail; never mutates posted journal lines).

- `audit_log(id, actor_id, action, entity_type, entity_id, payload jsonb, created_at)` table; service writes to it on every mutation.

All gated by `requireSupabaseAuth` + permission check inside handler.

---

## Wave 3 — Frontend

### Sidebar (final)
Dashboard · Projects · Funders · Expenses · Journal Entries · Chart of Accounts · Reports · Settings.
**Remove** standalone Funding Checks and Expense Categories from sidebar (categories move under Settings).

### Funder profile — `/_authenticated/funders/$funderId`
- Header: name, phone, notes (edit-in-place for users with `funders.edit`).
- KPI strip: Total funding, Total spent, Remaining.
- Tabs:
  - **Checks** — table (number, amount, used, remaining, date, derived status badge) + "Add Check" dialog (only place checks are created).
  - **Expenses** — all expenses tied to this funder via allocations (project, category, amount, check #, date).
  - **Projects** — distinct projects funded (with totals).

### Expenses page — new flow
- Form: project → category → payment account → amount → **dynamic allocations** sub-form (add rows of funding check + amount, live remaining preview, must sum to amount).
- Server-side validation; toast on overspend.

### Settings page — `/_authenticated/settings`
Tabs:
- **Users** — list profiles, activate/deactivate, assign roles (multi-select), invite (admin email + temp pwd via service-role server fn).
- **Roles & Permissions** — role list; per-role grouped permission checkboxes (by module). System roles' permissions editable but role itself undeletable.
- **Cash Accounts** — CRUD.
- **Expense Categories** — CRUD with required `expense_account_id` picker (only accounts of type `expense`).
- **Chart of Accounts** link.

### Permission plumbing
- `useAuth()` exposes `permissions: Set<string>` and `can(code)`.
- `<Can perm="...">` wrapper hides buttons/sections.
- `_authenticated` layout `beforeLoad` checks route-level permission; unauthorized → `/forbidden`.
- Sidebar items filtered by permission.

### Files removed
- `src/routes/_authenticated/funding-checks.tsx` (route file deleted).

---

## Out of scope (this batch)
- Approval workflows for expenses (table & UI; permissions stubbed: `expenses.approve`).
- Email invites via SMTP — initial implementation creates user with temp password, surfaces it once.
- Multi-currency, fiscal periods.

---

## Technical notes
- Single migration covers schema + RLS + seed permissions + backfills, wrapped in transaction.
- `create_expense_atomic` plpgsql function holds the multi-table write so accounting integrity is DB-enforced even if the server fn is bypassed.
- All sensitive writes go through `requireSupabaseAuth` server functions; admin client used only for user invites & role admin (gated by `users.manage`).
- Existing data preserved: each existing expense gets one allocation row (full amount) tied to its old `funding_check_id` before the column is dropped.

Approve and I'll execute Wave 1 (migration) first, then Waves 2 & 3 in the same turn.
