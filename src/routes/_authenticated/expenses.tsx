import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
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
import { Plus, Search, Paperclip } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { formatCurrency, formatDate } from "@/lib/utils";
import { LoadingState, EmptyState } from "@/components/States";

export const Route = createFileRoute("/_authenticated/expenses")({ component: ExpensesPage });

function ExpensesPage() {
  const qc = useQueryClient();
  const { canWrite, user } = useAuth();
  const [search, setSearch] = useState("");
  const [filterProject, setFilterProject] = useState("all");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    project_id: "", funding_check_id: "", category_id: "",
    amount: "", expense_date: new Date().toISOString().slice(0, 10), description: "",
  });

  const { data: projects } = useQuery({ queryKey: ["projects-sel"],
    queryFn: async () => (await supabase.from("projects").select("id,name,code").is("deleted_at", null)).data ?? [] });
  const { data: checks } = useQuery({ queryKey: ["checks-sel"],
    queryFn: async () => (await supabase.from("funding_checks").select("id, check_number, amount, funders(name)").is("deleted_at", null).eq("status", "active")).data ?? [] });
  const { data: cats } = useQuery({ queryKey: ["cats-sel"],
    queryFn: async () => (await supabase.from("expense_categories").select("id,name").order("name")).data ?? [] });
  const { data: spentMap } = useQuery({ queryKey: ["spent-map"],
    queryFn: async () => {
      const { data } = await supabase.from("expenses").select("funding_check_id, amount").is("deleted_at", null);
      const m: Record<string, number> = {};
      (data ?? []).forEach((e) => { m[e.funding_check_id] = (m[e.funding_check_id] ?? 0) + Number(e.amount); });
      return m;
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["expenses"],
    queryFn: async () => {
      const { data, error } = await supabase.from("expenses")
        .select("*, projects(name, code), funding_checks(check_number), expense_categories(name)")
        .is("deleted_at", null).order("expense_date", { ascending: false }).limit(500);
      if (error) throw error;
      return data;
    },
  });

  const filtered = useMemo(() => (data ?? []).filter((e: any) => {
    if (filterProject !== "all" && e.project_id !== filterProject) return false;
    if (!search) return true;
    return (e.description ?? "").includes(search) || (e.projects?.name ?? "").includes(search) || (e.funding_checks?.check_number ?? "").includes(search);
  }), [data, search, filterProject]);

  const selectedCheck = (checks ?? []).find((c: any) => c.id === form.funding_check_id);
  const remaining = selectedCheck ? Number(selectedCheck.amount) - (spentMap?.[selectedCheck.id] ?? 0) : 0;
  const amountNum = Number(form.amount) || 0;
  const overspend = !!selectedCheck && amountNum > remaining;

  function openNew() {
    setForm({ project_id: "", funding_check_id: "", category_id: "", amount: "",
      expense_date: new Date().toISOString().slice(0, 10), description: "" });
    setFile(null);
    setOpen(true);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (overspend) return toast.error("المبلغ يتجاوز الرصيد المتبقي للصك");
    setBusy(true);
    try {
      let attachment_url: string | null = null;
      if (file) {
        const path = `${user!.id}/${Date.now()}-${file.name}`;
        const up = await supabase.storage.from("expense-attachments").upload(path, file);
        if (up.error) throw up.error;
        attachment_url = up.data.path;
      }
      const { error } = await supabase.from("expenses").insert({
        project_id: form.project_id,
        funding_check_id: form.funding_check_id,
        category_id: form.category_id,
        amount: Number(form.amount),
        expense_date: form.expense_date,
        description: form.description || null,
        attachment_url,
      });
      if (error) throw error;
      toast.success("تم تسجيل المصروف", { description: "تم إنشاء قيد محاسبي تلقائياً" });
      setOpen(false);
      qc.invalidateQueries();
    } catch (err: any) {
      toast.error("فشل الحفظ", { description: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function downloadAttachment(path: string) {
    const { data, error } = await supabase.storage.from("expense-attachments").createSignedUrl(path, 60);
    if (error || !data) return toast.error("فشل تحميل المرفق");
    window.open(data.signedUrl, "_blank");
  }

  return (
    <div>
      <PageHeader title="المصروفات" description="تسجيل المصروفات وربطها بالمشاريع وصكوك التمويل"
        actions={canWrite && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button onClick={openNew}><Plus className="size-4" /> مصروف جديد</Button></DialogTrigger>
            <DialogContent dir="rtl" className="max-w-xl">
              <DialogHeader><DialogTitle>تسجيل مصروف جديد</DialogTitle></DialogHeader>
              <form onSubmit={onSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2"><Label>المشروع</Label>
                    <Select value={form.project_id} onValueChange={(v) => setForm({ ...form, project_id: v })} required>
                      <SelectTrigger><SelectValue placeholder="اختر المشروع" /></SelectTrigger>
                      <SelectContent>{(projects ?? []).map((p: any) => <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>)}</SelectContent>
                    </Select></div>
                  <div className="space-y-2"><Label>فئة المصروف</Label>
                    <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })} required>
                      <SelectTrigger><SelectValue placeholder="اختر الفئة" /></SelectTrigger>
                      <SelectContent>{(cats ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                    </Select></div>
                </div>
                <div className="space-y-2"><Label>صك التمويل</Label>
                  <Select value={form.funding_check_id} onValueChange={(v) => setForm({ ...form, funding_check_id: v })} required>
                    <SelectTrigger><SelectValue placeholder="اختر الصك" /></SelectTrigger>
                    <SelectContent>{(checks ?? []).map((c: any) => {
                      const rem = Number(c.amount) - (spentMap?.[c.id] ?? 0);
                      return <SelectItem key={c.id} value={c.id}>صك {c.check_number} — {c.funders?.name} — متبقي {formatCurrency(rem)}</SelectItem>;
                    })}</SelectContent>
                  </Select>
                  {selectedCheck && (
                    <div className="text-xs rounded-md bg-muted p-2 mt-1">
                      <div className="flex justify-between"><span className="text-muted-foreground">الرصيد المتبقي:</span><span className="font-medium tabular-nums">{formatCurrency(remaining)}</span></div>
                      {amountNum > 0 && (
                        <div className="flex justify-between mt-1">
                          <span className="text-muted-foreground">بعد هذا المصروف:</span>
                          <span className={`font-medium tabular-nums ${overspend ? "text-destructive" : "text-success"}`}>{formatCurrency(remaining - amountNum)}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2"><Label>المبلغ (د.ل)</Label>
                    <Input required type="number" step="0.01" min="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} dir="ltr" />
                    {overspend && <p className="text-xs text-destructive">المبلغ يتجاوز الرصيد المتبقي</p>}
                  </div>
                  <div className="space-y-2"><Label>التاريخ</Label>
                    <Input required type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} /></div>
                </div>
                <div className="space-y-2"><Label>الوصف</Label>
                  <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
                <div className="space-y-2"><Label>المرفق (اختياري)</Label>
                  <Input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
                <DialogFooter>
                  <Button type="submit" disabled={busy || overspend}>{busy ? "جاري الحفظ..." : "حفظ المصروف"}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      />
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-2 mb-4">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input placeholder="بحث..." className="pr-9" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={filterProject} onValueChange={setFilterProject}>
              <SelectTrigger className="sm:w-64"><SelectValue placeholder="جميع المشاريع" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">جميع المشاريع</SelectItem>
                {(projects ?? []).map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {isLoading ? <LoadingState /> : filtered.length === 0 ? <EmptyState title="لا توجد مصروفات" /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>المشروع</TableHead>
                  <TableHead>الفئة</TableHead>
                  <TableHead>الصك</TableHead>
                  <TableHead>الوصف</TableHead>
                  <TableHead className="text-left">المبلغ</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((e: any) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(e.expense_date)}</TableCell>
                    <TableCell><div className="font-medium">{e.projects?.name}</div><div className="text-xs text-muted-foreground tabular-nums" dir="ltr">{e.projects?.code}</div></TableCell>
                    <TableCell>{e.expense_categories?.name}</TableCell>
                    <TableCell className="tabular-nums" dir="ltr">{e.funding_checks?.check_number}</TableCell>
                    <TableCell className="text-muted-foreground text-sm max-w-[240px] truncate">{e.description ?? "—"}</TableCell>
                    <TableCell className="text-left font-medium tabular-nums">{formatCurrency(e.amount)}</TableCell>
                    <TableCell>
                      {e.attachment_url && (
                        <Button size="sm" variant="ghost" onClick={() => downloadAttachment(e.attachment_url)}>
                          <Paperclip className="size-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
