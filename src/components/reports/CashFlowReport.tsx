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
import { LoadingState, EmptyState } from "@/components/States";
import { formatCurrency } from "@/lib/utils";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { useAuth } from "@/lib/auth";
import { exportToExcel } from "@/lib/export-excel";
import { printReport } from "@/lib/export-print";

interface MonthRow {
  month: string;
  in: number;
  out: number;
}

export function CashFlowReport() {
  const { can, isAdmin } = useAuth();
  const allowed = can("reports.financial") || isAdmin;
  const [f, setF] = useState<ReportFiltersState>(emptyFilters());

  const { data, isLoading } = useQuery({
    queryKey: ["cashflow", f.from, f.to, f.projectId, f.funderId],
    enabled: allowed,
    queryFn: async () => {
      // Cash IN: funding_checks (received)
      let checks = supabase
        .from("funding_checks")
        .select("id, amount, received_date, funder_id, funders(name)")
        .is("deleted_at", null);
      if (f.funderId) checks = checks.eq("funder_id", f.funderId);
      const { data: ckData } = await checks;

      // Paid expenses (cash out via allocations)
      let exQ = supabase
        .from("expenses")
        .select("id, expense_date, amount, project_id, projects(name)")
        .eq("payment_status", "paid")
        .is("deleted_at", null);
      if (f.projectId) exQ = exQ.eq("project_id", f.projectId);
      const { data: exData } = await exQ;

      // Owner withdrawals approved
      let wQ = supabase
        .from("owner_withdrawals")
        .select("id, withdrawal_date, amount, project_id, projects(name)")
        .eq("status", "approved")
        .is("deleted_at", null);
      if (f.projectId) wQ = wQ.eq("project_id", f.projectId);
      const { data: wData } = await wQ;

      // Payable payments (cash out independent of expense date)
      const { data: ppData } = await supabase
        .from("payable_payments")
        .select(
          "id, payment_date, amount, payables!inner(expense_id, expenses!inner(project_id, projects(name)))",
        );

      return {
        checks: ckData ?? [],
        expenses: exData ?? [],
        withdrawals: wData ?? [],
        payments: ppData ?? [],
      };
    },
  });

  const calc = useMemo(() => {
    if (!data) return null;
    const fromD = f.from ? new Date(f.from) : null;
    const toD = f.to ? new Date(f.to) : null;
    const inRange = (d: string) => {
      const x = new Date(d);
      if (fromD && x < fromD) return false;
      if (toD && x > toD) return false;
      return true;
    };
    const beforeRange = (d: string) => (fromD ? new Date(d) < fromD : false);

    let openingIn = 0,
      openingOut = 0,
      cashIn = 0,
      cashOut = 0;
    const byMonth = new Map<string, MonthRow>();
    const byProject = new Map<string, { name: string; out: number }>();
    const byFunder = new Map<string, { name: string; in: number }>();

    const addMonth = (date: string, key: "in" | "out", amt: number) => {
      const k = date.slice(0, 7);
      const cur = byMonth.get(k) ?? { month: k, in: 0, out: 0 };
      cur[key] += amt;
      byMonth.set(k, cur);
    };

    data.checks.forEach((c: any) => {
      const amt = Number(c.amount);
      if (beforeRange(c.received_date)) openingIn += amt;
      if (inRange(c.received_date)) {
        cashIn += amt;
        addMonth(c.received_date, "in", amt);
        const fk = c.funder_id ?? "—";
        const cur = byFunder.get(fk) ?? { name: c.funders?.name ?? "—", in: 0 };
        cur.in += amt;
        byFunder.set(fk, cur);
      }
    });

    const addOut = (date: string, amt: number, projectId: string | null, projectName: string | null) => {
      if (beforeRange(date)) openingOut += amt;
      if (inRange(date)) {
        cashOut += amt;
        addMonth(date, "out", amt);
        if (projectId) {
          const cur = byProject.get(projectId) ?? { name: projectName ?? "—", out: 0 };
          cur.out += amt;
          byProject.set(projectId, cur);
        }
      }
    };

    data.expenses.forEach((e: any) =>
      addOut(e.expense_date, Number(e.amount), e.project_id, e.projects?.name ?? null),
    );
    data.withdrawals.forEach((w: any) =>
      addOut(w.withdrawal_date, Number(w.amount), w.project_id, w.projects?.name ?? null),
    );
    data.payments.forEach((p: any) => {
      const ex = p.payables?.expenses;
      const pid = ex?.project_id ?? null;
      if (f.projectId && pid !== f.projectId) return;
      addOut(p.payment_date, Number(p.amount), pid, ex?.projects?.name ?? null);
    });

    const opening = openingIn - openingOut;
    const closing = opening + cashIn - cashOut;
    const months = Array.from(byMonth.values()).sort((a, b) => (a.month < b.month ? -1 : 1));
    return {
      opening,
      cashIn,
      cashOut,
      closing,
      months,
      byProject: Array.from(byProject.values()).sort((a, b) => b.out - a.out),
      byFunder: Array.from(byFunder.values()).sort((a, b) => b.in - a.in),
    };
  }, [data, f.from, f.to, f.projectId]);

  if (!allowed) {
    return (
      <EmptyState title="غير مصرح" description="هذا التقرير يتطلب صلاحية reports.financial" />
    );
  }

  const onExportExcel = () => {
    if (!calc) return;
    exportToExcel(
      calc.months as any,
      [
        { header: "الشهر", key: "month", width: 14 },
        { header: "تدفق داخل", key: "in", width: 18, formatter: (v) => Number(v) },
        { header: "تدفق خارج", key: "out", width: 18, formatter: (v) => Number(v) },
        {
          header: "صافي",
          key: "month",
          width: 18,
          formatter: (_v, row: any) => Number(row.in) - Number(row.out),
        },
      ],
      { reportName: "تقرير التدفق النقدي", periodLabel: periodLabel(f) },
    );
  };

  return (
    <div className="space-y-3" dir="rtl">
      <ReportFilters
        value={f}
        onChange={setF}
        onReset={() => setF(emptyFilters())}
        onExportExcel={calc ? onExportExcel : undefined}
        onPrint={() => printReport("تقرير التدفق النقدي")}
        show={["from", "to", "projectId", "funderId"]}
      />

      {isLoading && <LoadingState />}

      {!isLoading && calc && (
        <div className="print-area space-y-3">
          <ReportHeader title="تقرير التدفق النقدي" period={periodLabel(f)} />

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Kpi label="الرصيد الافتتاحي" value={formatCurrency(calc.opening)} tone="info" />
            <Kpi label="تدفق داخل" value={formatCurrency(calc.cashIn)} tone="ok" />
            <Kpi label="تدفق خارج" value={formatCurrency(calc.cashOut)} tone="bad" />
            <Kpi
              label="الرصيد الختامي"
              value={formatCurrency(calc.closing)}
              tone={calc.closing >= 0 ? "ok" : "bad"}
            />
          </div>

          {calc.months.length > 0 && (
            <SectionCard title="المقارنة الشهرية">
              <div className="h-56 sm:h-72 -mx-2 sm:mx-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={calc.months}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: any) => formatCurrency(v)} />
                    <Legend />
                    <Bar dataKey="in" name="داخل" fill="oklch(0.62 0.15 155)" />
                    <Bar dataKey="out" name="خارج" fill="oklch(0.55 0.2 25)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </SectionCard>
          )}

          <div className="grid lg:grid-cols-2 gap-3">
            <SectionCard title="حسب المشروع (المنصرف)">
              {calc.byProject.length === 0 ? (
                <EmptyState title="لا توجد بيانات" />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>المشروع</TableHead>
                        <TableHead className="text-left">المنصرف</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {calc.byProject.map((p, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-sm">
                            <div className="truncate max-w-[14rem]">{p.name}</div>
                          </TableCell>
                          <TableCell className="text-left tabular-nums whitespace-nowrap">
                            {formatCurrency(p.out)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </SectionCard>

            <SectionCard title="حسب الممول (الوارد)">
              {calc.byFunder.length === 0 ? (
                <EmptyState title="لا توجد بيانات" />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>الممول</TableHead>
                        <TableHead className="text-left">الوارد</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {calc.byFunder.map((p, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-sm">
                            <div className="truncate max-w-[14rem]">{p.name}</div>
                          </TableCell>
                          <TableCell className="text-left tabular-nums whitespace-nowrap">
                            {formatCurrency(p.in)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </SectionCard>
          </div>
        </div>
      )}
    </div>
  );
}
