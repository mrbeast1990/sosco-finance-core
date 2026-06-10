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
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { formatCurrency, formatDate } from "@/lib/utils";
import { LoadingState, EmptyState } from "@/components/States";
import { useOnlineStatus } from "@/lib/use-online-status";
import { enqueue } from "@/lib/offline-queue";

export const Route = createFileRoute("/_authenticated/expenses")({ component: ExpensesPage });

type Allocation = { funding_check_id: string; amount: string };

function ExpensesPage() {
  const qc = useQueryClient();
  const { can, user } = useAuth();
  const online = useOnlineStatus();
  const canCreate = can("expenses.create");
  const canEdit = can("expenses.edit");
  const canDelete = can("expenses.delete");
  const [search, setSearch] = useState("");
  const [editingExp, setEditingExp] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({
    expense_scope: "project" as "project" | "asset" | "general",
    project_id: "", asset_id: "", asset_expense_type: "maintenance",
    asset_cost_treatment: "operating_expense" as "operating_expense" | "capital_improvement",
    category_id: "", amount: "", expense_date: "", description: "",
    payment_status: "paid" as "paid" | "payable",
    creditor_name: "", due_date: "",
  });
  const [editAllocations, setEditAllocations] = useState<Allocation[]>([{ funding_check_id: "", amount: "" }]);
  const [editBusy, setEditBusy] = useState(false);
  const [reversing, setReversing] = useState<any | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [filterProject, setFilterProject] = useState("all");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    expense_scope: "project" as "project" | "asset" | "general",
    project_id: "", asset_id: "", asset_expense_type: "maintenance",
    asset_cost_treatment: "operating_expense" as "operating_expense" | "capital_improvement",
    category_id: "",
    amount: "", expense_date: new Date().toISOString().slice(0, 10), description: "",
    payment_status: "paid" as "paid" | "payable",
    creditor_name: "", due_date: "",
  });
  const [allocations, setAllocations] = useState<Allocation[]>([{ funding_check_id: "", amount: "" }]);

  const { data: projects } = useQuery({ queryKey: ["projects-sel"],
    queryFn: async () => (await supabase.from("projects").select("id,name,code").is("deleted_at", null)).data ?? [] });
  const { data: assets } = useQuery({ queryKey: ["assets-sel"],
    queryFn: async () => (await supabase.from("assets").select("id,asset_code,asset_name").is("deleted_at", null)).data ?? [] });
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
    setForm({
      expense_scope: "project", project_id: "", asset_id: "",
      asset_expense_type: "maintenance", asset_cost_treatment: "operating_expense",
      category_id: "", amount: "",
      expense_date: new Date().toISOString().slice(0, 10), description: "",
      payment_status: "paid", creditor_name: "", due_date: "",
    });
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
    const isPayable = form.payment_status === "payable";
    if (isPayable) {
      if (!form.creditor_name.trim()) return toast.error("أدخل اسم الدائن");
    } else {
      if (allocMismatch) return toast.error("مجموع التخصيصات لا يساوي مبلغ المصروف");
      if (allocations.some((a) => !a.funding_check_id || !a.amount)) return toast.error("أكمل بيانات التخصيصات");
    }
    if (form.expense_scope === "project" && !form.project_id) return toast.error("اختر المشروع");
    if (form.expense_scope === "asset" && !form.asset_id) return toast.error("اختر الأصل");

    // Offline: queue only paid expenses (payable needs immediate validation/AP entry)
    if (!online) {
      if (isPayable) return toast.error("المصروف الآجل يتطلب اتصالاً بالإنترنت");
      if (file || excelFile) return toast.error("لا يمكن رفع المرفقات أوفلاين", { description: "احفظ بدون مرفقات أو انتظر عودة الاتصال" });
      try {
        const projName = (projects ?? []).find((p: any) => p.id === form.project_id)?.name ?? "";
        await enqueue({
          type: "expense.create",
          label: `${projName} — ${form.amount} د.ل`,
          payload: {
            _project_id: form.project_id,
            _category_id: form.category_id,
            _amount: Number(form.amount),
            _expense_date: form.expense_date,
            _description: form.description || "",
            _attachment_url: "",
            _allocations: allocations.map((a) => ({ funding_check_id: a.funding_check_id, amount: Number(a.amount) })),
            _excel_attachment_url: null,
          },
        });
        toast.success("تم حفظ المصروف في الطابور", { description: "سيُرسل تلقائياً عند عودة الاتصال" });
        setOpen(false);
      } catch (err: any) {
        toast.error("فشل الحفظ في الطابور", { description: err.message });
      }
      return;
    }

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
      const { error } = await supabase.rpc("create_expense_v3", {
        _payment_status: form.payment_status,
        _creditor_name: isPayable ? form.creditor_name.trim() : null,
        _due_date: isPayable && form.due_date ? form.due_date : null,
        _expense_scope: form.expense_scope,
        _project_id: form.expense_scope === "project" ? form.project_id : null,
        _asset_id: form.expense_scope === "asset" ? form.asset_id : null,
        _asset_expense_type: form.expense_scope === "asset" ? form.asset_expense_type : null,
        _asset_cost_treatment: form.expense_scope === "asset" ? form.asset_cost_treatment : null,
        _category_id: form.category_id,
        _amount: Number(form.amount),
        _expense_date: form.expense_date,
        _description: form.description || "",
        _attachment_url: attachment_url ?? "",
        _allocations: isPayable ? [] : allocations.map((a) => ({ funding_check_id: a.funding_check_id, amount: Number(a.amount) })),
        _excel_attachment_url: excel_attachment_url,
      } as any);
      if (error) throw error;
      toast.success(isPayable ? "تم تسجيل المصروف الآجل" : "تم تسجيل المصروف", {
        description: isPayable ? "تم إنشاء ذمة دائنة بدون خصم النقد" : "تم إنشاء قيد محاسبي وتخصيصات التمويل",
      });
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
    setEditForm({
      expense_scope: (e.expense_scope ?? "project"),
      project_id: e.project_id ?? "",
      asset_id: e.asset_id ?? "",
      asset_expense_type: e.asset_expense_type ?? "maintenance",
      asset_cost_treatment: e.asset_cost_treatment ?? "operating_expense",
      category_id: e.category_id ?? "",
      amount: String(e.amount ?? ""),
      expense_date: e.expense_date,
      description: e.description ?? "",
      payment_status: (e.payment_status ?? "paid"),
      creditor_name: e.creditor_name ?? "",
      due_date: e.due_date ?? "",
    });
    setEditAllocations(
      (e.expense_funding_allocations ?? []).length
        ? e.expense_funding_allocations.map((a: any) => ({
            funding_check_id: a.funding_check_id ?? (a.funding_checks?.id ?? ""),
            amount: String(a.amount),
          }))
        : [{ funding_check_id: "", amount: "" }]
    );
  }

  const editAmountNum = Number(editForm.amount) || 0;
  const editAllocTotal = editAllocations.reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const editMismatch = editAmountNum > 0 && Math.round(editAllocTotal * 100) !== Math.round(editAmountNum * 100);

  async function onSaveEditExp(ev: React.FormEvent) {
    ev.preventDefault();
    if (!editingExp) return;
    if (editMismatch) return toast.error("مجموع التخصيصات لا يساوي المبلغ");
    if (editAllocations.some((a) => !a.funding_check_id || !a.amount)) return toast.error("أكمل بيانات التخصيصات");
    if (editForm.expense_scope === "project" && !editForm.project_id) return toast.error("اختر المشروع");
    if (editForm.expense_scope === "asset" && !editForm.asset_id) return toast.error("اختر الأصل");
    setEditBusy(true);
    try {
      const { error } = await supabase.rpc("update_expense_atomic", {
        _expense_id: editingExp.id,
        _expense_scope: editForm.expense_scope,
        _project_id: editForm.expense_scope === "project" ? editForm.project_id : null,
        _asset_id: editForm.expense_scope === "asset" ? editForm.asset_id : null,
        _asset_expense_type: editForm.expense_scope === "asset" ? editForm.asset_expense_type : null,
        _asset_cost_treatment: editForm.expense_scope === "asset" ? editForm.asset_cost_treatment : null,
        _category_id: editForm.category_id,
        _amount: Number(editForm.amount),
        _expense_date: editForm.expense_date,
        _description: editForm.description || "",
        _allocations: editAllocations.map((a) => ({ funding_check_id: a.funding_check_id, amount: Number(a.amount) })),
      } as any);
      if (error) throw error;
      toast.success("تم تحديث المصروف", { description: "تم تسجيل التغيير في سجل المراجعة" });
      setEditingExp(null);
      qc.invalidateQueries();
    } catch (err: any) {
      toast.error("فشل التعديل", { description: err.message });
    } finally {
      setEditBusy(false);
    }
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
    const res = await supabase.storage.from("expense-attachments").createSignedUrl(path, 60);
    if (res.error || !res.data) return toast.error("فشل تحميل المرفق");
    window.open(res.data.signedUrl, "_blank");
  }

  return (
    <div>
      <PageHeader title="المصروفات" description="تسجيل المصروفات مع تخصيص مصادر التمويل تلقائياً"
        actions={canCreate && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button onClick={openNew}><Plus className="size-4" /> مصروف جديد</Button></DialogTrigger>
            <DialogContent dir="rtl" className="max-w-2xl">
              <DialogHeader><DialogTitle>تسجيل مصروف جديد</DialogTitle></DialogHeader>
              <form onSubmit={onSubmit} className="space-y-4 max-h-[80vh] overflow-y-auto">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>حالة الدفع</Label>
                    <Select value={form.payment_status} onValueChange={(v: any) => setForm({ ...form, payment_status: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="paid">مدفوع (يخصم من النقد)</SelectItem>
                        <SelectItem value="payable">آجل / ذمة دائنة</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>نوع الارتباط</Label>
                    <Select value={form.expense_scope} onValueChange={(v: any) => setForm({ ...form, expense_scope: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="project">مشروع</SelectItem>
                        <SelectItem value="asset">أصل</SelectItem>
                        <SelectItem value="general">مصروف عام</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {form.payment_status === "payable" && (
                  <div className="grid grid-cols-2 gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                    <div className="space-y-2 col-span-2 text-xs text-amber-700 dark:text-amber-400">
                      💳 لن يتم خصم أي رصيد نقدي. سيتم تسجيل الذمة كدائنة وتدفع لاحقاً من شاشة الذمم الدائنة.
                    </div>
                    <div className="space-y-2">
                      <Label>اسم الدائن / المورد *</Label>
                      <Input required value={form.creditor_name} onChange={(e) => setForm({ ...form, creditor_name: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>تاريخ الاستحقاق (اختياري)</Label>
                      <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  {form.expense_scope === "project" && (
                    <div className="space-y-2"><Label>المشروع</Label>
                      <Select value={form.project_id} onValueChange={(v) => setForm({ ...form, project_id: v })} required>
                        <SelectTrigger><SelectValue placeholder="اختر المشروع" /></SelectTrigger>
                        <SelectContent>{(projects ?? []).map((p: any) => <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>)}</SelectContent>
                      </Select></div>
                  )}
                  {form.expense_scope === "asset" && (
                    <>
                      <div className="space-y-2"><Label>الأصل</Label>
                        <Select value={form.asset_id} onValueChange={(v) => setForm({ ...form, asset_id: v })} required>
                          <SelectTrigger><SelectValue placeholder="اختر الأصل" /></SelectTrigger>
                          <SelectContent>{(assets ?? []).map((a: any) => <SelectItem key={a.id} value={a.id}>{a.asset_code} — {a.asset_name}</SelectItem>)}</SelectContent>
                        </Select></div>
                      <div className="space-y-2"><Label>نوع مصروف الأصل</Label>
                        <Select value={form.asset_expense_type} onValueChange={(v) => setForm({ ...form, asset_expense_type: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="maintenance">صيانة</SelectItem>
                            <SelectItem value="fuel">وقود</SelectItem>
                            <SelectItem value="spare_parts">قطع غيار</SelectItem>
                            <SelectItem value="insurance">تأمين</SelectItem>
                            <SelectItem value="rent">إيجار</SelectItem>
                            <SelectItem value="operation">تشغيل</SelectItem>
                            <SelectItem value="other">أخرى</SelectItem>
                          </SelectContent>
                        </Select></div>
                      <div className="space-y-2 col-span-2"><Label>المعالجة المحاسبية</Label>
                        <Select value={form.asset_cost_treatment} onValueChange={(v: any) => setForm({ ...form, asset_cost_treatment: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="operating_expense">مصروف تشغيلي (لا يزيد قيمة الأصل)</SelectItem>
                            <SelectItem value="capital_improvement">تحسين رأسمالي (يزيد قيمة الأصل)</SelectItem>
                          </SelectContent>
                        </Select></div>
                    </>
                  )}
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
            <div className="overflow-x-auto -mx-4 px-4">
              <Table className="min-w-[900px]">
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
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{formatDate(e.expense_date)}</TableCell>
                      <TableCell><div className="font-medium">{e.projects?.name}</div><div className="text-xs text-muted-foreground tabular-nums" dir="ltr">{e.projects?.code}</div></TableCell>
                      <TableCell>{e.expense_categories?.name}</TableCell>
                      <TableCell className="text-xs">
                        {Array.from(new Set((e.expense_funding_allocations ?? []).map((a: any) => a.funding_checks?.cash_accounts?.name).filter(Boolean))).join("، ") || "—"}
                      </TableCell>
                      <TableCell className="tabular-nums text-xs whitespace-nowrap" dir="ltr">
                        {(e.expense_funding_allocations ?? []).map((a: any) => a.funding_checks?.check_number).filter(Boolean).join("، ") || "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm max-w-[180px] truncate">{e.description ?? "—"}</TableCell>
                      <TableCell className="text-left font-medium tabular-nums whitespace-nowrap">{formatCurrency(e.amount)}</TableCell>
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
                          {canEdit && (
                            <Button size="sm" variant="ghost" onClick={() => openEditExp(e)} title="تعديل">
                              <Pencil className="size-3.5" />
                            </Button>
                          )}
                          {canDelete && (
                            <Button size="sm" variant="ghost" onClick={() => setReversing(e)} title="عكس/حذف">
                              <Undo2 className="size-3.5 text-destructive" />
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
        </CardContent>
      </Card>

      <Dialog open={!!editingExp} onOpenChange={(o) => !o && setEditingExp(null)}>
        <DialogContent dir="rtl" className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>تعديل المصروف</DialogTitle></DialogHeader>
          <form onSubmit={onSaveEditExp} className="space-y-4">
            <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-2 text-xs">
              ⚠️ سيتم إعادة بناء القيد المحاسبي وتسجيل القيم القديمة والجديدة في سجل المراجعة.
            </div>
            <div className="space-y-2">
              <Label>نوع الارتباط</Label>
              <Select value={editForm.expense_scope} onValueChange={(v: any) => setEditForm({ ...editForm, expense_scope: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="project">مشروع</SelectItem>
                  <SelectItem value="asset">أصل</SelectItem>
                  <SelectItem value="general">مصروف عام</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {editForm.expense_scope === "project" && (
                <div className="space-y-2"><Label>المشروع</Label>
                  <Select value={editForm.project_id} onValueChange={(v) => setEditForm({ ...editForm, project_id: v })}>
                    <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                    <SelectContent>{(projects ?? []).map((p: any) => <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>)}</SelectContent>
                  </Select></div>
              )}
              {editForm.expense_scope === "asset" && (
                <>
                  <div className="space-y-2"><Label>الأصل</Label>
                    <Select value={editForm.asset_id} onValueChange={(v) => setEditForm({ ...editForm, asset_id: v })}>
                      <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                      <SelectContent>{(assets ?? []).map((a: any) => <SelectItem key={a.id} value={a.id}>{a.asset_code} — {a.asset_name}</SelectItem>)}</SelectContent>
                    </Select></div>
                  <div className="space-y-2"><Label>نوع مصروف الأصل</Label>
                    <Select value={editForm.asset_expense_type} onValueChange={(v) => setEditForm({ ...editForm, asset_expense_type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="maintenance">صيانة</SelectItem>
                        <SelectItem value="fuel">وقود</SelectItem>
                        <SelectItem value="spare_parts">قطع غيار</SelectItem>
                        <SelectItem value="insurance">تأمين</SelectItem>
                        <SelectItem value="rent">إيجار</SelectItem>
                        <SelectItem value="operation">تشغيل</SelectItem>
                        <SelectItem value="other">أخرى</SelectItem>
                      </SelectContent>
                    </Select></div>
                  <div className="space-y-2 col-span-2"><Label>المعالجة المحاسبية</Label>
                    <Select value={editForm.asset_cost_treatment} onValueChange={(v: any) => setEditForm({ ...editForm, asset_cost_treatment: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="operating_expense">مصروف تشغيلي</SelectItem>
                        <SelectItem value="capital_improvement">تحسين رأسمالي</SelectItem>
                      </SelectContent>
                    </Select></div>
                </>
              )}
              <div className="space-y-2"><Label>فئة المصروف</Label>
                <Select value={editForm.category_id} onValueChange={(v) => setEditForm({ ...editForm, category_id: v })}>
                  <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                  <SelectContent>{(cats ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select></div>
            </div>

            <div className="space-y-2"><Label>المبلغ الإجمالي (د.ل)</Label>
              <Input required type="number" step="0.01" min="0.01" value={editForm.amount} onChange={(ev) => setEditForm({ ...editForm, amount: ev.target.value })} dir="ltr" />
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <Label>تخصيص مصادر التمويل</Label>
                <Button type="button" variant="outline" size="sm" onClick={() => setEditAllocations([...editAllocations, { funding_check_id: "", amount: "" }])}>
                  <Plus className="size-3.5" /> صك آخر
                </Button>
              </div>
              {editAllocations.map((a, i) => (
                <div key={i} className="grid grid-cols-[1fr_140px_auto] gap-2 items-end">
                  <Select value={a.funding_check_id} onValueChange={(v) => {
                    const next = [...editAllocations]; next[i] = { ...next[i], funding_check_id: v }; setEditAllocations(next);
                  }}>
                    <SelectTrigger><SelectValue placeholder="اختر صك" /></SelectTrigger>
                    <SelectContent>{(checks ?? []).map((x: any) => (
                      <SelectItem key={x.id} value={x.id}>صك {x.check_number} — {x.funders?.name} — {x.cash_accounts?.name}</SelectItem>
                    ))}</SelectContent>
                  </Select>
                  <Input type="number" step="0.01" min="0.01" placeholder="المبلغ" value={a.amount} onChange={(ev) => {
                    const next = [...editAllocations]; next[i] = { ...next[i], amount: ev.target.value }; setEditAllocations(next);
                  }} dir="ltr" />
                  {editAllocations.length > 1 && (
                    <Button type="button" variant="ghost" size="icon" onClick={() => setEditAllocations(editAllocations.filter((_, j) => j !== i))}>
                      <X className="size-4" />
                    </Button>
                  )}
                </div>
              ))}
              <div className={`flex justify-between text-sm pt-2 border-t ${editMismatch ? "text-destructive" : "text-muted-foreground"}`}>
                <span>مجموع التخصيصات</span>
                <span className="tabular-nums font-medium">{formatCurrency(editAllocTotal)} / {formatCurrency(editAmountNum)}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>التاريخ</Label>
                <Input required type="date" value={editForm.expense_date} onChange={(ev) => setEditForm({ ...editForm, expense_date: ev.target.value })} /></div>
            </div>
            <div className="space-y-2"><Label>الوصف</Label>
              <Textarea value={editForm.description} onChange={(ev) => setEditForm({ ...editForm, description: ev.target.value })} /></div>
            <DialogFooter><Button type="submit" disabled={editBusy || editMismatch}>{editBusy ? "جاري الحفظ..." : "حفظ التعديل"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!reversing} onOpenChange={(o) => !o && (setReversing(null), setReverseReason(""))}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>عكس/حذف مصروف</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف المصروف ({reversing && formatCurrency(reversing.amount)}) وإنشاء قيد عكسي يستعيد المبلغ إلى حساب الصرف. لا يمكن التراجع.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label>سبب العكس</Label>
            <Textarea value={reverseReason} onChange={(ev) => setReverseReason(ev.target.value)} placeholder="مثال: خطأ في التسجيل" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmReverse} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">تأكيد العكس</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
