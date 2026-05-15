import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Plus, Pencil } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { formatCurrency, formatDate } from "@/lib/utils";
import { LoadingState, EmptyState } from "@/components/States";

export const Route = createFileRoute("/_authenticated/funding-checks")({ component: ChecksPage });

const statusLabels: Record<string, string> = { active: "نشط", depleted: "مستنفد", cancelled: "ملغي" };
const statusVariants: Record<string, "default" | "secondary" | "destructive"> = {
  active: "default", depleted: "secondary", cancelled: "destructive",
};

function ChecksPage() {
  const qc = useQueryClient();
  const { canWrite } = useAuth();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ funder_id: "", check_number: "", amount: "", received_date: new Date().toISOString().slice(0, 10), status: "active", notes: "" });

  const { data: funders } = useQuery({
    queryKey: ["funders-select"],
    queryFn: async () => (await supabase.from("funders").select("id,name").is("deleted_at", null)).data ?? [],
  });

  const { data, isLoading } = useQuery({
    queryKey: ["funding-checks"],
    queryFn: async () => {
      const { data: checks, error } = await supabase.from("funding_checks")
        .select("*, funders(name)").is("deleted_at", null).order("received_date", { ascending: false });
      if (error) throw error;
      // compute spent per check
      const { data: exp } = await supabase.from("expenses").select("funding_check_id, amount").is("deleted_at", null);
      const spent: Record<string, number> = {};
      (exp ?? []).forEach((e) => { spent[e.funding_check_id] = (spent[e.funding_check_id] ?? 0) + Number(e.amount); });
      return (checks ?? []).map((c) => ({ ...c, spent: spent[c.id] ?? 0, remaining: Number(c.amount) - (spent[c.id] ?? 0) }));
    },
  });

  function openNew() {
    setEditing(null);
    setForm({ funder_id: "", check_number: "", amount: "", received_date: new Date().toISOString().slice(0, 10), status: "active", notes: "" });
    setOpen(true);
  }
  function openEdit(c: any) {
    setEditing(c);
    setForm({ funder_id: c.funder_id, check_number: c.check_number, amount: String(c.amount), received_date: c.received_date, status: c.status, notes: c.notes ?? "" });
    setOpen(true);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = { ...form, amount: Number(form.amount), status: form.status as any };
    const { error } = editing
      ? await supabase.from("funding_checks").update(payload).eq("id", editing.id)
      : await supabase.from("funding_checks").insert(payload);
    if (error) return toast.error("فشل الحفظ", { description: error.message });
    toast.success(editing ? "تم التحديث" : "تمت الإضافة");
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["funding-checks"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  }

  return (
    <div>
      <PageHeader title="صكوك التمويل" description="إدارة صكوك التمويل وتتبع الأرصدة المتبقية"
        actions={canWrite && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button onClick={openNew}><Plus className="size-4" /> صك جديد</Button></DialogTrigger>
            <DialogContent dir="rtl">
              <DialogHeader><DialogTitle>{editing ? "تعديل الصك" : "صك تمويل جديد"}</DialogTitle></DialogHeader>
              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-2"><Label>الممول</Label>
                  <Select value={form.funder_id} onValueChange={(v) => setForm({ ...form, funder_id: v })} required>
                    <SelectTrigger><SelectValue placeholder="اختر الممول" /></SelectTrigger>
                    <SelectContent>{(funders ?? []).map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
                  </Select></div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2"><Label>رقم الصك</Label>
                    <Input required value={form.check_number} onChange={(e) => setForm({ ...form, check_number: e.target.value })} dir="ltr" /></div>
                  <div className="space-y-2"><Label>المبلغ (د.ل)</Label>
                    <Input required type="number" step="0.01" min="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} dir="ltr" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2"><Label>تاريخ الاستلام</Label>
                    <Input required type="date" value={form.received_date} onChange={(e) => setForm({ ...form, received_date: e.target.value })} /></div>
                  <div className="space-y-2"><Label>الحالة</Label>
                    <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.entries(statusLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                    </Select></div>
                </div>
                <div className="space-y-2"><Label>ملاحظات</Label>
                  <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
                <DialogFooter><Button type="submit">حفظ</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      />
      <Card>
        <CardContent className="p-4">
          {isLoading ? <LoadingState /> : (data?.length ?? 0) === 0 ? <EmptyState title="لا توجد صكوك" /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>رقم الصك</TableHead>
                  <TableHead>الممول</TableHead>
                  <TableHead>تاريخ الاستلام</TableHead>
                  <TableHead className="text-left">المبلغ</TableHead>
                  <TableHead className="text-left">المنصرف</TableHead>
                  <TableHead className="text-left">المتبقي</TableHead>
                  <TableHead className="min-w-[140px]">الاستهلاك</TableHead>
                  <TableHead>الحالة</TableHead>
                  {canWrite && <TableHead></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data ?? []).map((c: any) => {
                  const pct = c.amount > 0 ? Math.min(100, (c.spent / Number(c.amount)) * 100) : 0;
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium tabular-nums" dir="ltr">{c.check_number}</TableCell>
                      <TableCell>{c.funders?.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDate(c.received_date)}</TableCell>
                      <TableCell className="text-left tabular-nums font-medium">{formatCurrency(c.amount)}</TableCell>
                      <TableCell className="text-left tabular-nums text-destructive">{formatCurrency(c.spent)}</TableCell>
                      <TableCell className="text-left tabular-nums text-success font-medium">{formatCurrency(c.remaining)}</TableCell>
                      <TableCell><Progress value={pct} /></TableCell>
                      <TableCell><Badge variant={statusVariants[c.status]}>{statusLabels[c.status]}</Badge></TableCell>
                      {canWrite && <TableCell><Button size="sm" variant="ghost" onClick={() => openEdit(c)}><Pencil className="size-3.5" /></Button></TableCell>}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
