import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { LoadingState, EmptyState } from "@/components/States";
import { formatDate } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/settings")({ component: SettingsPage });

function SettingsPage() {
  const { can } = useAuth();
  return (
    <div>
      <PageHeader title="الإعدادات" description="إدارة المستخدمين والصلاحيات والحسابات النقدية وفئات المصروفات" />
      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">المستخدمون والأدوار</TabsTrigger>
          <TabsTrigger value="cash">الحسابات النقدية</TabsTrigger>
          <TabsTrigger value="categories">فئات المصروفات</TabsTrigger>
          <TabsTrigger value="permissions">الصلاحيات</TabsTrigger>
        </TabsList>
        <TabsContent value="users"><UsersPanel canManage={can("users.manage")} /></TabsContent>
        <TabsContent value="cash"><CashAccountsPanel canManage={can("cash.manage")} /></TabsContent>
        <TabsContent value="categories"><CategoriesPanel canManage={can("categories.manage")} /></TabsContent>
        <TabsContent value="permissions"><PermissionsPanel canManage={can("users.manage")} /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------- Users & Roles ---------- */
function UsersPanel({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const { data: users, isLoading } = useQuery({
    queryKey: ["all-users"],
    queryFn: async () => {
      const { data: profiles } = await supabase.from("profiles").select("id, email, full_name, is_active, created_at").order("created_at");
      const { data: ur } = await supabase.from("user_roles").select("user_id, role_id, roles(id, name, code)");
      const map = new Map<string, any[]>();
      (ur ?? []).forEach((r: any) => { const arr = map.get(r.user_id) ?? []; arr.push(r.roles); map.set(r.user_id, arr); });
      return (profiles ?? []).map((p) => ({ ...p, roles: map.get(p.id) ?? [] }));
    },
  });
  const { data: roles } = useQuery({ queryKey: ["all-roles"],
    queryFn: async () => (await supabase.from("roles").select("*").order("name")).data ?? [] });

  async function setRole(userId: string, roleId: string) {
    if (!canManage) return;
    const { error: e1 } = await supabase.from("user_roles").delete().eq("user_id", userId);
    if (e1) return toast.error("فشل التحديث", { description: e1.message });
    const { error: e2 } = await supabase.from("user_roles").insert({ user_id: userId, role_id: roleId });
    if (e2) return toast.error("فشل التحديث", { description: e2.message });
    toast.success("تم تحديث الدور");
    qc.invalidateQueries({ queryKey: ["all-users"] });
  }
  async function toggleActive(userId: string, value: boolean) {
    if (!canManage) return;
    const { error } = await supabase.from("profiles").update({ is_active: value }).eq("id", userId);
    if (error) return toast.error("فشل التحديث", { description: error.message });
    toast.success(value ? "تم التفعيل" : "تم التعطيل");
    qc.invalidateQueries({ queryKey: ["all-users"] });
  }

  return (
    <Card><CardContent className="p-4">
      {isLoading ? <LoadingState /> : (users?.length ?? 0) === 0 ? <EmptyState title="لا يوجد مستخدمون" /> : (
        <Table>
          <TableHeader><TableRow>
            <TableHead>المستخدم</TableHead><TableHead>البريد</TableHead>
            <TableHead>الدور</TableHead><TableHead>الحالة</TableHead><TableHead>تاريخ التسجيل</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(users ?? []).map((u: any) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.full_name ?? "—"}</TableCell>
                <TableCell dir="ltr" className="text-sm">{u.email ?? "—"}</TableCell>
                <TableCell>
                  {canManage ? (
                    <Select value={u.roles[0]?.id ?? ""} onValueChange={(v) => setRole(u.id, v)}>
                      <SelectTrigger className="w-44"><SelectValue placeholder="اختر دور" /></SelectTrigger>
                      <SelectContent>
                        {(roles ?? []).map((r: any) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant="secondary">{u.roles[0]?.name ?? "بدون دور"}</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {canManage ? <Switch checked={u.is_active} onCheckedChange={(v) => toggleActive(u.id, v)} />
                    : <Badge variant={u.is_active ? "default" : "destructive"}>{u.is_active ? "نشط" : "معطل"}</Badge>}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">{formatDate(u.created_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </CardContent></Card>
  );
}

/* ---------- Cash Accounts ---------- */
function CashAccountsPanel({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", type: "cashbox", account_id: "" });

  const { data, isLoading } = useQuery({ queryKey: ["cash-accounts-all"],
    queryFn: async () => (await supabase.from("cash_accounts").select("id, name, type, is_active, accounts:account_id(code, name)").order("name")).data ?? [] });
  const { data: ledgerAccounts } = useQuery({ queryKey: ["ledger-cash-accounts"],
    queryFn: async () => (await supabase.from("accounts").select("id, code, name").eq("type", "asset").order("code")).data ?? [] });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from("cash_accounts").insert({ name: form.name, type: form.type as any, account_id: form.account_id });
    if (error) return toast.error("فشل الحفظ", { description: error.message });
    toast.success("تمت الإضافة"); setOpen(false);
    setForm({ name: "", type: "cashbox", account_id: "" });
    qc.invalidateQueries({ queryKey: ["cash-accounts-all"] });
  }
  async function toggle(id: string, value: boolean) {
    const { error } = await supabase.from("cash_accounts").update({ is_active: value }).eq("id", id);
    if (error) return toast.error("فشل التحديث", { description: error.message });
    qc.invalidateQueries({ queryKey: ["cash-accounts-all"] });
  }

  return (
    <Card><CardContent className="p-4">
      {canManage && (
        <div className="mb-4 flex justify-end">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="size-4" /> حساب نقدي جديد</Button></DialogTrigger>
            <DialogContent dir="rtl">
              <DialogHeader><DialogTitle>إضافة حساب نقدي</DialogTitle></DialogHeader>
              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-2"><Label>الاسم</Label>
                  <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div className="space-y-2"><Label>النوع</Label>
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cashbox">صندوق</SelectItem>
                      <SelectItem value="bank">بنك</SelectItem>
                      <SelectItem value="field">حقل</SelectItem>
                    </SelectContent>
                  </Select></div>
                <div className="space-y-2"><Label>الحساب المحاسبي</Label>
                  <Select value={form.account_id} onValueChange={(v) => setForm({ ...form, account_id: v })}>
                    <SelectTrigger><SelectValue placeholder="اختر حساب" /></SelectTrigger>
                    <SelectContent>
                      {(ledgerAccounts ?? []).map((a: any) => <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>)}
                    </SelectContent>
                  </Select></div>
                <DialogFooter><Button type="submit">حفظ</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      )}
      {isLoading ? <LoadingState /> : (data?.length ?? 0) === 0 ? <EmptyState title="لا توجد حسابات نقدية" /> : (
        <Table>
          <TableHeader><TableRow>
            <TableHead>الاسم</TableHead><TableHead>النوع</TableHead>
            <TableHead>الحساب المحاسبي</TableHead><TableHead>الحالة</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(data ?? []).map((c: any) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell><Badge variant="outline">{labelType(c.type)}</Badge></TableCell>
                <TableCell className="text-sm" dir="ltr">{c.accounts?.code} — {c.accounts?.name}</TableCell>
                <TableCell>
                  {canManage ? <Switch checked={c.is_active} onCheckedChange={(v) => toggle(c.id, v)} />
                    : <Badge variant={c.is_active ? "default" : "destructive"}>{c.is_active ? "نشط" : "معطل"}</Badge>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </CardContent></Card>
  );
}
const labelType = (t: string) => t === "bank" ? "بنك" : t === "field" ? "حقل" : "صندوق";

/* ---------- Expense Categories ---------- */
function CategoriesPanel({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", expense_account_id: "" });

  const { data, isLoading } = useQuery({ queryKey: ["cats-all"],
    queryFn: async () => (await supabase.from("expense_categories").select("id, name, created_at, accounts:expense_account_id(code, name)").order("name")).data ?? [] });
  const { data: expenseAccounts } = useQuery({ queryKey: ["ledger-expense-accounts"],
    queryFn: async () => (await supabase.from("accounts").select("id, code, name").eq("type", "expense").order("code")).data ?? [] });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from("expense_categories").insert(form);
    if (error) return toast.error("فشل الحفظ", { description: error.message });
    toast.success("تمت الإضافة"); setOpen(false); setForm({ name: "", expense_account_id: "" });
    qc.invalidateQueries({ queryKey: ["cats-all"] });
  }

  return (
    <Card><CardContent className="p-4">
      {canManage && (
        <div className="mb-4 flex justify-end">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="size-4" /> فئة جديدة</Button></DialogTrigger>
            <DialogContent dir="rtl">
              <DialogHeader><DialogTitle>إضافة فئة مصروف</DialogTitle></DialogHeader>
              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-2"><Label>الاسم</Label>
                  <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div className="space-y-2"><Label>الحساب المحاسبي</Label>
                  <Select value={form.expense_account_id} onValueChange={(v) => setForm({ ...form, expense_account_id: v })}>
                    <SelectTrigger><SelectValue placeholder="اختر حساب" /></SelectTrigger>
                    <SelectContent>
                      {(expenseAccounts ?? []).map((a: any) => <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>)}
                    </SelectContent>
                  </Select></div>
                <DialogFooter><Button type="submit">حفظ</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      )}
      {isLoading ? <LoadingState /> : (data?.length ?? 0) === 0 ? <EmptyState title="لا توجد فئات" /> : (
        <Table>
          <TableHeader><TableRow>
            <TableHead>الفئة</TableHead><TableHead>كود الحساب</TableHead>
            <TableHead>اسم الحساب</TableHead><TableHead>تاريخ الإنشاء</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(data ?? []).map((c: any) => (
              <TableRow key={c.id}>
                <TableCell><Badge variant="secondary">{c.name}</Badge></TableCell>
                <TableCell dir="ltr" className="tabular-nums">{c.accounts?.code}</TableCell>
                <TableCell>{c.accounts?.name}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{formatDate(c.created_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </CardContent></Card>
  );
}

/* ---------- Roles & Permissions (writable matrix) ---------- */
function PermissionsPanel({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["roles-perms-matrix"],
    queryFn: async () => {
      const [{ data: roles }, { data: perms }, { data: rp }] = await Promise.all([
        supabase.from("roles").select("id, name, code").order("name"),
        supabase.from("permissions").select("id, code, name, module").order("module"),
        supabase.from("role_permissions").select("role_id, permission_id"),
      ]);
      const set = new Set((rp ?? []).map((r: any) => `${r.role_id}:${r.permission_id}`));
      return { roles: roles ?? [], perms: perms ?? [], set };
    },
  });

  async function toggle(role: any, permId: string, on: boolean) {
    if (!canManage) return;
    if (role.code === "admin") return toast.error("لا يمكن تعديل صلاحيات المدير");
    if (on) {
      const { error } = await supabase.from("role_permissions").insert({ role_id: role.id, permission_id: permId });
      if (error) return toast.error("فشل التحديث", { description: error.message });
    } else {
      const { error } = await supabase.from("role_permissions").delete().eq("role_id", role.id).eq("permission_id", permId);
      if (error) return toast.error("فشل التحديث", { description: error.message });
    }
    qc.invalidateQueries({ queryKey: ["roles-perms-matrix"] });
  }

  if (isLoading || !data) return <LoadingState />;
  const modules = Array.from(new Set(data.perms.map((p: any) => p.module)));
  return (
    <Card><CardContent className="p-4 overflow-x-auto">
      {!canManage && <p className="text-sm text-muted-foreground mb-3">للقراءة فقط — يحتاج صلاحية إدارة المستخدمين للتعديل</p>}
      <Table>
        <TableHeader><TableRow>
          <TableHead className="min-w-32">الصلاحية</TableHead>
          {data.roles.map((r: any) => (
            <TableHead key={r.id} className="text-center">
              {r.name}
              {r.code === "admin" && <div className="text-[10px] text-muted-foreground">مغلق</div>}
            </TableHead>
          ))}
        </TableRow></TableHeader>
        <TableBody>
          {modules.map((m: string) => (
            <React.Fragment key={m}>
              <TableRow><TableCell colSpan={data.roles.length + 1} className="bg-muted/50 font-bold text-sm">{m}</TableCell></TableRow>
              {data.perms.filter((p: any) => p.module === m).map((p: any) => (
                <TableRow key={p.id}>
                  <TableCell className="text-sm"><div className="font-medium">{p.name}</div><div className="text-xs text-muted-foreground" dir="ltr">{p.code}</div></TableCell>
                  {data.roles.map((r: any) => {
                    const checked = data.set.has(`${r.id}:${p.id}`);
                    const locked = r.code === "admin" || !canManage;
                    return (
                      <TableCell key={r.id} className="text-center">
                        <Checkbox
                          checked={checked}
                          disabled={locked}
                          onCheckedChange={(v) => toggle(r, p.id, !!v)}
                        />
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </React.Fragment>
          ))}
        </TableBody>
      </Table>
    </CardContent></Card>
  );
}
