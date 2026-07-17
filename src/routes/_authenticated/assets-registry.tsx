import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Eye, Search, Boxes } from "lucide-react";
import { ExpenseDetailsDialog } from "@/components/ExpenseDetailsDialog";
import { useState as useStateExp } from "react";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { formatCurrency, formatDate } from "@/lib/utils";
import { LoadingState, EmptyState } from "@/components/States";

export const Route = createFileRoute("/_authenticated/assets-registry")({ component: AssetsPage });

const TYPES = [
  { v: "vehicle", l: "مركبة" }, { v: "equipment", l: "معدات" }, { v: "machine", l: "آلة" },
  { v: "generator", l: "مولّد" }, { v: "building", l: "مبنى" }, { v: "office", l: "مكتب" },
  { v: "warehouse", l: "مستودع" }, { v: "device", l: "جهاز" }, { v: "other", l: "أخرى" },
];
const STATUSES = [
  { v: "active", l: "نشط" }, { v: "inactive", l: "غير نشط" },
  { v: "sold", l: "مباع" }, { v: "under_maintenance", l: "تحت الصيانة" },
];

const typeLabel = (v: string) => TYPES.find((t) => t.v === v)?.l ?? v;
const statusLabel = (v: string) => STATUSES.find((s) => s.v === v)?.l ?? v;

