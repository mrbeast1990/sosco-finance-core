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
      const { data: allocs } = await supabase
        .from("expense_funding_allocations")
        .select(
          "amount, expense_id, expenses!inner(id, expense_date, amount, description, payment_status, project_id, expense_scope, asset_id, deleted_at, projects(code, name), assets(asset_name), expense_categories(name))",
        )
        .eq("funding_check_id", f.checkId!)
        .is("expenses.deleted_at", null)
        .order("expense_id");

      return { allocs: allocs ?? [] };
    },
  });

  const computed = useMemo(() => {
    const allocs = data?.allocs ?? [];
    const consumed = allocs.reduce((s: number, a: any) => s + Number(a.amount), 0);
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
      consumed,
      remaining,
      pct,
      projects: Array.from(projects.values()).sort((a, b) => b.amount - a.amount),
      lowBalance: original > 0 && remaining > 0 && remaining / original < 0.1,
      fullyConsumed: remaining <= 0.005,
    };
  }, [data, check]);

  const onExportExcel = () => {
    const rows = (data?.allocs ?? []).map((a: any) => ({
      date: a.expenses?.expense_date,
      project: a.expenses?.projects ? `${a.expenses.projects.code} — ${a.expenses.projects.name}` : (a.expenses?.assets?.asset_name ?? "—"),
      scope: a.expenses?.expense_scope,
      category: a.expenses?.expense_categories?.name ?? "—",
      description: a.expenses?.description ?? "",
      status: a.expenses?.payment_status,
      amount: Number(a.amount),
    }));
    exportToExcel(
      rows,
      [
        { header: "التاريخ", key: "date", width: 14 },
        { header: "المشروع/الأصل", key: "project", width: 28 },
        { header: "النطاق", key: "scope", width: 10 },
        { header: "الفئة", key: "category", width: 20 },
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
              <Kpi label="المستهلك" value={formatCurrency(computed.consumed)} tone="bad" />
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
