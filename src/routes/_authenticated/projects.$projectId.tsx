import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Kpi } from "@/components/reports/ReportShell";
import { LoadingState, EmptyState } from "@/components/States";
import { ExpenseDetailsDialog } from "@/components/ExpenseDetailsDialog";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { ArrowRight } from "lucide-react";

export const Route = createFileRoute("/_authenticated/projects/$projectId")({
  component: ProjectDetailsPage,
});

const statusLabels: Record<string, string> = {
  active: "نشط", completed: "مكتمل", on_hold: "معلق", cancelled: "ملغي",
};
const statusVariants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default", completed: "secondary", on_hold: "outline", cancelled: "destructive",
};

function ProjectDetailsPage() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate();
  const { can, isAdmin } = useAuth();
  const canFinancial = can("reports.financial") || isAdmin;
  const [expenseId, setExpenseId] = useState<string | null>(null);

  const { data: project, isLoading: loadingProject } = useQuery({
    queryKey: ["project-detail", projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("*").eq("id", projectId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Linked funder (if any) — matches by projects.code = funders.project_code
  const { data: linkedFunder } = useQuery({
    queryKey: ["project-funder", project?.code],
    enabled: !!project?.code,
    queryFn: async () => {
      const { data } = await supabase.from("funders")
        .select("id, name, project_code, is_project")
        .eq("project_code", project!.code)
        .eq("is_project", true)
        .is("deleted_at", null)
        .maybeSingle();
      return data;
    },
  });

  const { data: checks = [] } = useQuery({
    queryKey: ["project-checks", linkedFunder?.id],
    enabled: !!linkedFunder?.id,
    queryFn: async () => {
      const { data } = await supabase.from("funding_checks")
        .select("id, check_number, amount, received_date, notes, cash_account_id")
        .eq("funder_id", linkedFunder!.id)
        .is("deleted_at", null)
        .order("received_date", { ascending: false });
      return data ?? [];
    },
  });

  const { data: expenses = [], isLoading: loadingExp } = useQuery({
    queryKey: ["project-expenses", projectId],
    queryFn: async () => {
      const { data } = await supabase.from("expenses")
        .select("id, expense_date, amount, description, payment_status, category_id, expense_categories(name)")
        .eq("project_id", projectId)
        .is("deleted_at", null)
        .order("expense_date", { ascending: false });
      return data ?? [];
    },
  });

  const { data: withdrawals = [] } = useQuery({
    queryKey: ["project-withdrawals", projectId],
    queryFn: async () => {
      const { data } = await supabase.from("owner_withdrawals")
        .select("id, withdrawal_no, withdrawal_date, person_name, amount, status")
        .eq("project_id", projectId)
        .is("deleted_at", null)
        .order("withdrawal_date", { ascending: false });
      return data ?? [];
    },
  });

  const totalIncome = checks.reduce((s, c) => s + Number(c.amount || 0), 0);
  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const paidExpenses = expenses.filter(e => e.payment_status === "paid").reduce((s, e) => s + Number(e.amount || 0), 0);
  const payableExpenses = expenses.filter(e => e.payment_status === "payable").reduce((s, e) => s + Number(e.amount || 0), 0);
  const totalWithdrawals = withdrawals.filter(w => w.status === "approved").reduce((s, w) => s + Number(w.amount || 0), 0);
  const balance = totalIncome - totalExpenses - totalWithdrawals;

  // Category summary
  const categoryMap = new Map<string, { name: string; count: number; total: number }>();
  for (const e of expenses) {
    const name = (e as any).expense_categories?.name ?? "—";
    const cur = categoryMap.get(name) ?? { name, count: 0, total: 0 };
    cur.count += 1;
    cur.total += Number(e.amount || 0);
    categoryMap.set(name, cur);
  }
  const categories = Array.from(categoryMap.values()).sort((a, b) => b.total - a.total);

  if (loadingProject) return <LoadingState />;
  if (!project) return <EmptyState title="المشروع غير موجود" description="تحقق من الرابط" />;

  return (
    <div>
      <PageHeader
        title={project.name}
        description={`كود المشروع: ${project.code}`}
        actions={
          <Button variant="outline" size="sm" onClick={() => navigate({ to: "/projects" })}>
            <ArrowRight className="size-4" /> رجوع
          </Button>
        }
      />

      <Card className="mb-4">
        <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
          <div><div className="text-muted-foreground text-xs mb-1">الحالة</div>
            <Badge variant={statusVariants[project.status]}>{statusLabels[project.status] ?? project.status}</Badge></div>
          <div><div className="text-muted-foreground text-xs mb-1">تاريخ الإنشاء</div>{formatDate(project.created_at)}</div>
          <div><div className="text-muted-foreground text-xs mb-1">الممول المرتبط</div>
            {linkedFunder ? linkedFunder.name : <span className="text-muted-foreground">— غير مرتبط</span>}</div>
          <div><div className="text-muted-foreground text-xs mb-1">ملاحظات</div>
            <span className="text-muted-foreground">{project.notes || "—"}</span></div>
        </CardContent>
      </Card>

      {canFinancial && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
          <Kpi label="التمويل المستلم" value={formatCurrency(totalIncome)} tone="info" hint={`${checks.length} صك`} />
          <Kpi label="إجمالي المصاريف" value={formatCurrency(totalExpenses)} hint={`${expenses.length} مصروف`} />
          <Kpi label="مدفوع" value={formatCurrency(paidExpenses)} tone="ok" />
          <Kpi label="آجل" value={formatCurrency(payableExpenses)} tone="warn" />
          <Kpi label="المسحوبات" value={formatCurrency(totalWithdrawals)} tone="warn" />
          <Kpi label="الرصيد" value={formatCurrency(balance)} tone={balance >= 0 ? "ok" : "bad"} />
        </div>
      )}

      <Tabs defaultValue="summary">
        <TabsList className="mb-3">
          <TabsTrigger value="summary">الملخص</TabsTrigger>
          <TabsTrigger value="expenses">المصاريف ({expenses.length})</TabsTrigger>
          <TabsTrigger value="checks">الصكوك ({checks.length})</TabsTrigger>
          <TabsTrigger value="withdrawals">المسحوبات ({withdrawals.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="summary">
          <Card>
            <CardContent className="p-4">
              <h3 className="text-sm font-semibold mb-3">المصاريف حسب الفئة</h3>
              {categories.length === 0 ? <EmptyState title="لا توجد بيانات" /> : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>الفئة</TableHead>
                    <TableHead>العدد</TableHead>
                    {canFinancial && <TableHead>الإجمالي</TableHead>}
                    {canFinancial && <TableHead>النسبة</TableHead>}
                  </TableRow></TableHeader>
                  <TableBody>
                    {categories.map(c => (
                      <TableRow key={c.name}>
                        <TableCell>{c.name}</TableCell>
                        <TableCell className="tabular-nums">{c.count}</TableCell>
                        {canFinancial && <TableCell className="tabular-nums">{formatCurrency(c.total)}</TableCell>}
                        {canFinancial && <TableCell className="tabular-nums">
                          {totalExpenses > 0 ? ((c.total / totalExpenses) * 100).toFixed(1) + "%" : "—"}
                        </TableCell>}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="expenses">
          <Card><CardContent className="p-4">
            {loadingExp ? <LoadingState /> : expenses.length === 0 ? <EmptyState title="لا مصاريف" /> : (
              <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>الفئة</TableHead>
                  <TableHead>الوصف</TableHead>
                  {canFinancial && <TableHead>المبلغ</TableHead>}
                  <TableHead>الحالة</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {expenses.map(e => (
                    <TableRow key={e.id} className="cursor-pointer hover:bg-accent/40" onClick={() => setExpenseId(e.id)}>
                      <TableCell>{formatDate(e.expense_date)}</TableCell>
                      <TableCell>{(e as any).expense_categories?.name ?? "—"}</TableCell>
                      <TableCell className="max-w-[300px] truncate">{e.description ?? "—"}</TableCell>
                      {canFinancial && <TableCell className="tabular-nums">{formatCurrency(e.amount)}</TableCell>}
                      <TableCell>
                        <Badge variant={e.payment_status === "paid" ? "default" : "outline"}>
                          {e.payment_status === "paid" ? "مدفوع" : "آجل"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            )}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="checks">
          <Card><CardContent className="p-4">
            {!linkedFunder ? (
              <EmptyState title="لا يوجد ممول مرتبط بهذا المشروع" description="ربط الممول يتم من شاشة الممولين بتفعيل خيار (هذا الممول مشروع) واختيار كود المشروع" />
            ) : checks.length === 0 ? <EmptyState title="لا توجد صكوك" /> : (
              <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>رقم الصك</TableHead>
                  <TableHead>التاريخ</TableHead>
                  {canFinancial && <TableHead>المبلغ</TableHead>}
                  <TableHead>ملاحظات</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {checks.map(c => (
                    <TableRow key={c.id}>
                      <TableCell className="tabular-nums">{c.check_number}</TableCell>
                      <TableCell>{formatDate(c.received_date)}</TableCell>
                      {canFinancial && <TableCell className="tabular-nums">{formatCurrency(c.amount)}</TableCell>}
                      <TableCell className="max-w-[300px] truncate">{c.notes ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            )}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="withdrawals">
          <Card><CardContent className="p-4">
            {withdrawals.length === 0 ? <EmptyState title="لا توجد مسحوبات" /> : (
              <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>الرقم</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>الشخص</TableHead>
                  {canFinancial && <TableHead>المبلغ</TableHead>}
                  <TableHead>الحالة</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {withdrawals.map(w => (
                    <TableRow key={w.id}>
                      <TableCell className="tabular-nums">{w.withdrawal_no}</TableCell>
                      <TableCell>{formatDate(w.withdrawal_date)}</TableCell>
                      <TableCell>{w.person_name}</TableCell>
                      {canFinancial && <TableCell className="tabular-nums">{formatCurrency(w.amount)}</TableCell>}
                      <TableCell>
                        <Badge variant={w.status === "approved" ? "default" : w.status === "cancelled" ? "destructive" : "outline"}>
                          {w.status === "approved" ? "معتمد" : w.status === "cancelled" ? "ملغي" : "مسودة"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            )}
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      <ExpenseDetailsDialog expenseId={expenseId} open={!!expenseId} onOpenChange={(o) => !o && setExpenseId(null)} />
    </div>
  );
}
