import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  ReportFilters,
  type ReportFiltersState,
  emptyFilters,
  periodLabel,
} from "@/components/ReportFilters";
import { Kpi, ReportHeader, SectionCard } from "./ReportShell";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { LoadingState, EmptyState } from "@/components/States";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { exportToExcel } from "@/lib/export-excel";
import { printReport } from "@/lib/export-print";
import { useAuth } from "@/lib/auth";

interface Tx {
  id: string;
  date: string;
  type: "expense" | "withdrawal" | "payable";
  category: string;
  description: string;
  amount: number;
  status?: string;
  creditor?: string | null;
}

export function ProjectStatementReport() {
  const { can, isAdmin } = useAuth();
  const canFinancial = can("reports.financial") || isAdmin;
  const [f, setF] = useState<ReportFiltersState>(emptyFilters());

  const { data: project } = useQuery({
    queryKey: ["psr-project", f.projectId],
    enabled: !!f.projectId,
    queryFn: async () => {
      const { data } = await supabase
        .from("projects")
        .select("id, code, name, status")
        .eq("id", f.projectId!)
        .single();
      return data;
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["psr", f.projectId, f.from, f.to],
    enabled: !!f.projectId,
    queryFn: async () => {
      const pid = f.projectId!;
      const fromQ = (q: any) => (f.from ? q.gte("expense_date", f.from) : q);
      const toQ = (q: any) => (f.to ? q.lte("expense_date", f.to) : q);

      // Expenses for project (paid + payable, scope=project)
      let exQuery = supabase
        .from("expenses")
        .select(
          "id, expense_date, amount, description, payment_status, creditor_name, expense_categories(name)",
        )
        .eq("project_id", pid)
        .is("deleted_at", null);
      exQuery = toQ(fromQ(exQuery));
      const { data: expenses } = await exQuery.order("expense_date", { ascending: false });

      // Allocations against this project's expenses (= funding consumed for project)
      const exIds = (expenses ?? []).map((e: any) => e.id);
      const { data: allocs } =
        exIds.length > 0
          ? await supabase
              .from("expense_funding_allocations")
              .select("amount, expense_id, funding_checks(check_number, funders(name))")
              .in("expense_id", exIds)
          : { data: [] as any[] };

      // Owner withdrawals tied to project (approved, in period)
      let wQuery = supabase
        .from("owner_withdrawals")
        .select("id, withdrawal_no, withdrawal_date, person_name, amount, status")
        .eq("project_id", pid)
        .eq("status", "approved")
        .is("deleted_at", null);
      if (f.from) wQuery = wQuery.gte("withdrawal_date", f.from);
      if (f.to) wQuery = wQuery.lte("withdrawal_date", f.to);
      const { data: withdrawals } = await wQuery.order("withdrawal_date", { ascending: false });

      // Payables for this project's expenses
      const payableExIds = (expenses ?? [])
        .filter((e: any) => e.payment_status === "payable")
        .map((e: any) => e.id);
      const { data: payables } =
        payableExIds.length > 0
          ? await supabase
              .from("payables")
              .select("id, creditor_name, original_amount, paid_amount, status, due_date, expense_id")
              .in("expense_id", payableExIds)
          : { data: [] as any[] };

      // Asset expenses that explicitly mention this project (rare/unused): asset table has no project FK; skip.
      // General expenses allocated to project: business rule undefined → expose as 0.
      return {
        expenses: expenses ?? [],
        allocations: allocs ?? [],
        withdrawals: withdrawals ?? [],
        payables: payables ?? [],
      };
    },
  });

  const totals = useMemo(() => {
    const expenses = data?.expenses ?? [];
    const allocations = data?.allocations ?? [];
    const withdrawals = data?.withdrawals ?? [];
    const payables = data?.payables ?? [];
    const totalExpense = expenses.reduce((s: number, e: any) => s + Number(e.amount), 0);
    const fundedConsumed = allocations.reduce((s: number, a: any) => s + Number(a.amount), 0);
    const totalWithdrawals = withdrawals.reduce((s: number, w: any) => s + Number(w.amount), 0);
    const openPayables = payables
      .filter((p: any) => p.status !== "paid")
      .reduce((s: number, p: any) => s + (Number(p.original_amount) - Number(p.paid_amount)), 0);
    const cashOut = expenses
      .filter((e: any) => e.payment_status === "paid")
      .reduce((s: number, e: any) => s + Number(e.amount), 0);
    return {
      totalExpense,
      fundedConsumed,
      totalWithdrawals,
      openPayables,
      cashOut,
      remaining: fundedConsumed - cashOut - totalWithdrawals,
    };
  }, [data]);

  const monthly = useMemo(() => {
    const m = new Map<string, number>();
    (data?.expenses ?? []).forEach((e: any) => {
      const k = String(e.expense_date).slice(0, 7);
      m.set(k, (m.get(k) ?? 0) + Number(e.amount));
    });
    return Array.from(m.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([month, total]) => ({ month, total }));
  }, [data]);

  const transactions: Tx[] = useMemo(() => {
    const rows: Tx[] = [];
    (data?.expenses ?? []).forEach((e: any) =>
      rows.push({
        id: e.id,
        date: e.expense_date,
        type: e.payment_status === "payable" ? "payable" : "expense",
        category: e.expense_categories?.name ?? "—",
        description: e.description ?? "",
        amount: Number(e.amount),
        status: e.payment_status,
        creditor: e.creditor_name,
      }),
    );
    (data?.withdrawals ?? []).forEach((w: any) =>
      rows.push({
        id: w.id,
        date: w.withdrawal_date,
        type: "withdrawal",
        category: `مسحوبة ${w.withdrawal_no}`,
        description: w.person_name,
        amount: Number(w.amount),
        status: w.status,
      }),
    );
    rows.sort((a, b) => (a.date < b.date ? 1 : -1));
    return rows;
  }, [data]);

  const onExportExcel = () => {
    exportToExcel(
      transactions as any,
      [
        { header: "التاريخ", key: "date", width: 14 },
        { header: "النوع", key: "type", width: 12, formatter: (v) => labelType(v as string) },
        { header: "الفئة", key: "category", width: 24 },
        { header: "الوصف", key: "description", width: 32 },
        { header: "الدائن", key: "creditor", width: 18 },
        { header: "المبلغ", key: "amount", width: 16, formatter: (v) => Number(v) },
      ],
      {
        reportName: `كشف حساب مشروع — ${project?.name ?? ""}`,
        periodLabel: periodLabel(f),
      },
    );
  };

  return (
    <div className="space-y-3" dir="rtl">
      <ReportFilters
        value={f}
        onChange={setF}
        onReset={() => setF(emptyFilters())}
        onExportExcel={f.projectId ? onExportExcel : undefined}
        onPrint={f.projectId ? () => printReport(`كشف حساب مشروع — ${project?.name ?? ""}`) : undefined}
        show={["from", "to", "projectId"]}
      />

      {!f.projectId && (
        <EmptyState title="اختر مشروعاً من الفلاتر لعرض الكشف" />
      )}

      {f.projectId && isLoading && <LoadingState />}

      {f.projectId && data && (
        <div className="print-area space-y-3">
          <ReportHeader
            title={`كشف حساب مشروع — ${project?.name ?? ""} (${project?.code ?? ""})`}
            period={periodLabel(f)}
            count={transactions.length}
          />

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <Kpi label="إجمالي المصروفات" value={formatCurrency(totals.totalExpense)} tone="info" />
            <Kpi label="مدفوع نقداً" value={formatCurrency(totals.cashOut)} tone="bad" />
            <Kpi label="ذمم مفتوحة" value={formatCurrency(totals.openPayables)} tone="warn" />
            <Kpi label="مسحوبات" value={formatCurrency(totals.totalWithdrawals)} tone="warn" />
            <Kpi label="تمويل مستهلك" value={formatCurrency(totals.fundedConsumed)} tone="info" />
            {canFinancial && (
              <Kpi
                label="رصيد الفرق"
                value={formatCurrency(totals.remaining)}
                tone={totals.remaining >= 0 ? "ok" : "bad"}
                hint="تمويل مستهلك − نقد منصرف − مسحوبات"
              />
            )}
          </div>

          {monthly.length > 0 && (
            <SectionCard title="الاتجاه الشهري">
              <div className="h-56 sm:h-72 -mx-2 sm:mx-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthly}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: any) => formatCurrency(v)} />
                    <Bar dataKey="total" fill="oklch(0.6 0.13 195)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </SectionCard>
          )}

          <SectionCard title={`الحركات (${transactions.length})`}>
            {transactions.length === 0 ? (
              <EmptyState title="لا توجد حركات" />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>النوع</TableHead>
                      <TableHead>الفئة/الرقم</TableHead>
                      <TableHead className="hidden md:table-cell">الوصف</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead className="text-left">المبلغ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.map((t) => (
                      <TableRow key={`${t.type}-${t.id}`}>
                        <TableCell className="text-xs whitespace-nowrap">{formatDate(t.date)}</TableCell>
                        <TableCell>
                          <Badge variant={t.type === "withdrawal" ? "secondary" : "outline"}>
                            {labelType(t.type)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          <div className="truncate max-w-[12rem]">{t.category}</div>
                          {t.creditor && (
                            <div className="text-xs text-muted-foreground truncate max-w-[12rem]">
                              للدائن: {t.creditor}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                          <div className="truncate max-w-[16rem]">{t.description || "—"}</div>
                        </TableCell>
                        <TableCell className="text-xs">{t.status ?? "—"}</TableCell>
                        <TableCell className="text-left tabular-nums font-medium whitespace-nowrap">
                          {formatCurrency(t.amount)}
                        </TableCell>
                      </TableRow>
                    ))}
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

function labelType(t: string) {
  if (t === "expense") return "مصروف";
  if (t === "payable") return "ذمة آجلة";
  if (t === "withdrawal") return "مسحوبة";
  return t;
}
