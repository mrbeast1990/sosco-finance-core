import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoadingState, EmptyState } from "@/components/States";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { HandCoins, History } from "lucide-react";

export const Route = createFileRoute("/_authenticated/payables")({ component: PayablesPage });

function PayablesPage() {
  const qc = useQueryClient();
  const { can, user } = useAuth();
  const canPay = can("payables.pay");
  const [tab, setTab] = useState("open");
  const [paying, setPaying] = useState<any | null>(null);
  const [historyFor, setHistoryFor] = useState<any | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["payables"],
    queryFn: async () => {
      const { data, error } = await supabase.from("payables")
        .select("*, expenses!inner(id, expense_date, amount, description, project_id, asset_id, expense_categories(name), projects(name, code), assets(asset_name, asset_code))")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const today = new Date().toISOString().slice(0, 10);
  const enriched = (data ?? []).map((p: any) => ({
    ...p,
    remaining: Number(p.original_amount) - Number(p.paid_amount),
    is_overdue: p.due_date && p.due_date < today && p.status !== "paid",
  }));

  const buckets = useMemo(() => ({
    open: enriched.filter((p) => p.status === "open" || p.status === "partially_paid"),
    overdue: enriched.filter((p) => p.is_overdue),
    paid: enriched.filter((p) => p.status === "paid"),
    all: enriched,
  }), [enriched]);

  const totals = {
    openSum: buckets.open.reduce((s, p) => s + p.remaining, 0),
    overdueSum: buckets.overdue.reduce((s, p) => s + p.remaining, 0),
    paidSum: buckets.paid.reduce((s, p) => s + Number(p.original_amount), 0),
  };

  return (
    <div>
      <PageHeader title="الذمم الدائنة" description="المصروفات الآجلة والذمم المستحقة للموردين/الدائنين" />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <Kpi label="إجمالي الذمم المفتوحة" value={formatCurrency(totals.openSum)} tone="warn" />
        <Kpi label="الذمم المتأخرة" value={formatCurrency(totals.overdueSum)} tone="bad" />
        <Kpi label="ذمم مسددة بالكامل" value={formatCurrency(totals.paidSum)} tone="ok" />
      </div>

      <Card><CardContent className="p-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="open">مفتوحة ({buckets.open.length})</TabsTrigger>
            <TabsTrigger value="overdue">متأخرة ({buckets.overdue.length})</TabsTrigger>
            <TabsTrigger value="paid">مسددة ({buckets.paid.length})</TabsTrigger>
            <TabsTrigger value="all">الكل ({buckets.all.length})</TabsTrigger>
          </TabsList>

          {(["open", "overdue", "paid", "all"] as const).map((k) => (
            <TabsContent value={k} key={k}>
              {isLoading ? <LoadingState /> : buckets[k].length === 0 ? <EmptyState title="لا توجد ذمم" /> : (
                <div className="overflow-x-auto -mx-4 px-4">
                  <Table className="min-w-[900px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>تاريخ المصروف</TableHead>
                        <TableHead>الدائن</TableHead>
                        <TableHead>الفئة / المشروع</TableHead>
                        <TableHead className="text-left">الأصلي</TableHead>
                        <TableHead className="text-left">المدفوع</TableHead>
                        <TableHead className="text-left">المتبقي</TableHead>
                        <TableHead>الاستحقاق</TableHead>
                        <TableHead>الحالة</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {buckets[k].map((p: any) => (
                        <TableRow key={p.id}>
                          <TableCell className="text-sm whitespace-nowrap">{formatDate(p.expenses?.expense_date)}</TableCell>
                          <TableCell className="font-medium">{p.creditor_name}</TableCell>
                          <TableCell className="text-xs">
                            <div>{p.expenses?.expense_categories?.name ?? "—"}</div>
                            <div className="text-muted-foreground">{p.expenses?.projects?.name ?? p.expenses?.assets?.asset_name ?? "—"}</div>
                          </TableCell>
                          <TableCell className="text-left tabular-nums">{formatCurrency(p.original_amount)}</TableCell>
                          <TableCell className="text-left tabular-nums text-success">{formatCurrency(p.paid_amount)}</TableCell>
                          <TableCell className="text-left tabular-nums font-bold">{formatCurrency(p.remaining)}</TableCell>
                          <TableCell className="text-sm whitespace-nowrap">
                            {p.due_date ? formatDate(p.due_date) : "—"}
                          </TableCell>
                          <TableCell><StatusBadge p={p} /></TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button size="sm" variant="ghost" onClick={() => setHistoryFor(p)} title="السجل">
                                <History className="size-3.5" />
                              </Button>
                              {canPay && p.status !== "paid" && (
                                <Button size="sm" variant="default" onClick={() => setPaying(p)}>
                                  <HandCoins className="size-3.5" /> تسديد
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </CardContent></Card>

      <PayDialog payable={paying} onClose={() => setPaying(null)} onPaid={() => { setPaying(null); qc.invalidateQueries(); }} userId={user?.id ?? ""} />
      <HistoryDialog payable={historyFor} onClose={() => setHistoryFor(null)} />
    </div>
  );
}

function StatusBadge({ p }: { p: any }) {
  if (p.is_overdue) return <Badge variant="destructive">متأخرة</Badge>;
  if (p.status === "paid") return <Badge className="bg-success text-success-foreground">مسددة</Badge>;
  if (p.status === "partially_paid") return <Badge variant="outline" className="border-primary text-primary">مسددة جزئياً</Badge>;
  return <Badge variant="secondary">مفتوحة</Badge>;
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "bad" }) {
  const cls = tone === "ok" ? "text-success" : tone === "bad" ? "text-destructive" : tone === "warn" ? "text-primary" : "";
  return (
    <Card><CardContent className="p-4">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${cls}`}>{value}</div>
    </CardContent></Card>
  );
}

function PayDialog({ payable, onClose, onPaid, userId }: { payable: any | null; onClose: () => void; onPaid: () => void; userId: string }) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    payment_date: new Date().toISOString().slice(0, 10),
    amount: "",
    payment_method: "cash" as "cash" | "bank_transfer" | "check" | "other",
    source: "cash_account" as "cash_account" | "funding_check",
    cash_account_id: "",
    funding_check_id: "",
    notes: "",
  });
  const [file, setFile] = useState<File | null>(null);

  const { data: cashAccounts } = useQuery({
    queryKey: ["payables-cash"],
    queryFn: async () => (await supabase.from("cash_accounts").select("id,name")).data ?? [],
  });
  const { data: checks } = useQuery({
    queryKey: ["payables-checks"],
    queryFn: async () => (await supabase.from("funding_checks")
      .select("id, check_number, amount, cash_accounts(name), funders(name)")
      .is("deleted_at", null)).data ?? [],
  });

  if (!payable) return null;
  const remaining = Number(payable.original_amount) - Number(payable.paid_amount);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(form.amount);
    if (!amt || amt <= 0) return toast.error("أدخل مبلغاً صحيحاً");
    if (amt > remaining) return toast.error(`المبلغ يتجاوز المتبقي (${formatCurrency(remaining)})`);
    if (form.source === "cash_account" && !form.cash_account_id) return toast.error("اختر حساب الدفع");
    if (form.source === "funding_check" && !form.funding_check_id) return toast.error("اختر الصك");
    setBusy(true);
    try {
      let attachment_url: string | null = null;
      if (file && userId) {
        const path = `${userId}/payable-${Date.now()}-${file.name}`;
        const up = await supabase.storage.from("expense-attachments").upload(path, file);
        if (up.error) throw up.error;
        attachment_url = up.data.path;
      }
      const { error } = await supabase.rpc("pay_payable_atomic", {
        _payable_id: payable.id,
        _payment_date: form.payment_date,
        _amount: amt,
        _payment_method: form.payment_method,
        _cash_account_id: form.source === "cash_account" ? form.cash_account_id : null,
        _funding_check_id: form.source === "funding_check" ? form.funding_check_id : null,
        _attachment_url: attachment_url,
        _notes: form.notes || null,
      } as any);
      if (error) throw error;
      toast.success("تم تسديد الذمة", { description: "تم إنشاء قيد محاسبي وتحديث الرصيد" });
      onPaid();
    } catch (err: any) {
      toast.error("فشل التسديد", { description: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader><DialogTitle>تسديد ذمة — {payable.creditor_name}</DialogTitle></DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="rounded-md bg-muted/40 border p-3 text-sm grid grid-cols-3 gap-2">
            <div><div className="text-xs text-muted-foreground">الأصلي</div><div className="font-bold tabular-nums">{formatCurrency(payable.original_amount)}</div></div>
            <div><div className="text-xs text-muted-foreground">المدفوع</div><div className="font-bold tabular-nums text-success">{formatCurrency(payable.paid_amount)}</div></div>
            <div><div className="text-xs text-muted-foreground">المتبقي</div><div className="font-bold tabular-nums text-primary">{formatCurrency(remaining)}</div></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label>تاريخ الدفع</Label>
              <Input required type="date" value={form.payment_date} onChange={(e) => setForm({ ...form, payment_date: e.target.value })} /></div>
            <div className="space-y-2"><Label>المبلغ</Label>
              <Input required type="number" step="0.01" min="0.01" max={remaining} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} dir="ltr" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label>طريقة الدفع</Label>
              <Select value={form.payment_method} onValueChange={(v: any) => setForm({ ...form, payment_method: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">نقداً</SelectItem>
                  <SelectItem value="bank_transfer">تحويل بنكي</SelectItem>
                  <SelectItem value="check">شيك</SelectItem>
                  <SelectItem value="other">أخرى</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>مصدر الدفع</Label>
              <Select value={form.source} onValueChange={(v: any) => setForm({ ...form, source: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash_account">حساب نقدي/بنكي</SelectItem>
                  <SelectItem value="funding_check">صك تمويل</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {form.source === "cash_account" ? (
            <div className="space-y-2"><Label>الحساب</Label>
              <Select value={form.cash_account_id} onValueChange={(v) => setForm({ ...form, cash_account_id: v })}>
                <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                <SelectContent>{(cashAccounts ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-2"><Label>الصك</Label>
              <Select value={form.funding_check_id} onValueChange={(v) => setForm({ ...form, funding_check_id: v })}>
                <SelectTrigger><SelectValue placeholder="اختر صك" /></SelectTrigger>
                <SelectContent>{(checks ?? []).map((x: any) => (
                  <SelectItem key={x.id} value={x.id}>صك {x.check_number} — {x.funders?.name} — {x.cash_accounts?.name}</SelectItem>
                ))}</SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2"><Label>مرفق (اختياري)</Label>
            <Input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div className="space-y-2"><Label>ملاحظات</Label>
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <DialogFooter><Button type="submit" disabled={busy}>{busy ? "جاري التسديد..." : "تسديد"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({ payable, onClose }: { payable: any | null; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["payable-payments", payable?.id],
    enabled: !!payable,
    queryFn: async () => (await supabase.from("payable_payments")
      .select("*, cash_accounts(name), funding_checks(check_number)")
      .eq("payable_id", payable.id)
      .order("payment_date", { ascending: false })).data ?? [],
  });

  if (!payable) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="max-w-2xl">
        <DialogHeader><DialogTitle>سجل التسديدات — {payable.creditor_name}</DialogTitle></DialogHeader>
        {isLoading ? <LoadingState /> : (data?.length ?? 0) === 0 ? <EmptyState title="لا توجد تسديدات" /> : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>التاريخ</TableHead><TableHead>الطريقة</TableHead>
              <TableHead>المصدر</TableHead><TableHead className="text-left">المبلغ</TableHead>
              <TableHead>ملاحظات</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {(data ?? []).map((row: any) => (
                <TableRow key={row.id}>
                  <TableCell>{formatDate(row.payment_date)}</TableCell>
                  <TableCell className="text-sm">{methodLabel(row.payment_method)}</TableCell>
                  <TableCell className="text-xs">
                    {row.funding_checks?.check_number ? <span dir="ltr">صك {row.funding_checks.check_number}</span> : row.cash_accounts?.name ?? "—"}
                  </TableCell>
                  <TableCell className="text-left tabular-nums font-medium">{formatCurrency(row.amount)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{row.notes ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}

function methodLabel(m: string) {
  return { cash: "نقداً", bank_transfer: "تحويل بنكي", check: "شيك", other: "أخرى" }[m] ?? m;
}
