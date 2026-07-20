import { createFileRoute, Link } from "@tanstack/react-router";
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
import { Plus, Search, Pencil } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { formatDate } from "@/lib/utils";
import { LoadingState, EmptyState } from "@/components/States";

export const Route = createFileRoute("/_authenticated/projects")({ component: ProjectsPage });

const statusLabels: Record<string, string> = {
  active: "نشط", completed: "مكتمل", on_hold: "معلق", cancelled: "ملغي",
};
const statusVariants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default", completed: "secondary", on_hold: "outline", cancelled: "destructive",
};

function ProjectsPage() {
  const qc = useQueryClient();
  const { canWrite } = useAuth();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: "", code: "", status: "active", notes: "" });

  const { data, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const { data, error } = await supabase.from("projects")
        .select("*").is("deleted_at", null).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const filtered = (data ?? []).filter((p) =>
    !search || p.name.includes(search) || p.code.includes(search));

  function openNew() {
    setEditing(null);
    setForm({ name: "", code: "", status: "active", notes: "" });
    setOpen(true);
  }
  function openEdit(p: any) {
    setEditing(p);
    setForm({ name: p.name, code: p.code, status: p.status, notes: p.notes ?? "" });
    setOpen(true);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = { ...form, status: form.status as any };
    const { error } = editing
      ? await supabase.from("projects").update(payload).eq("id", editing.id)
      : await supabase.from("projects").insert(payload);
    if (error) return toast.error("فشل الحفظ", { description: error.message });
    toast.success(editing ? "تم التحديث" : "تمت الإضافة");
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["projects"] });
  }

  return (
    <div>
      <PageHeader
        title="المشاريع"
        description="إدارة مشاريع شركة سوسكو لخدمات النفط"
        actions={canWrite && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button onClick={openNew}><Plus className="size-4" /> مشروع جديد</Button></DialogTrigger>
            <DialogContent dir="rtl">
              <DialogHeader><DialogTitle>{editing ? "تعديل المشروع" : "مشروع جديد"}</DialogTitle></DialogHeader>
              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-2"><Label>اسم المشروع</Label>
                  <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div className="space-y-2"><Label>كود المشروع</Label>
                  <Input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
                <div className="space-y-2"><Label>الحالة</Label>
                  <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(statusLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select></div>
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
            <Input placeholder="بحث بالاسم أو الكود..." className="pr-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {isLoading ? <LoadingState /> : filtered.length === 0 ? (
            <EmptyState title="لا توجد مشاريع" description="ابدأ بإضافة أول مشروع" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الكود</TableHead>
                  <TableHead>الاسم</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>تاريخ الإنشاء</TableHead>
                  {canWrite && <TableHead></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium tabular-nums">
                      <Link to="/projects/$projectId" params={{ projectId: p.id }} className="text-primary hover:underline">{p.code}</Link>
                    </TableCell>
                    <TableCell>
                      <Link to="/projects/$projectId" params={{ projectId: p.id }} className="hover:underline">{p.name}</Link>
                    </TableCell>
                    <TableCell><Badge variant={statusVariants[p.status]}>{statusLabels[p.status]}</Badge></TableCell>
                    <TableCell className="text-muted-foreground text-sm">{formatDate(p.created_at)}</TableCell>
                    {canWrite && (
                      <TableCell><Button size="sm" variant="ghost" onClick={() => openEdit(p)}><Pencil className="size-3.5" /></Button></TableCell>
                    )}
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
