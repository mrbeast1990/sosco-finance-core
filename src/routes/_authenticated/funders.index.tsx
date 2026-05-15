import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Search, Pencil } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { LoadingState, EmptyState } from "@/components/States";

export const Route = createFileRoute("/_authenticated/funders/")({ component: FundersPage });

function FundersPage() {
  const qc = useQueryClient();
  const { canWrite } = useAuth();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: "", project_code: "", is_project: true, notes: "" });

  const { data, isLoading } = useQuery({
    queryKey: ["funders"],
    queryFn: async () => {
      const { data, error } = await supabase.from("funders").select("*").is("deleted_at", null).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const filtered = (data ?? []).filter((f: any) =>
    !search || f.name.includes(search) || (f.project_code ?? "").includes(search)
  );

  function openNew() {
    setEditing(null);
    setForm({ name: "", project_code: "", is_project: true, notes: "" });
    setOpen(true);
  }
  function openEdit(f: any) {
    setEditing(f);
    setForm({ name: f.name, project_code: f.project_code ?? "", is_project: f.is_project ?? false, notes: f.notes ?? "" });
    setOpen(true);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.is_project && !form.project_code.trim()) {
      return toast.error("رقم المشروع مطلوب عند تفعيل هذا الممول كمشروع");
    }
    const payload = {
      name: form.name,
      project_code: form.is_project ? form.project_code.trim() : null,
      is_project: form.is_project,
      notes: form.notes || null,
    };
    const { error } = editing
      ? await supabase.from("funders").update(payload).eq("id", editing.id)
      : await supabase.from("funders").insert(payload);
    if (error) return toast.error("فشل الحفظ", { description: error.message });
    toast.success(editing ? "تم التحديث" : "تمت الإضافة");
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["funders"] });
    qc.invalidateQueries({ queryKey: ["projects-sel"] });
  }

  return (
    <div>
      <PageHeader title="الممولون" description="إدارة الممولين والمشاريع المرتبطة بهم"
        actions={canWrite && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button onClick={openNew}><Plus className="size-4" /> ممول جديد</Button></DialogTrigger>
            <DialogContent dir="rtl">
              <DialogHeader><DialogTitle>{editing ? "تعديل الممول" : "ممول جديد"}</DialogTitle></DialogHeader>
              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-2"><Label>الاسم</Label>
                  <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <Label className="text-sm">هذا الممول مشروع أيضاً</Label>
                    <p className="text-xs text-muted-foreground mt-1">سيُنشأ سجل مشروع تلقائياً ويظهر في قوائم المشاريع</p>
                  </div>
                  <Switch checked={form.is_project} onCheckedChange={(v) => setForm({ ...form, is_project: v })} />
                </div>
                {form.is_project && (
                  <div className="space-y-2"><Label>رقم المشروع</Label>
                    <Input required value={form.project_code} onChange={(e) => setForm({ ...form, project_code: e.target.value })} dir="ltr" placeholder="مثال: PRJ-001" />
                  </div>
                )}
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
          <div className="relative mb-4">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input placeholder="بحث بالاسم أو رقم المشروع..." className="pr-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {isLoading ? <LoadingState /> : filtered.length === 0 ? <EmptyState title="لا يوجد ممولون" /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الاسم</TableHead>
                  <TableHead>رقم المشروع</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>ملاحظات</TableHead>
                  {canWrite && <TableHead></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((f: any) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-medium">
                      <Link to="/funders/$funderId" params={{ funderId: f.id }} className="text-primary hover:underline">{f.name}</Link>
                    </TableCell>
                    <TableCell className="tabular-nums" dir="ltr">{f.project_code ?? "—"}</TableCell>
                    <TableCell>
                      {f.is_project ? <Badge variant="default">ممول + مشروع</Badge> : <Badge variant="secondary">ممول فقط</Badge>}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{f.notes ?? "—"}</TableCell>
                    {canWrite && <TableCell><Button size="sm" variant="ghost" onClick={() => openEdit(f)}><Pencil className="size-3.5" /></Button></TableCell>}
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
