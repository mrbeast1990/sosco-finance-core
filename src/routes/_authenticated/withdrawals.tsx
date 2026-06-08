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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, CheckCircle2, XCircle, Paperclip, Wallet, Calendar } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { formatCurrency, formatDate } from "@/lib/utils";
import { LoadingState, EmptyState } from "@/components/States";

export const Route = createFileRoute("/_authenticated/withdrawals")({ component: WithdrawalsPage });

const ROLES = [
  { v: "owner", l: "مالك" }, { v: "partner", l: "شريك" },
  { v: "manager", l: "مدير" }, { v: "other", l: "أخرى" },
];
const METHODS = [
  { v: "cash", l: "نقد" }, { v: "bank_transfer", l: "تحويل بنكي" },
  { v: "check", l: "شيك" }, { v: "other", l: "أخرى" },
];
const STATUSES = [
  { v: "draft", l: "مسودة", variant: "secondary" as const },
  { v: "approved", l: "معتمدة", variant: "default" as const },
  { v: "cancelled", l: "ملغية", variant: "destructive" as const },
];
const roleLabel = (v: string) => ROLES.find((r) => r.v === v)?.l ?? v;
const methodLabel = (v: string) => METHODS.find((m) => m.v === v)?.l ?? v;
const statusInfo = (v: string) => STATUSES.find((s) => s.v === v) ?? STATUSES[0];

