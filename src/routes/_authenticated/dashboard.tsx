import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Wallet, TrendingDown, PiggyBank, Receipt, Briefcase } from "lucide-react";
import { LoadingState, EmptyState } from "@/components/States";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const [checks, expenses, projects, recent] = await Promise.all([
        supabase.from("funding_checks").select("amount").is("deleted_at", null),
        supabase.from("expenses").select("amount").is("deleted_at", null),
        supabase.from("projects").select("id", { count: "exact", head: true }).is("deleted_at", null),
        supabase.from("expenses")
          .select("id, amount, expense_date, description, projects(name), funding_checks(check_number), expense_categories(name)")
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(8),
      ]);
      const totalFunding = (checks.data ?? []).reduce((s, r) => s + Number(r.amount), 0);
      const totalExpenses = (expenses.data ?? []).reduce((s, r) => s + Number(r.amount), 0);
      return {
        totalFunding,
        totalExpenses,
        remaining: totalFunding - totalExpenses,
        projectCount: projects.count ?? 0,
        recent: recent.data ?? [],
      };
    },
  });

  if (isLoading) return <LoadingState />;
  const d = data!;

  const cards = [
    { title: "إجمالي التمويل", value: formatCurrency(d.totalFunding), icon: Wallet, color: "text-primary", bg: "bg-primary/10" },
    { title: "إجمالي المصروفات", value: formatCurrency(d.totalExpenses), icon: TrendingDown, color: "text-destructive", bg: "bg-destructive/10" },
    { title: "الرصيد المتبقي", value: formatCurrency(d.remaining), icon: PiggyBank, color: "text-success", bg: "bg-success/10" },
    { title: "عدد المشاريع", value: d.projectCount.toString(), icon: Briefcase, color: "text-accent", bg: "bg-accent/10" },
  ];

  return (
    <div>
      <PageHeader title="لوحة التحكم" description="نظرة عامة على الوضع المالي للشركة" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {cards.map((c) => (
          <Card key={c.title}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs font-medium text-muted-foreground">{c.title}</div>
                  <div className="text-xl font-bold mt-2 tabular-nums">{c.value}</div>
                </div>
                <div className={`rounded-lg p-2 ${c.bg} ${c.color}`}><c.icon className="size-5" /></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base"><Receipt className="size-4" /> أحدث المصروفات</CardTitle>
        </CardHeader>
        <CardContent>
          {d.recent.length === 0 ? (
            <EmptyState title="لا توجد مصروفات بعد" description="ابدأ بتسجيل المصروفات من صفحة المصروفات" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>المشروع</TableHead>
                  <TableHead>الفئة</TableHead>
                  <TableHead>الصك</TableHead>
                  <TableHead>الوصف</TableHead>
                  <TableHead className="text-left">المبلغ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.recent.map((e: any) => (
                  <TableRow key={e.id}>
                    <TableCell>{formatDate(e.expense_date)}</TableCell>
                    <TableCell>{e.projects?.name ?? "—"}</TableCell>
                    <TableCell>{e.expense_categories?.name ?? "—"}</TableCell>
                    <TableCell className="tabular-nums" dir="ltr">{e.funding_checks?.check_number ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{e.description ?? "—"}</TableCell>
                    <TableCell className="text-left font-medium tabular-nums">{formatCurrency(e.amount)}</TableCell>
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
