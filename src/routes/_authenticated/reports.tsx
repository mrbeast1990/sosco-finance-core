import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadingState, EmptyState } from "@/components/States";
import { formatCurrency } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell, Legend } from "recharts";

export const Route = createFileRoute("/_authenticated/reports")({ component: ReportsPage });

const COLORS = ["oklch(0.6 0.13 195)", "oklch(0.62 0.15 155)", "oklch(0.7 0.15 60)", "oklch(0.55 0.2 25)", "oklch(0.5 0.15 285)", "oklch(0.5 0.1 320)"];

function ReportsPage() {
  return (
    <div>
      <PageHeader title="التقارير" description="تقارير شاملة عن التمويل والمصروفات" />
      <Tabs defaultValue="funding">
        <TabsList>
          <TabsTrigger value="funding">تقرير التمويل</TabsTrigger>
          <TabsTrigger value="projects">مصروفات المشاريع</TabsTrigger>
          <TabsTrigger value="analysis">تحليل المصروفات</TabsTrigger>
        </TabsList>
        <TabsContent value="funding"><FundingReport /></TabsContent>
        <TabsContent value="projects"><ProjectsReport /></TabsContent>
        <TabsContent value="analysis"><AnalysisReport /></TabsContent>
      </Tabs>
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
      (exp ?? []).forEach((e) => { map[e.project_id] = (map[e.project_id] ?? 0) + Number(e.amount); });
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
