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
import { LoadingState, EmptyState } from "@/components/States";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { exportToExcel } from "@/lib/export-excel";
import { printReport } from "@/lib/export-print";

interface Row {
  id: string;
  creditor_name: string;
  original_amount: number;
  paid_amount: number;
  remaining: number;
  due_date: string | null;
  status: string;
  days_overdue: number;
  expense_id: string;
  expense_date: string | null;
  project_name: string | null;
}

export function PayablesReport() {
  const [f, setF] = useState<ReportFiltersState>(emptyFilters());
  const [drillId, setDrillId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["payables-report", f.from, f.to, f.projectId, f.creditor, f.paymentStatus],
    queryFn: async () => {
      let q = supabase
        .from("payables")
        .select(
          "id, creditor_name, original_amount, paid_amount, due_date, status, expense_id, expenses!inner(expense_date, project_id, deleted_at, projects(name))",
        )
        .is("expenses.deleted_at", null);
      if (f.creditor) q = q.ilike("creditor_name", `%${f.creditor}%`);
      if (f.projectId) q = q.eq("expenses.project_id", f.projectId);
      if (f.from) q = q.gte("expenses.expense_date", f.from);
      if (f.to) q = q.lte("expenses.expense_date", f.to);
      const { data } = await q.order("due_date", { ascending: true, nullsFirst: false });
      return data ?? [];
    },
  });

  const rows: Row[] = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return (data ?? []).map((p: any) => {
      const remaining = Number(p.original_amount) - Number(p.paid_amount);
      const due = p.due_date ? new Date(p.due_date) : null;
      const overdue = due && remaining > 0 ? Math.floor((today.getTime() - due.getTime()) / 86400000) : 0;
      return {
        id: p.id,
        creditor_name: p.creditor_name,
        original_amount: Number(p.original_amount),
        paid_amount: Number(p.paid_amount),
        remaining,
        due_date: p.due_date,
        status: p.status,
        days_overdue: Math.max(0, overdue),
        expense_id: p.expense_id,
        expense_date: p.expenses?.expense_date,
        project_name: p.expenses?.projects?.name ?? null,
      };
    });
  }, [data]);

  const totals = useMemo(() => {
    const open = rows.filter((r) => r.status === "open");
    const partial = rows.filter((r) => r.status === "partially_paid");
    const paid = rows.filter((r) => r.status === "paid");
    const overdue = rows.filter((r) => r.days_overdue > 0 && r.remaining > 0);
    const sumRemaining = (rs: Row[]) => rs.reduce((s, r) => s + r.remaining, 0);
    return {
      openCount: open.length,
      openAmount: sumRemaining(open),
      partialCount: partial.length,
      partialAmount: sumRemaining(partial),
      paidCount: paid.length,
      paidAmount: paid.reduce((s, r) => s + r.paid_amount, 0),
      overdueCount: overdue.length,
      overdueAmount: sumRemaining(overdue),
      aging: aging(rows),
    };
  }, [rows]);

  const filtered = useMemo(() => {
    if (f.paymentStatus === "paid") return rows.filter((r) => r.status === "paid");
    if (f.paymentStatus === "payable") return rows.filter((r) => r.status !== "paid");
    return rows;
  }, [rows, f.paymentStatus]);

  const onExportExcel = () => {
    exportToExcel(
      filtered as any,
      [
        { header: "الدائن", key: "creditor_name", width: 24 },
        { header: "المشروع", key: "project_name", width: 22 },
        { header: "تاريخ المصروف", key: "expense_date", width: 14 },
        { header: "تاريخ الاستحقاق", key: "due_date", width: 14 },
        { header: "المبلغ الأصلي", key: "original_amount", width: 16, formatter: (v) => Number(v) },
        { header: "المسدّد", key: "paid_amount", width: 16, formatter: (v) => Number(v) },
        { header: "المتبقي", key: "remaining", width: 16, formatter: (v) => Number(v) },
        { header: "أيام التأخير", key: "days_overdue", width: 12, formatter: (v) => Number(v) },
        { header: "الحالة", key: "status", width: 12 },
      ],
      { reportName: "تقرير الذمم الدائنة", periodLabel: periodLabel(f) },
    );
  };

  return (
    <div className="space-y-3" dir="rtl">
      <ReportFilters
        value={f}
        onChange={setF}
        onReset={() => setF(emptyFilters())}
        onExportExcel={onExportExcel}
        onPrint={() => printReport("تقرير الذمم الدائنة")}
        show={["from", "to", "projectId", "creditor", "paymentStatus"]}
      />

      {isLoading && <LoadingState />}

      {!isLoading && (
        <div className="print-area space-y-3">
          <ReportHeader title="تقرير الذمم الدائنة" period={periodLabel(f)} count={filtered.length} />

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Kpi
              label={`مفتوحة (${totals.openCount})`}
              value={formatCurrency(totals.openAmount)}
              tone="warn"
              onClick={() => setF({ ...f, paymentStatus: "payable" })}
            />
            <Kpi
              label={`مسدّدة جزئياً (${totals.partialCount})`}
              value={formatCurrency(totals.partialAmount)}
              tone="info"
            />
            <Kpi
              label={`متأخّرة (${totals.overdueCount})`}
              value={formatCurrency(totals.overdueAmount)}
              tone="bad"
            />
            <Kpi
              label={`مسدّدة (${totals.paidCount})`}
              value={formatCurrency(totals.paidAmount)}
              tone="ok"
              onClick={() => setF({ ...f, paymentStatus: "paid" })}
            />
          </div>

          <SectionCard title="تحليل أعمار الذمم (Aging)">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Kpi label="0–30 يوم" value={formatCurrency(totals.aging.b0)} hint={`${totals.aging.c0} ذمة`} />
              <Kpi label="31–60 يوم" value={formatCurrency(totals.aging.b1)} hint={`${totals.aging.c1} ذمة`} tone="info" />
              <Kpi label="61–90 يوم" value={formatCurrency(totals.aging.b2)} hint={`${totals.aging.c2} ذمة`} tone="warn" />
              <Kpi label="أكثر من 90 يوم" value={formatCurrency(totals.aging.b3)} hint={`${totals.aging.c3} ذمة`} tone="bad" />
            </div>
          </SectionCard>

          <SectionCard title={`السجلات (${filtered.length})`}>
            {filtered.length === 0 ? (
              <EmptyState title="لا توجد ذمم" />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الدائن</TableHead>
                      <TableHead className="hidden sm:table-cell">المشروع</TableHead>
                      <TableHead className="hidden md:table-cell">الاستحقاق</TableHead>
                      <TableHead className="text-left">الأصلي</TableHead>
                      <TableHead className="text-left">المتبقي</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-sm">
                          <div className="truncate max-w-[10rem]">{r.creditor_name}</div>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-xs">
                          <div className="truncate max-w-[10rem]">{r.project_name ?? "—"}</div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-xs whitespace-nowrap">
                          {r.due_date ? formatDate(r.due_date) : "—"}
                          {r.days_overdue > 0 && r.remaining > 0 && (
                            <div className="text-destructive">متأخر {r.days_overdue} يوم</div>
                          )}
                        </TableCell>
                        <TableCell className="text-left tabular-nums whitespace-nowrap">
                          {formatCurrency(r.original_amount)}
                        </TableCell>
                        <TableCell className="text-left tabular-nums font-medium whitespace-nowrap">
                          {formatCurrency(r.remaining)}
                        </TableCell>
                        <TableCell>
                          <StatusPill status={r.status} />
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" onClick={() => setDrillId(r.id)}>
                            تفاصيل
                          </Button>
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

      <PaymentsDialog payableId={drillId} onClose={() => setDrillId(null)} />
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  if (status === "paid") return <WarnPill tone="ok">مسدّدة</WarnPill>;
  if (status === "partially_paid") return <WarnPill tone="warn">جزئية</WarnPill>;
  return <WarnPill tone="bad">مفتوحة</WarnPill>;
}

function aging(rows: Row[]) {
  const r = { b0: 0, b1: 0, b2: 0, b3: 0, c0: 0, c1: 0, c2: 0, c3: 0 };
  rows.forEach((x) => {
    if (x.remaining <= 0) return;
    const d = x.days_overdue;
    if (d <= 30) {
      r.b0 += x.remaining;
      r.c0++;
    } else if (d <= 60) {
      r.b1 += x.remaining;
      r.c1++;
    } else if (d <= 90) {
      r.b2 += x.remaining;
      r.c2++;
    } else {
      r.b3 += x.remaining;
      r.c3++;
    }
  });
  return r;
}

function PaymentsDialog({ payableId, onClose }: { payableId: string | null; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ["payable-payments-drill", payableId],
    enabled: !!payableId,
    queryFn: async () => {
      const [pay, payments] = await Promise.all([
        supabase
          .from("payables")
          .select(
            "id, creditor_name, original_amount, paid_amount, due_date, status, expense_id, expenses(expense_date, description, projects(name))",
          )
          .eq("id", payableId!)
          .single(),
        supabase
          .from("payable_payments")
          .select(
            "id, payment_date, amount, payment_method, notes, cash_accounts(name), funding_checks(check_number)",
          )
          .eq("payable_id", payableId!)
          .order("payment_date", { ascending: false }),
      ]);
      return { payable: pay.data, payments: payments.data ?? [] };
    },
  });

  return (
    <Dialog open={!!payableId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>تفاصيل الذمة وسجل التسديدات</DialogTitle>
        </DialogHeader>
        {data?.payable && (
          <div className="space-y-3" dir="rtl">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Kpi label="الدائن" value={data.payable.creditor_name} />
              <Kpi label="الأصلي" value={formatCurrency(data.payable.original_amount)} />
              <Kpi label="المسدّد" value={formatCurrency(data.payable.paid_amount)} tone="ok" />
              <Kpi
                label="المتبقي"
                value={formatCurrency(Number(data.payable.original_amount) - Number(data.payable.paid_amount))}
                tone="warn"
              />
            </div>
            <div className="text-xs text-muted-foreground">
              المشروع: {(data.payable as any).expenses?.projects?.name ?? "—"} • الاستحقاق:{" "}
              {data.payable.due_date ? formatDate(data.payable.due_date) : "—"}
            </div>
            <div>
              <div className="text-sm font-medium mb-2">سجل التسديدات ({data.payments.length})</div>
              {data.payments.length === 0 ? (
                <EmptyState title="لا توجد تسديدات" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>الطريقة</TableHead>
                      <TableHead>المصدر</TableHead>
                      <TableHead className="text-left">المبلغ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.payments.map((p: any) => (
                      <TableRow key={p.id}>
                        <TableCell className="text-xs whitespace-nowrap">{formatDate(p.payment_date)}</TableCell>
                        <TableCell className="text-xs">{p.payment_method}</TableCell>
                        <TableCell className="text-xs">
                          {p.funding_checks?.check_number
                            ? `صك ${p.funding_checks.check_number}`
                            : p.cash_accounts?.name ?? "—"}
                        </TableCell>
                        <TableCell className="text-left tabular-nums">{formatCurrency(p.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
