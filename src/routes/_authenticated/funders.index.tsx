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
  const [form, setForm] = useState({ name: "", phone: "", notes: "" });

  const { data, isLoading } = useQuery({
    queryKey: ["funders"],
    queryFn: async () => {
      const { data, error } = await supabase.from("funders").select("*").is("deleted_at", null).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const filtered = (data ?? []).filter((f) => !search || f.name.includes(search) || (f.phone ?? "").includes(search));

  function openNew() { setEditing(null); setForm({ name: "", phone: "", notes: "" }); setOpen(true); }
  function openEdit(f: any) { setEditing(f); setForm({ name: f.name, phone: f.phone ?? "", notes: f.notes ?? "" }); setOpen(true); }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { error } = editing
      ? await supabase.from("funders").update(form).eq("id", editing.id)
      : await supabase.from("funders").insert(form);
    if (error) return toast.error("فشل الحفظ", { description: error.message });
    toast.success(editing ? "تم التحديث" : "تمت الإضافة");
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["funders"] });
  }

  return (
    <div>
      <PageHeader title="الممولون" description="إدارة الجهات الممولة للشركة"
        actions={canWrite && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button onClick={openNew}><Plus className="size-4" /> ممول جديد</Button></DialogTrigger>
            <DialogContent dir="rtl">
              <DialogHeader><DialogTitle>{editing ? "تعديل الممول" : "ممول جديد"}</DialogTitle></DialogHeader>
              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-2"><Label>الاسم</Label>
                  <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div className="space-y-2"><Label>الهاتف</Label>
                  <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" /></div>
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
            <Input placeholder="بحث..." className="pr-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {isLoading ? <LoadingState /> : filtered.length === 0 ? <EmptyState title="لا يوجد ممولون" /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الاسم</TableHead>
                  <TableHead>الهاتف</TableHead>
                  <TableHead>ملاحظات</TableHead>
                  {canWrite && <TableHead></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-medium">
                      <Link to="/funders/$funderId" params={{ funderId: f.id }} className="text-primary hover:underline">{f.name}</Link>
                    </TableCell>
                    <TableCell className="tabular-nums" dir="ltr">{f.phone ?? "—"}</TableCell>
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
