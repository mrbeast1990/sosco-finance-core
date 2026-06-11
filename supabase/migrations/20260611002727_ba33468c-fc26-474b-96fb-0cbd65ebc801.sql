INSERT INTO public.permissions (code, name, module) VALUES
  ('reports.view', 'رؤية التقارير', 'reports'),
  ('reports.export', 'تصدير التقارير', 'reports'),
  ('reports.financial', 'رؤية التقارير المالية الحساسة', 'reports')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE r.code = 'admin' AND p.code IN ('reports.view','reports.export','reports.financial')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE r.code IN ('accountant','viewer','manager') AND p.code IN ('reports.view','reports.export')
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_expenses_expense_date ON public.expenses(expense_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_project_id ON public.expenses(project_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_category_id ON public.expenses(category_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_asset_id ON public.expenses(asset_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_payment_status ON public.expenses(payment_status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_created_by ON public.expenses(created_by) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payables_status ON public.payables(status);
CREATE INDEX IF NOT EXISTS idx_payables_due_date ON public.payables(due_date);
CREATE INDEX IF NOT EXISTS idx_payables_creditor_name ON public.payables(creditor_name);

CREATE INDEX IF NOT EXISTS idx_journal_entries_entry_date ON public.journal_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_journal_lines_journal_entry_id ON public.journal_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account_id ON public.journal_lines(account_id);

CREATE INDEX IF NOT EXISTS idx_efa_funding_check_id ON public.expense_funding_allocations(funding_check_id);
CREATE INDEX IF NOT EXISTS idx_efa_expense_id ON public.expense_funding_allocations(expense_id);

CREATE INDEX IF NOT EXISTS idx_owner_withdrawals_date ON public.owner_withdrawals(withdrawal_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_owner_withdrawals_status ON public.owner_withdrawals(status) WHERE deleted_at IS NULL;