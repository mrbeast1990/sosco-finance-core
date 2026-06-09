import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, ShieldCheck, ShieldAlert, Activity, RefreshCw, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/audit")({
  component: AuditCenter,
});

type Severity = "critical" | "warning" | "info";
type Issue = { id: string; severity: Severity; category: string; title: string; detail?: string };

const PAGE_SIZE = 25;

function sevBadge(s: Severity) {
  if (s === "critical") return <Badge variant="destructive">حرج</Badge>;
  if (s === "warning") return <Badge className="bg-amber-500 hover:bg-amber-500/90 text-white">تحذير</Badge>;
  return <Badge variant="secondary">معلومة</Badge>;
}

function AuditCenter() {
  const { can, isAdmin } = useAuth();
  const nav = useNavigate();
  const allowed = can("audit.view") || isAdmin;

  useEffect(() => {
    if (!allowed) nav({ to: "/dashboard" });
  }, [allowed, nav]);

  if (!allowed) return null;

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader title="مركز التدقيق" description="مراقبة سلامة البيانات والتتبع المحاسبي" />
      <Tabs defaultValue="summary" className="space-y-4">
        <TabsList>
          <TabsTrigger value="summary">الملخّص</TabsTrigger>
          <TabsTrigger value="checks">فحوصات السلامة</TabsTrigger>
          <TabsTrigger value="log">سجل التدقيق</TabsTrigger>
          <TabsTrigger value="risks">تحذيرات المخاطر</TabsTrigger>
        </TabsList>
        <TabsContent value="summary"><IntegritySummary /></TabsContent>
        <TabsContent value="checks"><IntegrityChecks /></TabsContent>
        <TabsContent value="log"><AuditLogViewer /></TabsContent>
        <TabsContent value="risks"><RiskWarnings /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------- Data hooks ------------------------------- */

async function fetchAllIssues(): Promise<Issue[]> {
  const issues: Issue[] = [];

  // 1) Journal balance check (per entry)
  const { data: lines } = await supabase
    .from("journal_lines")
    .select("journal_entry_id, debit, credit");
  const balances = new Map<string, { d: number; c: number }>();
  (lines ?? []).forEach((l) => {
    const k = l.journal_entry_id as string;
    const b = balances.get(k) ?? { d: 0, c: 0 };
    b.d += Number(l.debit ?? 0);
    b.c += Number(l.credit ?? 0);
    balances.set(k, b);
  });
  balances.forEach((b, k) => {
    if (Math.round((b.d - b.c) * 100) !== 0) {
      issues.push({
        id: `je-${k}`,
        severity: "critical",
        category: "قيود",
        title: `قيد غير متوازن (${k.slice(0, 8)})`,
        detail: `مدين: ${b.d.toFixed(2)} — دائن: ${b.c.toFixed(2)}`,
      });
    }
  });

  // 2) Allocation integrity: SUM(allocations) == expense.amount (active only)
  const { data: expenses } = await supabase
    .from("expenses")
    .select("id, amount, project_id, category_id, deleted_at")
    .is("deleted_at", null);
  const { data: allocs } = await supabase
    .from("expense_funding_allocations")
    .select("expense_id, funding_check_id, amount");
  const sumByExp = new Map<string, number>();
  (allocs ?? []).forEach((a) => {
    const k = a.expense_id as string;
    sumByExp.set(k, (sumByExp.get(k) ?? 0) + Number(a.amount ?? 0));
  });
  (expenses ?? []).forEach((e) => {
    const s = sumByExp.get(e.id as string) ?? 0;
    if (Math.round((s - Number(e.amount)) * 100) !== 0) {
      issues.push({
        id: `alloc-${e.id}`,
        severity: "critical",
        category: "تخصيصات",
        title: `مجموع تخصيصات لا يساوي مبلغ المصروف`,
        detail: `مصروف ${(e.id as string).slice(0, 8)} — المبلغ: ${Number(e.amount).toFixed(2)} / المخصّص: ${s.toFixed(2)}`,
      });
    }
  });

  // 3) Funding overdraft: allocated > check.amount
  const { data: checks } = await supabase
    .from("funding_checks")
    .select("id, check_number, amount, deleted_at")
    .is("deleted_at", null);
  const sumByCheck = new Map<string, number>();
  const activeExp = new Set((expenses ?? []).map((e) => e.id as string));
  (allocs ?? []).forEach((a) => {
    if (!activeExp.has(a.expense_id as string)) return;
    const k = a.funding_check_id as string;
    sumByCheck.set(k, (sumByCheck.get(k) ?? 0) + Number(a.amount ?? 0));
  });
  (checks ?? []).forEach((c) => {
    const used = sumByCheck.get(c.id as string) ?? 0;
    if (used - Number(c.amount) > 0.001) {
      issues.push({
        id: `over-${c.id}`,
        severity: "critical",
        category: "تمويل",
        title: `تجاوز رصيد الصك ${c.check_number}`,
        detail: `المبلغ: ${Number(c.amount).toFixed(2)} — المستهلك: ${used.toFixed(2)}`,
      });
    }
  });

  // 4) Orphans: allocations without expense/check
  const expIds = new Set((expenses ?? []).map((e) => e.id as string));
  const checkIds = new Set((checks ?? []).map((c) => c.id as string));
  // include soft-deleted in expIds lookup (allocations may legitimately reference deleted expenses)
  const { data: allExpenses } = await supabase.from("expenses").select("id");
  const allExpIds = new Set((allExpenses ?? []).map((e) => e.id as string));
  (allocs ?? []).forEach((a) => {
    if (!allExpIds.has(a.expense_id as string)) {
      issues.push({
        id: `orphan-a-e-${a.expense_id}`,
        severity: "warning",
        category: "أيتام",
        title: "تخصيص بدون مصروف",
        detail: `expense_id: ${(a.expense_id as string).slice(0, 8)}`,
      });
    }
    if (!checkIds.has(a.funding_check_id as string)) {
      issues.push({
        id: `orphan-a-c-${a.funding_check_id}`,
        severity: "warning",
        category: "أيتام",
        title: "تخصيص بدون صك",
        detail: `funding_check_id: ${(a.funding_check_id as string).slice(0, 8)}`,
      });
    }
  });

  // 5) Expenses referencing missing project/category
  const { data: projects } = await supabase.from("projects").select("id");
  const { data: categories } = await supabase.from("expense_categories").select("id");
  const projIds = new Set((projects ?? []).map((p) => p.id as string));
  const catIds = new Set((categories ?? []).map((c) => c.id as string));
  (expenses ?? []).forEach((e) => {
    if (!projIds.has(e.project_id as string)) {
      issues.push({
        id: `orphan-e-p-${e.id}`,
        severity: "warning",
        category: "أيتام",
        title: "مصروف بمشروع مفقود",
        detail: `expense ${(e.id as string).slice(0, 8)}`,
      });
    }
    if (!catIds.has(e.category_id as string)) {
      issues.push({
        id: `orphan-e-c-${e.id}`,
        severity: "warning",
        category: "أيتام",
        title: "مصروف بفئة مفقودة",
        detail: `expense ${(e.id as string).slice(0, 8)}`,
      });
    }
    void expIds;
  });

  return issues;
}

function useIssues() {
  return useQuery({ queryKey: ["audit-issues"], queryFn: fetchAllIssues, staleTime: 30_000 });
}

/* -------------------------------- Sections -------------------------------- */

function IntegritySummary() {
  const { data, isLoading, refetch, isFetching, dataUpdatedAt } = useIssues();
  const critical = (data ?? []).filter((i) => i.severity === "critical").length;
  const warnings = (data ?? []).filter((i) => i.severity === "warning").length;
  const total = (data ?? []).length;
  const score = total === 0 ? 100 : Math.max(0, Math.round(100 - (critical * 10 + warnings * 3)));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          آخر فحص: {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleString("ar") : "—"}
        </div>
        <Button onClick={() => refetch()} variant="outline" size="sm" disabled={isFetching}>
          {isFetching ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          إعادة الفحص
        </Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><ShieldCheck className="size-4" />درجة السلامة</CardTitle></CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${score >= 90 ? "text-emerald-600" : score >= 70 ? "text-amber-600" : "text-destructive"}`}>
              {isLoading ? "—" : `${score}%`}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><ShieldAlert className="size-4 text-destructive" />مشاكل حرجة</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold text-destructive">{isLoading ? "—" : critical}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="size-4 text-amber-600" />تحذيرات</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold text-amber-600">{isLoading ? "—" : warnings}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Activity className="size-4" />إجمالي الملاحظات</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold">{isLoading ? "—" : total}</div></CardContent>
        </Card>
      </div>
    </div>
  );
}

function IntegrityChecks() {
  const { data, isLoading } = useIssues();
  const grouped = useMemo(() => {
    const m = new Map<string, Issue[]>();
    (data ?? []).forEach((i) => {
      const k = i.category;
      m.set(k, [...(m.get(k) ?? []), i]);
    });
    return Array.from(m.entries());
  }, [data]);

  if (isLoading) return <div className="flex justify-center p-8"><Loader2 className="size-5 animate-spin" /></div>;
  if (!grouped.length) return (
    <Card><CardContent className="p-8 text-center text-emerald-600">
      <ShieldCheck className="size-8 mx-auto mb-2" />
      لا توجد مشاكل سلامة مكتشفة.
    </CardContent></Card>
  );

  return (
    <div className="space-y-4">
      {grouped.map(([cat, items]) => (
        <Card key={cat}>
          <CardHeader className="pb-2"><CardTitle className="text-base">{cat} ({items.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">الخطورة</TableHead>
                  <TableHead>العنوان</TableHead>
                  <TableHead>التفاصيل</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>{sevBadge(i.severity)}</TableCell>
                    <TableCell className="font-medium">{i.title}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{i.detail}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function fmtVal(v: any): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return new Intl.NumberFormat("ar-LY", { minimumFractionDigits: 2 }).format(v);
  if (typeof v === "boolean") return v ? "نعم" : "لا";
  return String(v);
}

const FIELD_LABELS: Record<string, string> = {
  expense_date: "التاريخ",
  amount: "المبلغ",
  description: "الوصف",
  expense_scope: "النطاق",
  project_name: "المشروع",
  asset_name: "الأصل",
  asset_expense_type: "نوع مصروف الأصل",
  asset_cost_treatment: "المعالجة",
  category_name: "الفئة",
};

const SCOPE_LABELS: Record<string, string> = {
  project: "مشروع", asset: "أصل", general: "عام",
  operating_expense: "تشغيلي", capital_improvement: "تحسين رأسمالي",
};

function translate(field: string, val: any): string {
  if (val == null) return "—";
  if (SCOPE_LABELS[String(val)]) return SCOPE_LABELS[String(val)];
  return fmtVal(val);
}

function DiffView({ before, after }: { before: any; after: any }) {
  const fields = Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]))
    .filter((k) => FIELD_LABELS[k]);
  const rows = fields.map((f) => {
    const b = before?.[f]; const a = after?.[f];
    const changed = JSON.stringify(b) !== JSON.stringify(a);
    return { f, b, a, changed };
  });
  const beforeAllocs = (before?.allocations ?? []) as any[];
  const afterAllocs = (after?.allocations ?? []) as any[];
  const allocsChanged = JSON.stringify(beforeAllocs) !== JSON.stringify(afterAllocs);

  return (
    <div className="space-y-3">
      <div className="border rounded-md overflow-hidden">
        <div className="grid grid-cols-3 bg-muted/50 text-xs font-medium p-2">
          <div>الحقل</div><div>قبل</div><div>بعد</div>
        </div>
        {rows.map((r) => (
          <div key={r.f} className={`grid grid-cols-3 text-sm p-2 border-t ${r.changed ? "bg-amber-500/10" : ""}`}>
            <div className="text-muted-foreground">{FIELD_LABELS[r.f]}</div>
            <div className={r.changed ? "line-through opacity-70" : ""}>{translate(r.f, r.b)}</div>
            <div className={r.changed ? "font-medium" : ""}>{translate(r.f, r.a)}</div>
          </div>
        ))}
      </div>
      {(beforeAllocs.length > 0 || afterAllocs.length > 0) && (
        <div className={`border rounded-md p-3 ${allocsChanged ? "bg-amber-500/10" : ""}`}>
          <div className="text-xs font-medium mb-2">التخصيصات (الصكوك):</div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-muted-foreground text-xs mb-1">قبل</div>
              {beforeAllocs.length === 0 ? <div className="text-xs text-muted-foreground">—</div> : beforeAllocs.map((a, i) => (
                <div key={i} className="text-xs tabular-nums" dir="ltr">صك {a.check_number} — {fmtVal(Number(a.amount))}</div>
              ))}
            </div>
            <div>
              <div className="text-muted-foreground text-xs mb-1">بعد</div>
              {afterAllocs.length === 0 ? <div className="text-xs text-muted-foreground">—</div> : afterAllocs.map((a, i) => (
                <div key={i} className="text-xs tabular-nums" dir="ltr">صك {a.check_number} — {fmtVal(Number(a.amount))}</div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AuditLogViewer() {
  const [page, setPage] = useState(0);
  const [entityType, setEntityType] = useState<string>("all");
  const [action, setAction] = useState<string>("all");
  const [actor, setActor] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [detailRow, setDetailRow] = useState<any | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["audit-log", page, entityType, action, actor, from, to],
    queryFn: async () => {
      let q = supabase
        .from("audit_log")
        .select("id, created_at, action, entity_type, entity_id, actor_id, payload", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (entityType !== "all") q = q.eq("entity_type", entityType);
      if (action !== "all") q = q.eq("action", action);
      if (actor.trim()) q = q.eq("actor_id", actor.trim());
      if (from) q = q.gte("created_at", from);
      if (to) q = q.lte("created_at", to + "T23:59:59");
      const { data, count, error } = await q;
      if (error) throw error;
      return { rows: data ?? [], count: count ?? 0 };
    },
  });

  const { data: profiles } = useQuery({
    queryKey: ["audit-profiles"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, email");
      const m = new Map<string, string>();
      (data ?? []).forEach((p) => m.set(p.id as string, (p.full_name as string) || (p.email as string) || (p.id as string)));
      return m;
    },
    staleTime: 60_000,
  });

  const total = data?.count ?? 0;
  const pages = Math.ceil(total / PAGE_SIZE);

  const actionLabels: Record<string, string> = {
    create: "إنشاء", update: "تعديل", delete: "حذف", reverse: "عكس", approve: "اعتماد", cancel: "إلغاء",
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">سجل التدقيق</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
          <Select value={entityType} onValueChange={(v) => { setEntityType(v); setPage(0); }}>
            <SelectTrigger><SelectValue placeholder="نوع الكيان" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الأنواع</SelectItem>
              <SelectItem value="expense">مصروف</SelectItem>
              <SelectItem value="funding_check">صك تمويل</SelectItem>
              <SelectItem value="funder">ممول</SelectItem>
              <SelectItem value="project">مشروع</SelectItem>
              <SelectItem value="withdrawal">مسحوبة</SelectItem>
            </SelectContent>
          </Select>
          <Select value={action} onValueChange={(v) => { setAction(v); setPage(0); }}>
            <SelectTrigger><SelectValue placeholder="الإجراء" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الإجراءات</SelectItem>
              <SelectItem value="create">إنشاء</SelectItem>
              <SelectItem value="update">تعديل</SelectItem>
              <SelectItem value="delete">حذف</SelectItem>
              <SelectItem value="reverse">عكس</SelectItem>
            </SelectContent>
          </Select>
          <Input placeholder="معرّف الفاعل (UUID)" value={actor} onChange={(e) => { setActor(e.target.value); setPage(0); }} />
          <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} />
          <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} />
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>التاريخ</TableHead>
              <TableHead>الفاعل</TableHead>
              <TableHead>الإجراء</TableHead>
              <TableHead>الكيان</TableHead>
              <TableHead>المعرّف</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-6"><Loader2 className="size-4 animate-spin inline" /></TableCell></TableRow>
            ) : data?.rows.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">لا توجد سجلات</TableCell></TableRow>
            ) : (
              data?.rows.map((r: any) => {
                const hasDetail = r.payload && (r.payload.before || r.payload.after || r.payload.reason);
                return (
                  <TableRow key={r.id as string}>
                    <TableCell className="text-xs tabular-nums">{new Date(r.created_at as string).toLocaleString("ar")}</TableCell>
                    <TableCell className="text-sm">{profiles?.get(r.actor_id as string) ?? (r.actor_id as string)?.slice(0, 8) ?? "—"}</TableCell>
                    <TableCell><Badge variant="outline">{actionLabels[r.action as string] ?? r.action}</Badge></TableCell>
                    <TableCell className="text-sm">{r.entity_type as string}</TableCell>
                    <TableCell className="text-xs font-mono">{(r.entity_id as string)?.slice(0, 8)}</TableCell>
                    <TableCell>
                      {hasDetail && (
                        <Button size="sm" variant="ghost" onClick={() => setDetailRow(r)}>تفاصيل</Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        <div className="flex items-center justify-between text-sm">
          <div className="text-muted-foreground">إجمالي: {total} — صفحة {page + 1} من {Math.max(1, pages)}</div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>السابق</Button>
            <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>التالي</Button>
          </div>
        </div>

        <Dialog open={!!detailRow} onOpenChange={(o) => !o && setDetailRow(null)}>
          <DialogContent dir="rtl" className="max-w-3xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                تفاصيل التغيير — {detailRow && (actionLabels[detailRow.action] ?? detailRow.action)} {detailRow?.entity_type}
              </DialogTitle>
            </DialogHeader>
            {detailRow && (
              <div className="space-y-3">
                <div className="text-sm text-muted-foreground grid grid-cols-2 gap-2">
                  <div>المستخدم: <span className="text-foreground">{profiles?.get(detailRow.actor_id) ?? "—"}</span></div>
                  <div>التاريخ: <span className="text-foreground">{new Date(detailRow.created_at).toLocaleString("ar")}</span></div>
                </div>
                {detailRow.payload?.reason && (
                  <div className="rounded-md border bg-destructive/5 p-2 text-sm">
                    <span className="text-muted-foreground">السبب: </span>{detailRow.payload.reason}
                  </div>
                )}
                {detailRow.payload?.before && detailRow.payload?.after ? (
                  <DiffView before={detailRow.payload.before} after={detailRow.payload.after} />
                ) : detailRow.payload?.before ? (
                  <div>
                    <div className="text-sm font-medium mb-2">القيم قبل الحذف:</div>
                    <DiffView before={detailRow.payload.before} after={detailRow.payload.before} />
                  </div>
                ) : (
                  <pre className="text-xs bg-muted/40 p-3 rounded-md overflow-auto" dir="ltr">{JSON.stringify(detailRow.payload, null, 2)}</pre>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

function RiskWarnings() {
  const { data, isLoading } = useQuery({
    queryKey: ["audit-risks"],
    queryFn: async (): Promise<Issue[]> => {
      const out: Issue[] = [];

      // Negative remaining balances (already covered as critical in checks, mirror here as info)
      const { data: checks } = await supabase
        .from("funding_checks")
        .select("id, check_number, amount")
        .is("deleted_at", null);
      const { data: allocs } = await supabase
        .from("expense_funding_allocations")
        .select("funding_check_id, amount, expense_id");
      const { data: activeExp } = await supabase
        .from("expenses").select("id").is("deleted_at", null);
      const active = new Set((activeExp ?? []).map((e) => e.id as string));
      const used = new Map<string, number>();
      (allocs ?? []).forEach((a) => {
        if (!active.has(a.expense_id as string)) return;
        const k = a.funding_check_id as string;
        used.set(k, (used.get(k) ?? 0) + Number(a.amount));
      });
      (checks ?? []).forEach((c) => {
        const u = used.get(c.id as string) ?? 0;
        const rem = Number(c.amount) - u;
        if (rem < 0) out.push({
          id: `neg-${c.id}`,
          severity: "critical",
          category: "أرصدة سالبة",
          title: `صك ${c.check_number}: متبقٍ سالب`,
          detail: `المتبقي: ${rem.toFixed(2)}`,
        });
      });

      // Deleted expenses without reversal journal entry
      const { data: deletedExp } = await supabase
        .from("expenses")
        .select("id, journal_entry_id")
        .not("deleted_at", "is", null);
      const delIds = (deletedExp ?? []).map((e) => e.id as string);
      if (delIds.length) {
        const { data: revs } = await supabase
          .from("journal_entries")
          .select("source_id")
          .eq("source_type", "expense_reversal")
          .in("source_id", delIds);
        const reversed = new Set((revs ?? []).map((r) => r.source_id as string));
        delIds.forEach((id) => {
          if (!reversed.has(id)) out.push({
            id: `norev-${id}`,
            severity: "warning",
            category: "حذف بدون عكس",
            title: "مصروف محذوف بدون قيد عكسي",
            detail: `expense ${id.slice(0, 8)}`,
          });
        });
      }

      // Funders synced as projects without project_code
      const { data: funders } = await supabase
        .from("funders")
        .select("id, name, is_project, project_code")
        .is("deleted_at", null);
      (funders ?? []).forEach((f) => {
        if (f.is_project && !(f.project_code as string | null)?.trim()) {
          out.push({
            id: `fund-${f.id}`,
            severity: "warning",
            category: "مزامنة الممول/المشروع",
            title: `ممول مفعّل كمشروع بدون رقم مشروع`,
            detail: `${f.name}`,
          });
        }
      });

      // Informational: duplicated RPC signature (known schema-level)
      out.push({
        id: "rpc-dup",
        severity: "info",
        category: "بنية النظام",
        title: "وجود توقيعين لدالة create_expense_atomic",
        detail: "استخدم استدعاءات بـ named parameters لتفادي الالتباس.",
      });

      return out;
    },
    staleTime: 30_000,
  });

  if (isLoading) return <div className="flex justify-center p-8"><Loader2 className="size-5 animate-spin" /></div>;
  if (!data?.length) return (
    <Card><CardContent className="p-8 text-center text-muted-foreground">لا توجد تحذيرات حالياً.</CardContent></Card>
  );

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">الخطورة</TableHead>
              <TableHead>التصنيف</TableHead>
              <TableHead>العنوان</TableHead>
              <TableHead>التفاصيل</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((i) => (
              <TableRow key={i.id}>
                <TableCell>{sevBadge(i.severity)}</TableCell>
                <TableCell className="text-sm">{i.category}</TableCell>
                <TableCell className="font-medium">{i.title}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{i.detail}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
