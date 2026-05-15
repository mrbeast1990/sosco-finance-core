import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadingState, EmptyState } from "@/components/States";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/expense-categories")({ component: CategoriesPage });

function CategoriesPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("expense_categories")
        .select("id, name, created_at, expense_account_id, accounts:expense_account_id(code, name)").order("name");
      if (error) throw error;
      return data;
    },
  });

  return (
    <div>
      <PageHeader title="فئات المصروفات" description="فئات المصروفات المرتبطة بحسابات شجرة الحسابات" />
      <Card>
        <CardContent className="p-4">
          {isLoading ? <LoadingState /> : (data?.length ?? 0) === 0 ? <EmptyState title="لا توجد فئات" /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الفئة</TableHead>
                  <TableHead>كود الحساب</TableHead>
                  <TableHead>اسم الحساب المحاسبي</TableHead>
                  <TableHead>تاريخ الإنشاء</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data ?? []).map((c: any) => (
                  <TableRow key={c.id}>
                    <TableCell><Badge variant="secondary">{c.name}</Badge></TableCell>
                    <TableCell className="tabular-nums" dir="ltr">{c.accounts?.code ?? "—"}</TableCell>
                    <TableCell>{c.accounts?.name ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{formatDate(c.created_at)}</TableCell>
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