function AssetsPage() {
  const qc = useQueryClient();
  const { can, user } = useAuth();
  const canCreate = can("assets.create");
  const canUpdate = can("assets.update");

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [viewing, setViewing] = useState<any | null>(null);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  const empty = {
    asset_code: "", asset_name: "", asset_type: "vehicle",
    serial_number: "", plate_number: "",
    purchase_date: "", purchase_value: "", current_value: "",
    current_location: "", responsible_person: "", status: "active", notes: "",
  };
  const [form, setForm] = useState(empty);

  const { data: assets, isLoading } = useQuery({
    queryKey: ["assets"],
    queryFn: async () => {
      const { data, error } = await supabase.from("assets").select("*")
        .is("deleted_at", null).order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: expByAsset } = useQuery({
    queryKey: ["asset-exp-totals"],
    queryFn: async () => {
      const { data } = await supabase.from("expenses")
        .select("asset_id, amount, asset_cost_treatment")
        .eq("expense_scope", "asset").is("deleted_at", null);
      const op: Record<string, number> = {}, cap: Record<string, number> = {};
      (data ?? []).forEach((e: any) => {
        if (!e.asset_id) return;
        if (e.asset_cost_treatment === "capital_improvement")
          cap[e.asset_id] = (cap[e.asset_id] ?? 0) + Number(e.amount);
        else op[e.asset_id] = (op[e.asset_id] ?? 0) + Number(e.amount);
      });
      return { op, cap };
    },
  });

  const filtered = useMemo(() => (assets ?? []).filter((a: any) => {
    if (filterType !== "all" && a.asset_type !== filterType) return false;
    if (filterStatus !== "all" && a.status !== filterStatus) return false;
    if (search && !(`${a.asset_code} ${a.asset_name} ${a.plate_number ?? ""} ${a.serial_number ?? ""}`).includes(search)) return false;
    return true;
  }), [assets, filterType, filterStatus, search]);

  function openNew() { setEditing(null); setForm(empty); setOpen(true); }
  function openEdit(a: any) {
    setEditing(a);
    setForm({
      asset_code: a.asset_code ?? "", asset_name: a.asset_name ?? "",
      asset_type: a.asset_type ?? "vehicle",
      serial_number: a.serial_number ?? "", plate_number: a.plate_number ?? "",
      purchase_date: a.purchase_date ?? "",
      purchase_value: a.purchase_value?.toString() ?? "",
      current_value: a.current_value?.toString() ?? "",
      current_location: a.current_location ?? "",
      responsible_person: a.responsible_person ?? "",
      status: a.status ?? "active", notes: a.notes ?? "",
    });
    setOpen(true);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const payload: any = {
        asset_code: form.asset_code.trim(),
        asset_name: form.asset_name.trim(),
        asset_type: form.asset_type,
        serial_number: form.serial_number || null,
        plate_number: form.plate_number || null,
        purchase_date: form.purchase_date || null,
        purchase_value: form.purchase_value ? Number(form.purchase_value) : null,
        current_value: form.current_value ? Number(form.current_value)
          : (form.purchase_value ? Number(form.purchase_value) : null),
        current_location: form.current_location || null,
        responsible_person: form.responsible_person || null,
        status: form.status,
        notes: form.notes || null,
      };
      if (editing) {
        const { error } = await supabase.from("assets").update(payload).eq("id", editing.id);
        if (error) throw error;
        toast.success("تم تحديث الأصل");
      } else {
        payload.created_by = user!.id;
        const { error } = await supabase.from("assets").insert(payload);
        if (error) throw error;
        toast.success("تم إضافة الأصل");
      }
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["assets"] });
    } catch (err: any) {
      toast.error("فشل الحفظ", { description: err.message });
    } finally { setBusy(false); }
  }

  return (
    <div>
      <PageHeader title="الأصول" description="سجل أصول الشركة ومتابعة المصروفات المرتبطة بكل أصل"
        actions={canCreate && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button onClick={openNew}><Plus className="size-4" /> أصل جديد</Button></DialogTrigger>
            <DialogContent dir="rtl" className="max-w-2xl">
              <DialogHeader><DialogTitle>{editing ? "تعديل أصل" : "أصل جديد"}</DialogTitle></DialogHeader>
              <form onSubmit={onSubmit} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2"><Label>رمز الأصل *</Label>
                    <Input required value={form.asset_code} onChange={(e) => setForm({ ...form, asset_code: e.target.value })} dir="ltr" />
                  </div>
                  <div className="space-y-2"><Label>اسم الأصل *</Label>
                    <Input required value={form.asset_name} onChange={(e) => setForm({ ...form, asset_name: e.target.value })} />
                  </div>
                  <div className="space-y-2"><Label>النوع *</Label>
                    <Select value={form.asset_type} onValueChange={(v) => setForm({ ...form, asset_type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{TYPES.map((t) => <SelectItem key={t.v} value={t.v}>{t.l}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2"><Label>الحالة</Label>
                    <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{STATUSES.map((s) => <SelectItem key={s.v} value={s.v}>{s.l}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2"><Label>الرقم التسلسلي</Label>
                    <Input value={form.serial_number} onChange={(e) => setForm({ ...form, serial_number: e.target.value })} dir="ltr" />
                  </div>
                  <div className="space-y-2"><Label>رقم اللوحة</Label>
                    <Input value={form.plate_number} onChange={(e) => setForm({ ...form, plate_number: e.target.value })} dir="ltr" />
                  </div>
                  <div className="space-y-2"><Label>تاريخ الشراء</Label>
                    <Input type="date" value={form.purchase_date} onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} />
                  </div>
                  <div className="space-y-2"><Label>قيمة الشراء (د.ل)</Label>
                    <Input type="number" step="0.01" value={form.purchase_value} onChange={(e) => setForm({ ...form, purchase_value: e.target.value })} dir="ltr" />
                  </div>
                  <div className="space-y-2"><Label>القيمة الحالية (د.ل)</Label>
                    <Input type="number" step="0.01" value={form.current_value} onChange={(e) => setForm({ ...form, current_value: e.target.value })} dir="ltr" />
                  </div>
                  <div className="space-y-2"><Label>الموقع</Label>
                    <Input value={form.current_location} onChange={(e) => setForm({ ...form, current_location: e.target.value })} />
                  </div>
                  <div className="space-y-2 col-span-2"><Label>الشخص المسؤول</Label>
                    <Input value={form.responsible_person} onChange={(e) => setForm({ ...form, responsible_person: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-2"><Label>ملاحظات</Label>
                  <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </div>
                <DialogFooter><Button type="submit" disabled={busy}>{busy ? "جاري الحفظ..." : "حفظ"}</Button></DialogFooter>
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
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="sm:w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأنواع</SelectItem>
                {TYPES.map((t) => <SelectItem key={t.v} value={t.v}>{t.l}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="sm:w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحالات</SelectItem>
                {STATUSES.map((s) => <SelectItem key={s.v} value={s.v}>{s.l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {isLoading ? <LoadingState /> : filtered.length === 0 ? <EmptyState title="لا توجد أصول" /> : (
            <div className="overflow-x-auto -mx-4 px-4">
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>الرمز</TableHead>
                    <TableHead>الاسم</TableHead>
                    <TableHead>النوع</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead className="text-left">القيمة الحالية</TableHead>
                    <TableHead className="text-left">مصروفات تشغيلية</TableHead>
                    <TableHead className="text-left">تحسينات رأسمالية</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((a: any) => (
                    <TableRow key={a.id}>
                      <TableCell className="tabular-nums" dir="ltr">{a.asset_code}</TableCell>
                      <TableCell className="font-medium">{a.asset_name}</TableCell>
                      <TableCell>{typeLabel(a.asset_type)}</TableCell>
                      <TableCell><Badge variant="outline">{statusLabel(a.status)}</Badge></TableCell>
                      <TableCell className="text-left tabular-nums">{a.current_value ? formatCurrency(a.current_value) : "—"}</TableCell>
                      <TableCell className="text-left tabular-nums">{formatCurrency(expByAsset?.op?.[a.id] ?? 0)}</TableCell>
                      <TableCell className="text-left tabular-nums">{formatCurrency(expByAsset?.cap?.[a.id] ?? 0)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setViewing(a)} title="تفاصيل"><Eye className="size-3.5" /></Button>
                          {canUpdate && <Button size="sm" variant="ghost" onClick={() => openEdit(a)} title="تعديل"><Pencil className="size-3.5" /></Button>}
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

      <AssetDetailsDialog asset={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}

function AssetDetailsDialog({ asset, onClose }: { asset: any | null; onClose: () => void }) {
  const { data: history } = useQuery({
    enabled: !!asset,
    queryKey: ["asset-history", asset?.id],
    queryFn: async () => {
      const { data } = await supabase.from("expenses")
        .select("id, expense_date, amount, description, asset_cost_treatment, asset_expense_type, expense_categories(name)")
        .eq("asset_id", asset.id).is("deleted_at", null)
        .order("expense_date", { ascending: false });
      return data ?? [];
    },
  });
  const opTotal = (history ?? []).filter((h: any) => h.asset_cost_treatment !== "capital_improvement")
    .reduce((s: number, h: any) => s + Number(h.amount), 0);
  const capTotal = (history ?? []).filter((h: any) => h.asset_cost_treatment === "capital_improvement")
    .reduce((s: number, h: any) => s + Number(h.amount), 0);

  return (
    <Dialog open={!!asset} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Boxes className="size-5" />
            {asset?.asset_name} <span className="text-sm text-muted-foreground tabular-nums" dir="ltr">({asset?.asset_code})</span>
          </DialogTitle>
        </DialogHeader>
        {asset && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <InfoCard label="النوع" value={typeLabel(asset.asset_type)} />
              <InfoCard label="الحالة" value={statusLabel(asset.status)} />
              <InfoCard label="قيمة الشراء" value={asset.purchase_value ? formatCurrency(asset.purchase_value) : "—"} />
              <InfoCard label="القيمة الحالية" value={asset.current_value ? formatCurrency(asset.current_value) : "—"} />
              <InfoCard label="مصروفات تشغيلية" value={formatCurrency(opTotal)} />
              <InfoCard label="تحسينات رأسمالية" value={formatCurrency(capTotal)} />
              <InfoCard label="الموقع" value={asset.current_location ?? "—"} />
              <InfoCard label="المسؤول" value={asset.responsible_person ?? "—"} />
              <InfoCard label="الرقم التسلسلي" value={asset.serial_number ?? "—"} />
              <InfoCard label="رقم اللوحة" value={asset.plate_number ?? "—"} />
              <InfoCard label="تاريخ الشراء" value={asset.purchase_date ? formatDate(asset.purchase_date) : "—"} />
            </div>
            {asset.notes && (
              <Card><CardHeader><CardTitle className="text-sm">ملاحظات</CardTitle></CardHeader>
                <CardContent className="text-sm text-muted-foreground">{asset.notes}</CardContent></Card>
            )}
            <Card>
              <CardHeader><CardTitle className="text-sm">سجل المصروفات</CardTitle></CardHeader>
              <CardContent>
                {(history ?? []).length === 0 ? <EmptyState title="لا توجد مصروفات" /> : (
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>التاريخ</TableHead><TableHead>الفئة</TableHead><TableHead>النوع</TableHead>
                      <TableHead>المعالجة</TableHead><TableHead className="text-left">المبلغ</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {(history ?? []).map((h: any) => (
                        <TableRow key={h.id}>
                          <TableCell className="text-sm whitespace-nowrap">{formatDate(h.expense_date)}</TableCell>
                          <TableCell>{h.expense_categories?.name ?? "—"}</TableCell>
                          <TableCell>{h.asset_expense_type ?? "—"}</TableCell>
                          <TableCell>{h.asset_cost_treatment === "capital_improvement" ? "تحسين رأسمالي" : "تشغيلي"}</TableCell>
                          <TableCell className="text-left tabular-nums">{formatCurrency(h.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function InfoCard({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-lg border p-3 bg-muted/30">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium mt-1 tabular-nums text-sm">{value}</div>
    </div>
  );
}
