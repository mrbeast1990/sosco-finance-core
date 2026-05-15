import { createFileRoute, Link } from "@tanstack/react-router";
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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Plus, Phone, Wallet, Receipt, FolderKanban } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { formatCurrency, formatDate } from "@/lib/utils";
import { LoadingState, EmptyState } from "@/components/States";

export const Route = createFileRoute("/_authenticated/funders/$funderId")({ component: FunderProfile });

function FunderProfile() {
  const { funderId } = Route.useParams();
  const qc = useQueryClient();
  const { can } = useAuth();
  const canCreateCheck = can("funding.create");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ check_number: "", amount: "", cash_account_id: "", received_date: new Date().toISOString().slice(0, 10), notes: "" });

  const { data: cashAccounts } = useQuery({ queryKey: ["cash-active"],
    queryFn: async () => (await supabase.from("cash_accounts").select("id,name,type").eq("is_active", true).order("name")).data ?? [] });

  const { data: funder, isLoading } = useQuery({
    queryKey: ["funder", funderId],
    queryFn: async () => {
      const { data, error } = await supabase.from("funders").select("*").eq("id", funderId).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: checks } = useQuery({
    queryKey: ["funder-checks", funderId],
    queryFn: async () => (await supabase.from("funding_checks").select("*").eq("funder_id", funderId).is("deleted_at", null).order("received_date", { ascending: false })).data ?? [],
  });

  const checkIds = useMemo(() => (checks ?? []).map((c) => c.id), [checks]);

  const { data: allocations } = useQuery({
    queryKey: ["funder-allocs", funderId, checkIds.join(",")],
    enabled: checkIds.length > 0,
    queryFn: async () => (await supabase.from("expense_funding_allocations")
      .select("funding_check_id, amount, expenses!inner(id, deleted_at, expense_date, description, amount, project_id, projects(name, code), expense_categories:category_id(name))")
      .in("funding_check_id", checkIds)).data ?? [],
  });

  const usedByCheck = useMemo(() => {
    const m = new Map<string, number>();
    (allocations ?? []).forEach((a: any) => {
      if (a.expenses?.deleted_at) return;
      m.set(a.funding_check_id, (m.get(a.funding_check_id) ?? 0) + Number(a.amount));
    });
    return m;
  }, [allocations]);

  const totals = useMemo(() => {
    const totalReceived = (checks ?? []).reduce((s, c) => s + Number(c.amount), 0);
    const totalUsed = Array.from(usedByCheck.values()).reduce((s, v) => s + v, 0);
    return { totalReceived, totalUsed, remaining: totalReceived - totalUsed, checkCount: checks?.length ?? 0 };
  }, [checks, usedByCheck]);

  const expenseRows = useMemo(() => {
    const rows = (allocations ?? []).filter((a: any) => !a.expenses?.deleted_at).map((a: any) => ({
      id: a.expenses.id,
      date: a.expenses.expense_date,
      project: a.expenses.projects,
      category: a.expenses.expense_categories?.name,
      description: a.expenses.description,
      amount: Number(a.amount),
    }));
    return rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [allocations]);

  const projectRows = useMemo(() => {
    const map = new Map<string, { id: string; name: string; code: string; total: number; count: number }>();
    expenseRows.forEach((r: any) => {
      if (!r.project) return;
      const key = r.project.code;
      const cur = map.get(key) ?? { id: key, name: r.project.name, code: r.project.code, total: 0, count: 0 };
      cur.total += r.amount; cur.count += 1; map.set(key, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [expenseRows]);

  async function onCreateCheck(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from("funding_checks").insert({
      funder_id: funderId,
      check_number: form.check_number,
      amount: Number(form.amount),
      received_date: form.received_date,
      notes: form.notes || null,
    });
    if (error) return toast.error("فشل الحفظ", { description: error.message });
    toast.success("تمت إضافة الصك");
    setOpen(false);
    setForm({ check_number: "", amount: "", received_date: new Date().toISOString().slice(0, 10), notes: "" });
    qc.invalidateQueries({ queryKey: ["funder-checks", funderId] });
  }

  if (isLoading) return <LoadingState />;
  if (!funder) return <EmptyState title="الممول غير موجود" />;

  return (
    <div>
      <PageHeader
        title={funder.name}
        description={funder.notes ?? "ملف الممول"}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild><Link to="/funders"><ArrowRight className="size-4" /> عودة</Link></Button>
            {canCreateCheck && (
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild><Button><Plus className="size-4" /> صك جديد</Button></DialogTrigger>
                <DialogContent dir="rtl">
                  <DialogHeader><DialogTitle>إضافة صك تمويل</DialogTitle></DialogHeader>
                  <form onSubmit={onCreateCheck} className="space-y-4">
                    <div className="space-y-2"><Label>رقم الصك</Label>
                      <Input required value={form.check_number} onChange={(e) => setForm({ ...form, check_number: e.target.value })} dir="ltr" /></div>
                    <div className="space-y-2"><Label>المبلغ (د.ل)</Label>
                      <Input required type="number" step="0.01" min="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} dir="ltr" /></div>
                    <div className="space-y-2"><Label>تاريخ الاستلام</Label>
                      <Input required type="date" value={form.received_date} onChange={(e) => setForm({ ...form, received_date: e.target.value })} /></div>
                    <div className="space-y-2"><Label>ملاحظات</Label>
                      <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
                    <DialogFooter><Button type="submit">حفظ</Button></DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <KpiCard icon={<Phone className="size-4" />} label="الهاتف" value={funder.phone ?? "—"} ltr />
        <KpiCard icon={<Wallet className="size-4" />} label="إجمالي التمويل" value={formatCurrency(totals.totalReceived)} highlight />
        <KpiCard icon={<Receipt className="size-4" />} label="إجمالي المصروف" value={formatCurrency(totals.totalUsed)} />
        <KpiCard icon={<FolderKanban className="size-4" />} label="الرصيد المتبقي" value={formatCurrency(totals.remaining)} positive={totals.remaining >= 0} />
      </div>

      <Tabs defaultValue="checks">
        <TabsList>
          <TabsTrigger value="checks">الصكوك ({totals.checkCount})</TabsTrigger>
          <TabsTrigger value="expenses">المصروفات ({expenseRows.length})</TabsTrigger>
          <TabsTrigger value="projects">المشاريع ({projectRows.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="checks">
          <Card><CardContent className="p-4">
            {(checks ?? []).length === 0 ? <EmptyState title="لا توجد صكوك" /> : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead>رقم الصك</TableHead><TableHead>تاريخ الاستلام</TableHead>
                  <TableHead>المبلغ</TableHead><TableHead>المستخدم</TableHead>
                  <TableHead>المتبقي</TableHead><TableHead className="w-48">نسبة الاستهلاك</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {(checks ?? []).map((c) => {
                    const used = usedByCheck.get(c.id) ?? 0;
                    const remaining = Number(c.amount) - used;
                    const pct = Number(c.amount) > 0 ? (used / Number(c.amount)) * 100 : 0;
                    return (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium" dir="ltr">{c.check_number}</TableCell>
                        <TableCell>{formatDate(c.received_date)}</TableCell>
                        <TableCell className="tabular-nums">{formatCurrency(Number(c.amount))}</TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">{formatCurrency(used)}</TableCell>
                        <TableCell className={`tabular-nums font-semibold ${remaining <= 0 ? "text-destructive" : "text-primary"}`}>{formatCurrency(remaining)}</TableCell>
                        <TableCell><Progress value={pct} className="h-2" /><span className="text-xs text-muted-foreground">{pct.toFixed(1)}%</span></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="expenses">
          <Card><CardContent className="p-4">
            {expenseRows.length === 0 ? <EmptyState title="لا توجد مصروفات" /> : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead>التاريخ</TableHead><TableHead>المشروع</TableHead>
                  <TableHead>الفئة</TableHead><TableHead>الوصف</TableHead><TableHead>المبلغ</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {expenseRows.map((r: any) => (
                    <TableRow key={r.id + r.amount}>
                      <TableCell>{formatDate(r.date)}</TableCell>
                      <TableCell>{r.project ? <Badge variant="secondary">{r.project.code} — {r.project.name}</Badge> : "—"}</TableCell>
                      <TableCell className="text-sm">{r.category ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{r.description ?? "—"}</TableCell>
                      <TableCell className="tabular-nums font-semibold">{formatCurrency(r.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="projects">
          <Card><CardContent className="p-4">
            {projectRows.length === 0 ? <EmptyState title="لا توجد مشاريع مرتبطة" /> : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead>المشروع</TableHead><TableHead>عدد المصروفات</TableHead><TableHead>الإجمالي</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {projectRows.map((p) => (
                    <TableRow key={p.code}>
                      <TableCell><Badge variant="secondary">{p.code} — {p.name}</Badge></TableCell>
                      <TableCell className="tabular-nums">{p.count}</TableCell>
                      <TableCell className="tabular-nums font-semibold">{formatCurrency(p.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function KpiCard({ icon, label, value, highlight, positive, ltr }: { icon: React.ReactNode; label: string; value: string; highlight?: boolean; positive?: boolean; ltr?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">{icon}{label}</div>
        <div className={`text-xl font-bold tabular-nums ${highlight ? "text-primary" : positive === false ? "text-destructive" : ""}`} dir={ltr ? "ltr" : undefined}>{value}</div>
      </CardContent>
    </Card>
  );
}
