import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search } from "lucide-react";
import { LoadingState, EmptyState } from "@/components/States";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell, Legend } from "recharts";
import { useAuth } from "@/lib/auth";
import { ProjectStatementReport } from "@/components/reports/ProjectStatementReport";
import { CheckStatementReport } from "@/components/reports/CheckStatementReport";
import { PayablesReport } from "@/components/reports/PayablesReport";
import { CashFlowReport } from "@/components/reports/CashFlowReport";

export const Route = createFileRoute("/_authenticated/reports")({ component: ReportsPage });

const COLORS = ["oklch(0.6 0.13 195)", "oklch(0.62 0.15 155)", "oklch(0.7 0.15 60)", "oklch(0.55 0.2 25)", "oklch(0.5 0.15 285)", "oklch(0.5 0.1 320)"];

function ReportsPage() {
  const { can, isAdmin } = useAuth();
  const nav = useNavigate();
  const allowed = can("reports.view") || isAdmin;
  const canFinancial = can("reports.financial") || isAdmin;

  useEffect(() => {
    if (!allowed) nav({ to: "/dashboard" });
  }, [allowed, nav]);

  if (!allowed) return null;

  return (
    <div dir="rtl">
      <PageHeader title="التقارير" description="مركز التقارير المالية والإدارية" />
      <Tabs defaultValue="project-statement" className="space-y-3">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="project-statement">كشف مشروع</TabsTrigger>
          <TabsTrigger value="check-statement">كشف صك</TabsTrigger>
          <TabsTrigger value="payables">الذمم الدائنة</TabsTrigger>
          {canFinancial && <TabsTrigger value="cashflow">التدفق النقدي</TabsTrigger>}
          <TabsTrigger value="tracker">تتبع برقم</TabsTrigger>
          <TabsTrigger value="funding">التمويل</TabsTrigger>
          <TabsTrigger value="projects">مصروفات المشاريع</TabsTrigger>
          <TabsTrigger value="analysis">تحليل المصروفات</TabsTrigger>
        </TabsList>
        <TabsContent value="project-statement"><ProjectStatementReport /></TabsContent>
        <TabsContent value="check-statement"><CheckStatementReport /></TabsContent>
        <TabsContent value="payables"><PayablesReport /></TabsContent>
        {canFinancial && <TabsContent value="cashflow"><CashFlowReport /></TabsContent>}
        <TabsContent value="tracker"><Tracker /></TabsContent>
        <TabsContent value="funding"><FundingReport /></TabsContent>
        <TabsContent value="projects"><ProjectsReport /></TabsContent>
        <TabsContent value="analysis"><AnalysisReport /></TabsContent>
      </Tabs>
    </div>
  );
}


function Tracker() {
  const [q, setQ] = useState("");
  const term = q.trim();

  const { data: results, isFetching } = useQuery({
    queryKey: ["tracker", term],
    enabled: term.length > 0,
    queryFn: async () => {
      const [chk, prj] = await Promise.all([
        supabase.from("funding_checks")
          .select("id, check_number, amount, received_date, notes, funders(name, project_code), cash_accounts(name)")
          .ilike("check_number", `%${term}%`).is("deleted_at", null).limit(20),
        supabase.from("projects")
          .select("id, code, name, status, notes")
          .ilike("code", `%${term}%`).is("deleted_at", null).limit(20),
      ]);
      return { checks: chk.data ?? [], projects: prj.data ?? [] };
    },
  });

  return (
    <Card><CardContent className="p-4 space-y-4">
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input placeholder="ابحث برقم صك أو رقم مشروع..." className="pr-9" value={q} onChange={(e) => setQ(e.target.value)} dir="ltr" />
      </div>
      {!term && <EmptyState title="اكتب رقم صك أو رقم مشروع لعرض التفاصيل والتتبع" />}
      {term && isFetching && <LoadingState />}
      {term && !isFetching && results && (results.checks.length === 0 && results.projects.length === 0) && <EmptyState title="لا توجد نتائج" />}
      {results?.checks.map((c: any) => <CheckDetails key={c.id} check={c} />)}
      {results?.projects.map((p: any) => <ProjectDetails key={p.id} project={p} />)}
    </CardContent></Card>
  );
}