function WithdrawalsPage() {
  const qc = useQueryClient();
  const { can, user } = useAuth();
  const canCreate = can("withdrawals.create");
  const canApprove = can("withdrawals.approve");
  const canCancel = can("withdrawals.cancel");

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [cancelling, setCancelling] = useState<any | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const [search, setSearch] = useState("");
  const [fRole, setFRole] = useState("all");
  const [fMethod, setFMethod] = useState("all");
  const [fStatus, setFStatus] = useState("all");
  const [fProject, setFProject] = useState("all");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");

  const empty = {
    withdrawal_date: new Date().toISOString().slice(0, 10),
    person_name: "", person_role: "owner",
    amount: "", payment_method: "cash",
    cash_account_id: "", funding_check_id: "", project_id: "",
    description: "",
  };
  const [form, setForm] = useState(empty);

  const { data: cashAccounts } = useQuery({
    queryKey: ["cash-sel"],
    queryFn: async () => (await supabase.from("cash_accounts").select("id,name").eq("is_active", true)).data ?? [],
  });
  const { data: checks } = useQuery({
    queryKey: ["checks-wd"],
    queryFn: async () => (await supabase.from("funding_checks")
      .select("id, check_number, funders(name)").is("deleted_at", null)).data ?? [],
  });
  const { data: projects } = useQuery({
    queryKey: ["projects-wd"],
    queryFn: async () => (await supabase.from("projects").select("id,name,code").is("deleted_at", null)).data ?? [],
  });

  const { data, isLoading } = useQuery({
    queryKey: ["withdrawals"],
    queryFn: async () => {
      const { data, error } = await supabase.from("owner_withdrawals")
        .select("*, projects(name,code), cash_accounts(name), funding_checks(check_number)")
        .is("deleted_at", null).order("withdrawal_date", { ascending: false }).limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = useMemo(() => (data ?? []).filter((w: any) => {
    if (fRole !== "all" && w.person_role !== fRole) return false;
    if (fMethod !== "all" && w.payment_method !== fMethod) return false;
    if (fStatus !== "all" && w.status !== fStatus) return false;
    if (fProject !== "all" && w.project_id !== fProject) return false;
    if (fFrom && w.withdrawal_date < fFrom) return false;
    if (fTo && w.withdrawal_date > fTo) return false;
    if (search && !((w.person_name ?? "") + " " + (w.withdrawal_no ?? "") + " " + (w.description ?? "")).includes(search)) return false;
    return true;
  }), [data, fRole, fMethod, fStatus, fProject, fFrom, fTo, search]);

  // Stats
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + "01";
  const approved = filtered.filter((w: any) => w.status === "approved");
  const totalToday = approved.filter((w: any) => w.withdrawal_date === today).reduce((s: number, w: any) => s + Number(w.amount), 0);
  const totalMonth = approved.filter((w: any) => w.withdrawal_date >= monthStart).reduce((s: number, w: any) => s + Number(w.amount), 0);
  const totalAll = approved.reduce((s: number, w: any) => s + Number(w.amount), 0);

  function openNew() { setForm(empty); setFile(null); setOpen(true); }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      let attachment_url: string | null = null;
      if (file) {
        const path = `withdrawals/${user!.id}/${Date.now()}-${file.name}`;
        const up = await supabase.storage.from("expense-attachments").upload(path, file);
        if (up.error) throw up.error;
        attachment_url = up.data.path;
      }
      const { error } = await supabase.rpc("create_withdrawal_atomic", {
        _withdrawal_date: form.withdrawal_date,
        _person_name: form.person_name.trim(),
        _person_role: form.person_role,
        _amount: Number(form.amount),
        _payment_method: form.payment_method,
        _cash_account_id: form.cash_account_id || null,
        _funding_check_id: form.funding_check_id || null,
        _project_id: form.project_id || null,
        _description: form.description || null,
        _attachment_url: attachment_url,
      } as any);
      if (error) throw error;
      toast.success("تم تسجيل المسحوبة كمسوّدة", { description: "تحتاج اعتماد لإنشاء القيد المحاسبي" });
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["withdrawals"] });
    } catch (err: any) {
      toast.error("فشل الحفظ", { description: err.message });
    } finally { setBusy(false); }
  }

  async function onApprove(w: any) {
    const { error } = await supabase.rpc("approve_withdrawal_atomic", { _id: w.id } as any);
    if (error) return toast.error("فشل الاعتماد", { description: error.message });
    toast.success("تم اعتماد المسحوبة وإنشاء القيد المحاسبي");
    qc.invalidateQueries();
  }

  async function onConfirmCancel() {
    if (!cancelling) return;
    const { error } = await supabase.rpc("cancel_withdrawal_atomic", {
      _id: cancelling.id, _reason: cancelReason || "إلغاء بدون سبب",
    } as any);
    if (error) return toast.error("فشل الإلغاء", { description: error.message });
    toast.success("تم إلغاء المسحوبة");
    setCancelling(null); setCancelReason("");
    qc.invalidateQueries();
  }

  async function downloadAttachment(path: string) {
    const res = await supabase.storage.from("expense-attachments").createSignedUrl(path, 60);
    if (res.error || !res.data) return toast.error("فشل تحميل المرفق");
    window.open(res.data.signedUrl, "_blank");
  }

  return (
    <div>
      <PageHeader title="المسحوبات" description="مسحوبات الشركاء والمالكين منفصلة عن المصروفات التشغيلية"
        actions={canCreate && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button onClick={openNew}><Plus className="size-4" /> مسحوبة جديدة</Button></DialogTrigger>
            <DialogContent dir="rtl" className="max-w-2xl">
              <DialogHeader><DialogTitle>تسجيل مسحوبة جديدة</DialogTitle></DialogHeader>
              <form onSubmit={onSubmit} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2"><Label>التاريخ *</Label>
                    <Input required type="date" value={form.withdrawal_date} onChange={(e) => setForm({ ...form, withdrawal_date: e.target.value })} />
                  </div>
                  <div className="space-y-2"><Label>المبلغ (د.ل) *</Label>
                    <Input required type="number" step="0.01" min="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} dir="ltr" />
                  </div>
                  <div className="space-y-2"><Label>اسم الشخص *</Label>
                    <Input required value={form.person_name} onChange={(e) => setForm({ ...form, person_name: e.target.value })} />
                  </div>
                  <div className="space-y-2"><Label>الصفة *</Label>
                    <Select value={form.person_role} onValueChange={(v) => setForm({ ...form, person_role: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{ROLES.map((r) => <SelectItem key={r.v} value={r.v}>{r.l}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2"><Label>طريقة الدفع *</Label>
                    <Select value={form.payment_method} onValueChange={(v) => setForm({ ...form, payment_method: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{METHODS.map((m) => <SelectItem key={m.v} value={m.v}>{m.l}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2"><Label>حساب الصندوق/البنك</Label>
                    <Select value={form.cash_account_id || "none"} onValueChange={(v) => setForm({ ...form, cash_account_id: v === "none" ? "" : v, funding_check_id: "" })}>
                      <SelectTrigger><SelectValue placeholder="اختر..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— تلقائي —</SelectItem>
                        {(cashAccounts ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2"><Label>صك التمويل (اختياري)</Label>
                    <Select value={form.funding_check_id || "none"} onValueChange={(v) => setForm({ ...form, funding_check_id: v === "none" ? "" : v })}>
                      <SelectTrigger><SelectValue placeholder="اختر..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— بدون —</SelectItem>
                        {(checks ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>صك {c.check_number} — {c.funders?.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2"><Label>المشروع (اختياري)</Label>
                    <Select value={form.project_id || "none"} onValueChange={(v) => setForm({ ...form, project_id: v === "none" ? "" : v })}>
                      <SelectTrigger><SelectValue placeholder="اختر..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— بدون —</SelectItem>
                        {(projects ?? []).map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2"><Label>الوصف</Label>
                  <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </div>
                <div className="space-y-2"><Label>مرفق (اختياري)</Label>
                  <Input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </div>
                <DialogFooter><Button type="submit" disabled={busy}>{busy ? "جاري الحفظ..." : "حفظ كمسوّدة"}</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <StatCard icon={Calendar} label="مسحوبات اليوم" value={formatCurrency(totalToday)} />
        <StatCard icon={Calendar} label="مسحوبات الشهر" value={formatCurrency(totalMonth)} />
        <StatCard icon={Wallet} label="إجمالي المعتمدة" value={formatCurrency(totalAll)} />
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 mb-4">
            <div className="relative col-span-2">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input placeholder="بحث..." className="pr-9" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Input type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} placeholder="من" />
            <Input type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} placeholder="إلى" />
            <Select value={fRole} onValueChange={setFRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الصفات</SelectItem>
                {ROLES.map((r) => <SelectItem key={r.v} value={r.v}>{r.l}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={fMethod} onValueChange={setFMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الطرق</SelectItem>
                {METHODS.map((m) => <SelectItem key={m.v} value={m.v}>{m.l}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={fStatus} onValueChange={setFStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحالات</SelectItem>
                {STATUSES.map((s) => <SelectItem key={s.v} value={s.v}>{s.l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {isLoading ? <LoadingState /> : filtered.length === 0 ? <EmptyState title="لا توجد مسحوبات" /> : (
            <div className="overflow-x-auto -mx-4 px-4">
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>الرقم</TableHead>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>الشخص</TableHead>
                    <TableHead>الصفة</TableHead>
                    <TableHead>طريقة الدفع</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead className="text-left">المبلغ</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((w: any) => {
                    const st = statusInfo(w.status);
                    return (
                      <TableRow key={w.id}>
                        <TableCell className="tabular-nums" dir="ltr">{w.withdrawal_no}</TableCell>
                        <TableCell className="text-sm whitespace-nowrap">{formatDate(w.withdrawal_date)}</TableCell>
                        <TableCell className="font-medium">{w.person_name}</TableCell>
                        <TableCell>{roleLabel(w.person_role)}</TableCell>
                        <TableCell>{methodLabel(w.payment_method)}</TableCell>
                        <TableCell><Badge variant={st.variant}>{st.l}</Badge></TableCell>
                        <TableCell className="text-left font-medium tabular-nums">{formatCurrency(w.amount)}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {w.attachment_url && (
                              <Button size="sm" variant="ghost" onClick={() => downloadAttachment(w.attachment_url)} title="مرفق">
                                <Paperclip className="size-3.5" />
                              </Button>
                            )}
                            {w.status === "draft" && canApprove && (
                              <Button size="sm" variant="ghost" onClick={() => onApprove(w)} title="اعتماد">
                                <CheckCircle2 className="size-3.5 text-success" />
                              </Button>
                            )}
                            {w.status !== "cancelled" && canCancel && (
                              <Button size="sm" variant="ghost" onClick={() => setCancelling(w)} title="إلغاء">
                                <XCircle className="size-3.5 text-destructive" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!cancelling} onOpenChange={(o) => !o && (setCancelling(null), setCancelReason(""))}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>إلغاء المسحوبة</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelling?.status === "approved"
                ? "سيتم إنشاء قيد عكسي لاسترجاع المبلغ. لا يمكن التراجع."
                : "سيتم تغيير حالة المسوّدة إلى ملغية."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label>سبب الإلغاء</Label>
            <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="مثال: خطأ في التسجيل" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>تراجع</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmCancel} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">تأكيد الإلغاء</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <Card><CardContent className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-medium text-muted-foreground">{label}</div>
          <div className="text-xl font-bold mt-2 tabular-nums">{value}</div>
        </div>
        <div className="rounded-lg p-2 bg-primary/10 text-primary"><Icon className="size-5" /></div>
      </div>
    </CardContent></Card>
  );
}
