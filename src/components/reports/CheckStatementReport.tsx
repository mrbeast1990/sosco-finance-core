import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  ReportFilters,
  type ReportFiltersState,
  emptyFilters,
  periodLabel,
} from "@/components/ReportFilters";
import { Kpi, ReportHeader, SectionCard, WarnPill } from "./ReportShell";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { LoadingState, EmptyState } from "@/components/States";
import { formatCurrency, formatDate } from "@/lib/utils";
import { exportToExcel } from "@/lib/export-excel";
import { printReport } from "@/lib/export-print";

const WITHDRAWAL_METHODS = [
  { v: "cash", l: "نقد" },
  { v: "bank_transfer", l: "تحويل بنكي" },
  { v: "check", l: "شيك" },
  { v: "other", l: "أخرى" },
];
const methodLabel = (v: string) => WITHDRAWAL_METHODS.find((m) => m.v === v)?.l ?? v;

export function CheckStatementReport() {
  const [f, setF] = useState<ReportFiltersState>(emptyFilters());

  const { data: check } = useQuery({
    queryKey: ["csr-check", f.checkId],
    enabled: !!f.checkId,
    queryFn: async () => {
      const { data } = await supabase
        .from("funding_checks")
        .select("id, check_number, amount, received_date, funders(name), cash_accounts(name)")
        .eq("id", f.checkId!)
        .single();
      return data;
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["csr", f.checkId],
    enabled: !!f.checkId,
    queryFn: async () => {
      const [allocsRes, withdrawsRes, paymentsRes] = await Promise.all([
        supabase
          .from("expense_funding_allocations")
          .select(
            "amount, expense_id, expenses!inner(id, expense_date, amount, description, payment_status, project_id, expense_scope, asset_id, deleted_at, projects(code, name), assets(asset_name), expense_categories(name))",
          )
          .eq("funding_check_id", f.checkId!)
          .is("expenses.deleted_at", null)
          .order("expense_id"),
        (supabase as any)
          .from("withdrawal_funding_allocations")
          .select("amount, owner_withdrawals!inner(id, withdrawal_date, withdrawal_no, person_name, person_role, payment_method, project_id, description, status, deleted_at, projects(code, name))")
          .eq("funding_check_id", f.checkId!)
          .eq("owner_withdrawals.status", "approved")
          .is("owner_withdrawals.deleted_at", null),
        supabase
          .from("payable_payments")
          .select("id, payment_date, amount, payment_method, notes")
          .eq("funding_check_id", f.checkId!),
      ]);

      return {
        allocs: allocsRes.data ?? [],
        withdraws: (withdrawsRes.data ?? []).map((a: any) => ({ ...a.owner_withdrawals, amount: a.amount })),
        payments: paymentsRes.data ?? [],
      };
    },
  });

  const computed = useMemo(() => {
    const allocs = data?.allocs ?? [];
    const withdraws = data?.withdraws ?? [];
    const payments = data?.payments ?? [];
    const expenseTotal = allocs.reduce((s: number, a: any) => s + Number(a.amount), 0);
    const withdrawalTotal = withdraws.reduce((s: number, w: any) => s + Number(w.amount), 0);
    const payableTotal = payments.reduce((s: number, p: any) => s + Number(p.amount), 0);
    const consumed = expenseTotal + withdrawalTotal + payableTotal;
    const original = Number(check?.amount ?? 0);
    const remaining = original - consumed;
    const pct = original > 0 ? (consumed / original) * 100 : 0;
    const projects = new Map<string, { code: string; name: string; amount: number }>();
    allocs.forEach((a: any) => {
      const p = a.expenses?.projects;
      if (!p) return;
      const k = p.code;
      const cur = projects.get(k) ?? { code: p.code, name: p.name, amount: 0 };
      cur.amount += Number(a.amount);
      projects.set(k, cur);
    });
    return {
      expenseTotal,
      withdrawalTotal,
      payableTotal,
      consumed,
      remaining,
      pct,
      projects: Array.from(projects.values()).sort((a, b) => b.amount - a.amount),
      lowBalance: original > 0 && remaining > 0 && remaining / original < 0.1,
      fullyConsumed: remaining <= 0.005,
    };
  }, [data, check]);

  const onExportExcel = () => {
    const expenseRows = (data?.allocs ?? []).map((a: any) => ({
      type: 'expense',
      date: a.expenses?.expense_date,
      ref: a.expenses?.expense_id,
      project: a.expenses?.projects ? `${a.expenses.projects.code} — ${a.expenses.projects.name}` : (a.expenses?.assets?.asset_name ?? "—"),
      scope: a.expenses?.expense_scope,
      category: a.expenses?.expense_categories?.name ?? "—",
      description: a.expenses?.description ?? "",
      status: a.expenses?.payment_status,
      amount: Number(a.amount),
    }));
    const withdrawRows = (data?.withdraws ?? []).map((w: any) => ({
      type: 'withdrawal',
      date: w.withdrawal_date,
      ref: w.withdrawal_no,
      project: w.projects ? `${w.projects.code} — ${w.projects.name}` : "—",
      scope: 'withdrawal',
      category: w.person_role,
      description: w.description ?? "",
      status: 'approved',
      amount: Number(w.amount),
    }));
    exportToExcel(
      [...expenseRows, ...withdrawRows],
      [
        { header: "نوع السجل", key: "type", width: 14 },
        { header: "التاريخ", key: "date", width: 14 },
        { header: "المرجع", key: "ref", width: 18 },
        { header: "المشروع/الأصل", key: "project", width: 28 },
        { header: "النطاق", key: "scope", width: 12 },
        { header: "الفئة / الدور", key: "category", width: 20 },
        { header: "الوصف", key: "description", width: 30 },
        { header: "الحالة", key: "status", width: 10 },
        { header: "المبلغ", key: "amount", width: 16, formatter: (v) => Number(v) },
      ],
      { reportName: `كشف صك — ${check?.check_number ?? ""}` },
    );
  };

  return (
    <div className="space-y-3" dir="rtl">
      <ReportFilters
        value={f}
        onChange={setF}
        onReset={() => setF(emptyFilters())}
        onExportExcel={f.checkId ? onExportExcel : undefined}
        onPrint={f.checkId ? () => printReport(`كشف صك — ${check?.check_number ?? ""}`) : undefined}
        show={["checkId"]}
      />

      {!f.checkId && <EmptyState title="اختر صكاً من الفلاتر لعرض الكشف" />}
      {f.checkId && isLoading && <LoadingState />}

      {f.checkId && check && data && (
        <div className="print-area space-y-3">
          <ReportHeader
            title={`كشف صك — ${check.check_number}`}
            period={periodLabel(f)}
            count={data.allocs.length}
          />

          <SectionCard
            title={`صك ${check.check_number}`}
            right={
              <div className="flex gap-2 flex-wrap">
                {computed.fullyConsumed && <WarnPill tone="bad">مستهلك بالكامل</WarnPill>}
                {!computed.fullyConsumed && computed.lowBalance && (
                  <WarnPill tone="warn">رصيد منخفض</WarnPill>
                )}
                {!computed.fullyConsumed && !computed.lowBalance && (
                  <WarnPill tone="ok">رصيد سليم</WarnPill>
                )}
              </div>
            }
          >
            <div className="text-sm text-muted-foreground">
              الممول: {(check as any).funders?.name} • الإيداع: {(check as any).cash_accounts?.name} •{" "}
              التاريخ: {formatDate(check.received_date)}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Kpi label="المبلغ الأصلي" value={formatCurrency(check.amount)} />
              <Kpi label="المصروفات" value={formatCurrency(computed.expenseTotal)} tone="secondary" />
              <Kpi label="مسحوبات المالكيين" value={formatCurrency(computed.withdrawalTotal)} tone="secondary" />
              <Kpi label="تسويات الذمم" value={formatCurrency(computed.payableTotal)} tone="secondary" />
              <Kpi label="الإجمالي المستهلك" value={formatCurrency(computed.consumed)} tone="bad" />
              <Kpi
                label="المتبقي"
                value={formatCurrency(computed.remaining)}
                tone={computed.fullyConsumed ? "bad" : computed.lowBalance ? "warn" : "ok"}
              />
              <Kpi label="نسبة الاستهلاك" value={`${computed.pct.toFixed(1)}%`} />
            </div>
            <Progress value={Math.min(100, computed.pct)} className="h-2" />
          </SectionCard>

          {computed.projects.length > 0 && (
            <SectionCard title="المشاريع الممولة بهذا الصك">
              <div className="flex flex-wrap gap-2">
                {computed.projects.map((p) => (
                  <Badge key={p.code} variant="outline" title={`${p.code} — ${p.name}`}>
                    {p.code} — {p.name}: {formatCurrency(p.amount)}
                  </Badge>
                ))}
              </div>
            </SectionCard>
          )}

          <SectionCard title={`مسحوبات المالكيين المعتمدة (${data.withdraws.length})`}>
            {data.withdraws.length === 0 ? (
              <EmptyState title="لا توجد مسحوبات معتمدة لهذا الصك" />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>رقم المسحوبة</TableHead>
                      <TableHead>الشخص</TableHead>
                      <TableHead className="hidden md:table-cell">طريقة الدفع</TableHead>
                      <TableHead className="text-left">المبلغ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.withdraws.map((w: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs whitespace-nowrap">{formatDate(w.withdrawal_date)}</TableCell>
                        <TableCell className="text-sm">{w.withdrawal_no}</TableCell>
                        <TableCell className="text-sm">{w.person_name}</TableCell>
                        <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{methodLabel(w.payment_method)}</TableCell>
                        <TableCell className="text-left tabular-nums font-medium whitespace-nowrap">
                          {formatCurrency(w.amount)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </SectionCard>

          <SectionCard title={`المصروفات المخصّصة (${data.allocs.length})`}>
            {data.allocs.length === 0 ? (
              <EmptyState title="لا توجد تخصيصات" />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>المشروع/الأصل</TableHead>
                      <TableHead className="hidden sm:table-cell">الفئة</TableHead>
                      <TableHead className="hidden md:table-cell">الوصف</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead className="text-left">المبلغ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.allocs.map((a: any, i: number) => {
                      const e = a.expenses;
                      return (
                        <TableRow key={i}>
                          <TableCell className="text-xs whitespace-nowrap">
                            {formatDate(e.expense_date)}
                          </TableCell>
                          <TableCell className="text-sm">
                            <div className="truncate max-w-[12rem]">
                              {e.projects ? `${e.projects.code} — ${e.projects.name}` : (e.assets?.asset_name ?? "عام")}
                            </div>
                          </TableCell>
                          <TableCell className="hidden sm:table-cell text-sm">
                            {e.expense_categories?.name ?? "—"}
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                            <div className="truncate max-w-[16rem]">{e.description || "—"}</div>
                          </TableCell>
                          <TableCell className="text-xs">{e.payment_status}</TableCell>
                          <TableCell className="text-left tabular-nums font-medium whitespace-nowrap">
                            {formatCurrency(a.amount)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </SectionCard>
        </div>
      )}
    </div>
  );
}
