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
import { Plus, Search, Paperclip, X, FileSpreadsheet, Pencil, Undo2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { formatCurrency, formatDate } from "@/lib/utils";
import { LoadingState, EmptyState } from "@/components/States";

export const Route = createFileRoute("/_authenticated/expenses")({ component: ExpensesPage });

type Allocation = { funding_check_id: string; amount: string };

function ExpensesPage() {
  const qc = useQueryClient();
  const { can, user } = useAuth();
  const canCreate = can("expenses.create");
  const canEdit = can("expenses.edit");
  const canDelete = can("expenses.delete");
  const [search, setSearch] = useState("");
  const [editingExp, setEditingExp] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({ description: "", expense_date: "" });
  const [reversing, setReversing] = useState<any | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [filterProject, setFilterProject] = useState("all");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    project_id: "", category_id: "",
    amount: "", expense_date: new Date().toISOString().slice(0, 10), description: "",
  });
  const [allocations, setAllocations] = useState<Allocation[]>([{ funding_check_id: "", amount: "" }]);

  const { data: projects } = useQuery({ queryKey: ["projects-sel"],
    queryFn: async () => (await supabase.from("projects").select("id,name,code").is("deleted_at", null)).data ?? [] });
  const { data: cats } = useQuery({ queryKey: ["cats-sel"],
    queryFn: async () => (await supabase.from("expense_categories").select("id,name").order("name")).data ?? [] });
  const { data: checks } = useQuery({ queryKey: ["checks-sel"],
    queryFn: async () => (await supabase.from("funding_checks")
      .select("id, check_number, amount, cash_account_id, funders(name), cash_accounts(name)")
      .is("deleted_at", null)).data ?? [] });
  const { data: spentMap } = useQuery({ queryKey: ["spent-map"],
    queryFn: async () => {
      const { data } = await supabase.from("expense_funding_allocations")
        .select("funding_check_id, amount, expenses!inner(deleted_at)")
        .is("expenses.deleted_at", null);
      const m: Record<string, number> = {};
      (data ?? []).forEach((a: any) => { m[a.funding_check_id] = (m[a.funding_check_id] ?? 0) + Number(a.amount); });
      return m;
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["expenses"],
    queryFn: async () => {
      const { data, error } = await supabase.from("expenses")
        .select("*, projects(name, code), expense_categories(name), expense_funding_allocations(amount, funding_checks(check_number, cash_accounts(name)))")
        .is("deleted_at", null).order("expense_date", { ascending: false }).limit(500);
      if (error) throw error;
      return data;
    },
  });

  const filtered = useMemo(() => (data ?? []).filter((e: any) => {
    if (filterProject !== "all" && e.project_id !== filterProject) return false;
    if (!search) return true;
    return (e.description ?? "").includes(search) || (e.projects?.name ?? "").includes(search);
  }), [data, search, filterProject]);

  const amountNum = Number(form.amount) || 0;
  const allocTotal = allocations.reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const allocMismatch = amountNum > 0 && Math.round(allocTotal * 100) !== Math.round(amountNum * 100);

  function openNew() {
    setForm({ project_id: "", category_id: "", amount: "",
      expense_date: new Date().toISOString().slice(0, 10), description: "" });
    setAllocations([{ funding_check_id: "", amount: "" }]);
    setFile(null);
    setExcelFile(null);
    setOpen(true);
  }

  // Auto-derived: which cash accounts will be debited and by how much
  const cashSummary = useMemo(() => {
    const m = new Map<string, number>();
    allocations.forEach((a) => {
      if (!a.funding_check_id || !a.amount) return;
      const c = (checks ?? []).find((x: any) => x.id === a.funding_check_id);
      const name = c?.cash_accounts?.name;
      if (!name) return;
      m.set(name, (m.get(name) ?? 0) + Number(a.amount));
    });
    return Array.from(m.entries());
  }, [allocations, checks]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (allocMismatch) return toast.error("مجموع التخصيصات لا يساوي مبلغ المصروف");
    if (allocations.some((a) => !a.funding_check_id || !a.amount)) return toast.error("أكمل بيانات التخصيصات");
    setBusy(true);
    try {
      let attachment_url: string | null = null;
      let excel_attachment_url: string | null = null;
      if (file) {
        const path = `${user!.id}/${Date.now()}-${file.name}`;
        const up = await supabase.storage.from("expense-attachments").upload(path, file);
        if (up.error) throw up.error;
        attachment_url = up.data.path;
      }
      if (excelFile) {
        const path = `${user!.id}/excel-${Date.now()}-${excelFile.name}`;
        const up = await supabase.storage.from("expense-attachments").upload(path, excelFile);
        if (up.error) throw up.error;
        excel_attachment_url = up.data.path;
      }
      const { error } = await supabase.rpc("create_expense_atomic", {
        _project_id: form.project_id,
        _category_id: form.category_id,
        _amount: Number(form.amount),
        _expense_date: form.expense_date,
        _description: form.description || "",
        _attachment_url: attachment_url ?? "",
        _allocations: allocations.map((a) => ({ funding_check_id: a.funding_check_id, amount: Number(a.amount) })),
        _excel_attachment_url: excel_attachment_url,
      } as any);
      if (error) throw error;
      toast.success("تم تسجيل المصروف", { description: "تم إنشاء قيد محاسبي وتخصيصات التمويل" });
      setOpen(false);
      qc.invalidateQueries();
    } catch (err: any) {
      toast.error("فشل الحفظ", { description: err.message });
    } finally {
      setBusy(false);
    }
  }

  function openEditExp(e: any) {
    setEditingExp(e);
    setEditForm({ description: e.description ?? "", expense_date: e.expense_date });
  }

  async function onSaveEditExp(ev: React.FormEvent) {
    ev.preventDefault();
    if (!editingExp) return;
    const { error } = await supabase.from("expenses").update({
      description: editForm.description || null,
      expense_date: editForm.expense_date,
      updated_at: new Date().toISOString(),
      updated_by: user!.id,
    }).eq("id", editingExp.id);
    if (error) return toast.error("فشل التعديل", { description: error.message });
    toast.success("تم تحديث المصروف");
    setEditingExp(null);
    qc.invalidateQueries({ queryKey: ["expenses"] });
  }

  async function onConfirmReverse() {
    if (!reversing) return;
    const { error } = await supabase.rpc("reverse_expense_atomic", {
      _expense_id: reversing.id,
      _reason: reverseReason || "حذف بدون سبب",
    });
    if (error) return toast.error("فشل عكس المصروف", { description: error.message });
    toast.success("تم عكس المصروف وإنشاء قيد عكسي");
    setReversing(null);
    setReverseReason("");
    qc.invalidateQueries();
  }

  async function downloadAttachment(path: string) {
    const { data, error } = await supabase.storage.from("expense-attachments").createSignedUrl(path, 60);
    if (error || !data) return toast.error("فشل تحميل المرفق");
    window.open(data.signedUrl, "_blank");
  }

  return (
    <div>
      <PageHeader title="المصروفات" description="تسجيل المصروفات مع تخصيص مصادر التمويل تلقائياً"
        actions={canCreate && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button onClick={openNew}><Plus className="size-4" /> مصروف جديد</Button></DialogTrigger>
            <DialogContent dir="rtl" className="max-w-2xl">
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
                <div className="space-y-2"><Label>المبلغ الإجمالي (د.ل)</Label>
                  <Input required type="number" step="0.01" min="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} dir="ltr" />
                </div>

                <div className="space-y-2 rounded-md border p-3">
                  <div className="flex items-center justify-between">
                    <Label>تخصيص مصادر التمويل</Label>
                    <Button type="button" variant="outline" size="sm" onClick={() => setAllocations([...allocations, { funding_check_id: "", amount: "" }])}>
                      <Plus className="size-3.5" /> صك آخر
                    </Button>
                  </div>
                  {allocations.map((a, i) => {
                    const c = (checks ?? []).find((x: any) => x.id === a.funding_check_id);
                    const rem = c ? Number(c.amount) - (spentMap?.[c.id] ?? 0) : 0;
                    return (
                      <div key={i} className="grid grid-cols-[1fr_140px_auto] gap-2 items-end">
                        <div>
                          <Select value={a.funding_check_id} onValueChange={(v) => {
                            const next = [...allocations]; next[i] = { ...next[i], funding_check_id: v }; setAllocations(next);
                          }} required>
                            <SelectTrigger><SelectValue placeholder="اختر صك تمويل" /></SelectTrigger>
                            <SelectContent>{(checks ?? []).map((x: any) => {
                              const r = Number(x.amount) - (spentMap?.[x.id] ?? 0);
                              return <SelectItem key={x.id} value={x.id}>صك {x.check_number} — {x.funders?.name} — {x.cash_accounts?.name} — متبقي {formatCurrency(r)}</SelectItem>;
                            })}</SelectContent>
                          </Select>
                          {c && <div className="text-[11px] text-muted-foreground mt-1">المتبقي: <span className="tabular-nums">{formatCurrency(rem)}</span></div>}
                        </div>
                        <Input type="number" step="0.01" min="0.01" placeholder="المبلغ" value={a.amount} onChange={(e) => {
                          const next = [...allocations]; next[i] = { ...next[i], amount: e.target.value }; setAllocations(next);
                        }} dir="ltr" required />
                        {allocations.length > 1 && (
                          <Button type="button" variant="ghost" size="icon" onClick={() => setAllocations(allocations.filter((_, j) => j !== i))}>
                            <X className="size-4" />
                          </Button>
                        )}
                      </div>
                    );
                  })}
                  <div className={`flex justify-between text-sm pt-2 border-t ${allocMismatch ? "text-destructive" : "text-muted-foreground"}`}>
                    <span>مجموع التخصيصات</span>
                    <span className="tabular-nums font-medium">{formatCurrency(allocTotal)} / {formatCurrency(amountNum)}</span>
                  </div>
                </div>

                {cashSummary.length > 0 && (
                  <div className="rounded-md bg-muted/40 border p-3 text-sm">
                    <div className="font-medium mb-1 text-foreground">سيتم الصرف من:</div>
                    <ul className="space-y-1">
                      {cashSummary.map(([name, amt]) => (
                        <li key={name} className="flex justify-between text-muted-foreground">
                          <span>{name}</span>
                          <span className="tabular-nums font-medium text-foreground">{formatCurrency(amt)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2"><Label>التاريخ</Label>
                    <Input required type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} /></div>
                  <div className="space-y-2"><Label>مرفق صورة/PDF (اختياري)</Label>
                    <Input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
                </div>
                <div className="space-y-2"><Label>مرفق Excel (اختياري)</Label>
                  <Input type="file" accept=".xlsx,.xls,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => setExcelFile(e.target.files?.[0] ?? null)} />
                  {excelFile && <p className="text-xs text-muted-foreground">{excelFile.name}</p>}
                </div>
                <div className="space-y-2"><Label>الوصف</Label>
                  <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
                <DialogFooter>
                  <Button type="submit" disabled={busy || allocMismatch}>{busy ? "جاري الحفظ..." : "حفظ المصروف"}</Button>
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
                  <TableHead>حساب الدفع</TableHead>
                  <TableHead>الصكوك</TableHead>
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
                    <TableCell className="text-xs">
                      {Array.from(new Set((e.expense_funding_allocations ?? []).map((a: any) => a.funding_checks?.cash_accounts?.name).filter(Boolean))).join("، ") || "—"}
                    </TableCell>
                    <TableCell className="tabular-nums text-xs" dir="ltr">
                      {(e.expense_funding_allocations ?? []).map((a: any) => a.funding_checks?.check_number).filter(Boolean).join("، ") || "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm max-w-[240px] truncate">{e.description ?? "—"}</TableCell>
                    <TableCell className="text-left font-medium tabular-nums">{formatCurrency(e.amount)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {e.attachment_url && (
                          <Button size="sm" variant="ghost" onClick={() => downloadAttachment(e.attachment_url)} title="مرفق">
                            <Paperclip className="size-3.5" />
                          </Button>
                        )}
                        {e.excel_attachment_url && (
                          <Button size="sm" variant="ghost" onClick={() => downloadAttachment(e.excel_attachment_url)} title="ملف Excel">
                            <FileSpreadsheet className="size-3.5 text-success" />
                          </Button>
                        )}
                      </div>
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
