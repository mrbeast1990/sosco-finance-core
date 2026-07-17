
This is a large, high-risk scope touching accounting RPCs and schema. I'll execute in the exact 4 phases you defined, stopping between phases so you can verify before the next one starts.

## Phase 1 — Asset Expense Details (UI only, no DB)

**Files**: `src/routes/_authenticated/assets-registry.tsx`, new `src/components/ExpenseDetailsDialog.tsx` (reusable).

- Add eye icon button in the "سجل المصروفات" table inside `AssetDetailsDialog` with `stopPropagation`.
- New dialog fetches the full expense (join category, project, asset, allocations→check→funder, cash account, payable, creditor, journal entry, profile of creator, attachments).
- Reuse this same component later from Expenses page and Project drill-down to avoid duplication.
- Read-only, no financial recalc.

Risk: low. No DB changes.

## Phase 2 — Multi-Check Withdrawal Allocations

**Inspect first** (I'll run `supabase--read_query` before writing migration):
- `withdrawal_funding_allocations` current constraints (esp. any UNIQUE on `withdrawal_id` alone).
- Existing rows to confirm 1:1 historical shape.
- `create_withdrawal_atomic`, `approve_withdrawal_atomic`, `cancel_withdrawal_atomic` signatures.

**Migration** (non-destructive):
- Drop any UNIQUE on `withdrawal_id` alone (only if it exists); add `UNIQUE (withdrawal_id, funding_check_id)`.
- Keep column `owner_withdrawals.funding_check_id` for legacy (nullable); new withdrawals may leave it NULL when using multi-allocation. Historical rows untouched.
- New/updated RPCs:
  - `create_withdrawal_v2(_withdrawal_date, _person_name, _person_role, _amount, _payment_method, _cash_account_id, _allocations jsonb, _project_id, _description, _attachment_url)` — validates sum, uniqueness, positive amounts; stores allocations in `withdrawal_funding_allocations` at draft (no balance mutation yet — same as before).
  - `approve_withdrawal_v2(_id)` — for each allocation locks the check, verifies `check_remaining`, builds one journal entry with one credit line per distinct cash account (mirroring `create_expense_v2` pattern).
  - `cancel_withdrawal_atomic` — extend to reverse multi-allocation journal lines (keeps single-check path working since allocations table already used).
- Old `create_withdrawal_atomic` kept for backward compat (offline queue may still call it).

**UI** (`src/routes/_authenticated/withdrawals.tsx`):
- Replace single check dropdown with allocation rows (add/remove, per-row remaining balance, sum check, mismatch warning) — pattern copied from `expenses.tsx`.
- Show per-check details (funder / cash account / consumed / remaining).
- Historical single-check withdrawals still render (read allocations table; if 1 row, show as-is).

Risk: **medium-high**. This touches accounting. I'll inspect schema and share migration SQL before applying.

## Phase 3 — Expense Date Modes + Visible KPI Dashboard

**Files**: `src/routes/_authenticated/expenses.tsx`.

- Date mode selector: `شهر | من — إلى | الكل`. Current month nav preserved under `شهر`.
- New RPC `expenses_summary(_from, _to, _scope, _project_id, _asset_id, _payment_status, _search)` returns:
  - `total_amount, count, paid_amount, payable_amount, project_amount, general_amount, asset_amount`.
  - Aggregates full filtered set (not just current page).
- KPI cards above table, driven by that RPC (same filters as list query).
- Server-side pagination unchanged (50/page). "الكل" mode still paginates.
- Reset page to 1 on any filter change.

Risk: low-medium. Read-only RPC.

## Phase 4 — Project Details Page

**Files**: new route `src/routes/_authenticated/projects.$projectId.tsx`; link from `projects.tsx` and `dashboard.tsx`.

**Income source** — I'll first inspect and confirm the authoritative source. My working hypothesis based on current schema:
- If project is linked as a funder (`funders.is_project = true` + `project_code`), income = sum of `funding_checks.amount` where `funder_id` = that funder id.
- If project is not funder-linked, income = 0 (show "لا يوجد تمويل مسجل لهذا المشروع").
- I'll confirm before implementing and document the decision at the top of the file.

**Sections**:
- Header (name, code, status, dates, linked funder, description).
- KPI cards gated by `reports.financial`.
- Tabs: الملخص / حسب الفئة / الصكوك / المسحوبات / الأصول / الذمم / السجل.
- Category summary via new RPC `project_expense_category_summary(_project_id, _from, _to)` returning name/count/total/pct; row click → drill-down list reusing Phase 1's `ExpenseDetailsDialog`.
- Charts: monthly trend + by-category (recharts, already in project). Compact — not replacing tables.
- Drill-downs paginated.

Permissions: hide financial KPIs and monetary columns without `reports.financial`.

Risk: medium (new page, aggregation RPCs). No writes.

---

## Order & gates

1. Phase 1 → build → I stop and report.
2. Phase 2 inspection + migration proposal → **wait for your approval on migration SQL** → apply → UI → build → stop.
3. Phase 3 → migration (RPC only) → UI → build → stop.
4. Phase 4 → inspection + income-source confirmation → migrations → UI → build → stop.

I will NOT proceed past a failing build. I will NOT run destructive backfills.

Confirm and I'll begin Phase 1.