function CheckDetails({ check }: { check: any }) {
  const { data: allocs } = useQuery({
    queryKey: ["tracker-check", check.id],
    queryFn: async () => (await supabase.from("expense_funding_allocations")
      .select("amount, expenses!inner(id, expense_date, description, deleted_at, projects(code, name), expense_categories(name))")
      .eq("funding_check_id", check.id).is("expenses.deleted_at", null)).data ?? [],
  });
  const used = (allocs ?? []).reduce((s: number, a: any) => s + Number(a.amount), 0);
  const remaining = Number(check.amount) - used;
  const pct = Number(check.amount) > 0 ? (used / Number(check.amount)) * 100 : 0;

  return (
    <Card className="border-primary/40">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <Badge>صك تمويل</Badge>
            <h3 className="text-lg font-bold mt-1" dir="ltr">صك رقم {check.check_number}</h3>
            <p className="text-sm text-muted-foreground">الممول: {check.funders?.name} • الإيداع: {check.cash_accounts?.name} • {formatDate(check.received_date)}</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <Kpi label="المبلغ" value={formatCurrency(check.amount)} />
          <Kpi label="المنصرف" value={formatCurrency(used)} tone="warn" />
          <Kpi label="المتبقي" value={formatCurrency(remaining)} tone={remaining > 0 ? "ok" : "bad"} />
        </div>
        <Progress value={pct} className="h-2 mb-3" />
        <div className="text-xs text-muted-foreground mb-2">{pct.toFixed(1)}% مستهلك</div>
        {(allocs ?? []).length > 0 && (
          <Table>
            <TableHeader><TableRow><TableHead>التاريخ</TableHead><TableHead>المشروع</TableHead><TableHead>الفئة</TableHead><TableHead>الوصف</TableHead><TableHead className="text-left">المبلغ</TableHead></TableRow></TableHeader>
            <TableBody>
              {(allocs ?? []).map((a: any, i: number) => (
                <TableRow key={i}>
                  <TableCell className="text-sm">{formatDate(a.expenses.expense_date)}</TableCell>
                  <TableCell><Badge variant="secondary">{a.expenses.projects?.code} — {a.expenses.projects?.name}</Badge></TableCell>
                  <TableCell className="text-sm">{a.expenses.expense_categories?.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{a.expenses.description ?? "—"}</TableCell>
                  <TableCell className="text-left tabular-nums font-medium">{formatCurrency(a.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function ProjectDetails({ project }: { project: any }) {
  const { data: exp } = useQuery({
    queryKey: ["tracker-project", project.id],
    queryFn: async () => (await supabase.from("expenses")
      .select("id, expense_date, amount, description, expense_categories(name), expense_funding_allocations(amount, funding_checks(check_number, funders(name)))")
      .eq("project_id", project.id).is("deleted_at", null).order("expense_date", { ascending: false })).data ?? [],
  });
  const total = (exp ?? []).reduce((s: number, e: any) => s + Number(e.amount), 0);
  const byCategory = useMemo(() => {
    const m = new Map<string, number>();
    (exp ?? []).forEach((e: any) => {
      const k = e.expense_categories?.name ?? "غير محدد";
      m.set(k, (m.get(k) ?? 0) + Number(e.amount));
    });
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [exp]);

  return (
    <Card className="border-primary/40">
      <CardContent className="p-4">
        <div className="mb-3">
          <Badge variant="default">مشروع</Badge>
          <h3 className="text-lg font-bold mt-1">{project.name} <span className="text-muted-foreground text-sm" dir="ltr">({project.code})</span></h3>
        </div>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <Kpi label="إجمالي المصروفات" value={formatCurrency(total)} tone="warn" />
          <Kpi label="عدد الحركات" value={String((exp ?? []).length)} />
          <Kpi label="عدد الفئات" value={String(byCategory.length)} />
        </div>
        {byCategory.length > 0 && (
          <div className="mb-3">
            <div className="text-sm font-medium mb-2">حسب الفئة</div>
            <div className="flex flex-wrap gap-2">
              {byCategory.map(([n, v]) => <Badge key={n} variant="outline">{n}: {formatCurrency(v)}</Badge>)}
            </div>
          </div>
        )}
        {(exp ?? []).length > 0 && (
          <Table>
            <TableHeader><TableRow><TableHead>التاريخ</TableHead><TableHead>الفئة</TableHead><TableHead>الصكوك</TableHead><TableHead>الوصف</TableHead><TableHead className="text-left">المبلغ</TableHead></TableRow></TableHeader>
            <TableBody>
              {(exp ?? []).slice(0, 50).map((e: any) => (
                <TableRow key={e.id}>
                  <TableCell className="text-sm">{formatDate(e.expense_date)}</TableCell>
                  <TableCell className="text-sm">{e.expense_categories?.name}</TableCell>
                  <TableCell className="text-xs" dir="ltr">{(e.expense_funding_allocations ?? []).map((a: any) => a.funding_checks?.check_number).join("، ")}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{e.description ?? "—"}</TableCell>
                  <TableCell className="text-left tabular-nums font-medium">{formatCurrency(e.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "bad" }) {
  const cls = tone === "ok" ? "text-success" : tone === "bad" ? "text-destructive" : tone === "warn" ? "text-primary" : "";
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}

function FundingReport() {
  const { data, isLoading } = useQuery({
    queryKey: ["report-funding"],
    queryFn: async () => {
      const { data: checks } = await supabase.from("funding_checks").select("*, funders(name)").is("deleted_at", null).order("received_date", { ascending: false });
      const { data: allocs } = await supabase.from("expense_funding_allocations")
        .select("funding_check_id, amount, expenses!inner(deleted_at, projects(name))")
        .is("expenses.deleted_at", null);
      return (checks ?? []).map((c: any) => {
        const items = (allocs ?? []).filter((a: any) => a.funding_check_id === c.id);
        const spent = items.reduce((s: number, a: any) => s + Number(a.amount), 0);
        const projects = Array.from(new Set(items.map((a: any) => a.expenses?.projects?.name).filter(Boolean)));
        return { ...c, spent, remaining: Number(c.amount) - spent, projects };
      });
    },
  });

  if (isLoading) return <LoadingState />;
  if ((data?.length ?? 0) === 0) return <Card><CardContent><EmptyState title="لا توجد بيانات" /></CardContent></Card>;
  return (
    <Card><CardContent className="p-4">
      <Table>
        <TableHeader><TableRow>
          <TableHead>رقم الصك</TableHead><TableHead>الممول</TableHead>
          <TableHead className="text-left">المبلغ الأصلي</TableHead><TableHead className="text-left">المنصرف</TableHead>
          <TableHead className="text-left">المتبقي</TableHead><TableHead className="min-w-[140px]">النسبة</TableHead>
          <TableHead>المشاريع الممولة</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {data!.map((c: any) => (
            <TableRow key={c.id}>
              <TableCell className="tabular-nums font-medium" dir="ltr">{c.check_number}</TableCell>
              <TableCell>{c.funders?.name}</TableCell>
              <TableCell className="text-left tabular-nums font-medium">{formatCurrency(c.amount)}</TableCell>
              <TableCell className="text-left tabular-nums text-destructive">{formatCurrency(c.spent)}</TableCell>
              <TableCell className="text-left tabular-nums text-success font-medium">{formatCurrency(c.remaining)}</TableCell>
              <TableCell><Progress value={c.amount > 0 ? (c.spent / Number(c.amount)) * 100 : 0} /></TableCell>
              <TableCell className="text-sm">{c.projects.length > 0 ? c.projects.join("، ") : "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </CardContent></Card>
  );
}

function ProjectsReport() {
  const { data, isLoading } = useQuery({
    queryKey: ["report-projects"],
    queryFn: async () => {
      const { data: projects } = await supabase.from("projects").select("id, name, code").is("deleted_at", null);
      const { data: exp } = await supabase.from("expenses").select("project_id, amount").is("deleted_at", null);
      const map: Record<string, number> = {};
      (exp ?? []).forEach((e) => { if (!e.project_id) return; map[e.project_id] = (map[e.project_id] ?? 0) + Number(e.amount); });
      return (projects ?? []).map((p: any) => ({ ...p, total: map[p.id] ?? 0 })).sort((a, b) => b.total - a.total);
    },
  });
  if (isLoading) return <LoadingState />;
  if ((data?.length ?? 0) === 0) return <Card><CardContent><EmptyState title="لا توجد بيانات" /></CardContent></Card>;
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card><CardContent className="p-4">
        <Table>
          <TableHeader><TableRow><TableHead>الكود</TableHead><TableHead>المشروع</TableHead><TableHead className="text-left">إجمالي المصروفات</TableHead></TableRow></TableHeader>
          <TableBody>
            {data!.map((p: any) => (
              <TableRow key={p.id}>
                <TableCell className="tabular-nums" dir="ltr">{p.code}</TableCell>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell className="text-left tabular-nums font-medium">{formatCurrency(p.total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
      <Card><CardContent className="p-4 h-[400px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data!.slice(0, 10)}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v: any) => formatCurrency(v)} />
            <Bar dataKey="total" fill="oklch(0.6 0.13 195)" />
          </BarChart>
        </ResponsiveContainer>
      </CardContent></Card>
    </div>
  );
}

function AnalysisReport() {
  const { data, isLoading } = useQuery({
    queryKey: ["report-analysis"],
    queryFn: async () => {
      const { data: cats } = await supabase.from("expense_categories").select("id, name");
      const { data: exp } = await supabase.from("expenses").select("category_id, amount").is("deleted_at", null);
      const map: Record<string, number> = {};
      (exp ?? []).forEach((e) => { map[e.category_id] = (map[e.category_id] ?? 0) + Number(e.amount); });
      return (cats ?? []).map((c: any) => ({ name: c.name, value: map[c.id] ?? 0 })).filter((c) => c.value > 0);
    },
  });
  if (isLoading) return <LoadingState />;
  if ((data?.length ?? 0) === 0) return <Card><CardContent><EmptyState title="لا توجد بيانات" /></CardContent></Card>;
  return (
    <Card><CardContent className="p-4 h-[450px]">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data!} dataKey="value" nameKey="name" outerRadius={150} label={(e: any) => `${e.name}: ${formatCurrency(e.value)}`}>
            {data!.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
          <Tooltip formatter={(v: any) => formatCurrency(v)} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </CardContent></Card>
  );
}
