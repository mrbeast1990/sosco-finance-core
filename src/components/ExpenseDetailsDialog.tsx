import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/utils";
import { LoadingState } from "@/components/States";
import { FileText, Paperclip } from "lucide-react";

export function ExpenseDetailsDialog({
  expenseId,
  open,
  onOpenChange,
}: {
  expenseId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { data, isLoading } = useQuery({
    enabled: !!expenseId && open,
    queryKey: ["expense-full", expenseId],
    queryFn: async () => {
      const { data: exp, error } = await supabase
        .from("expenses")
        .select(`
          *,
          expense_categories(name),
          projects(code, name),
          assets(asset_code, asset_name),
          expense_funding_allocations(
            amount,
            funding_checks(check_number, amount, funders(name), cash_accounts(name))
          ),
          payables(id, creditor_name, original_amount, paid_amount, status, due_date)
        `)
        .eq("id", expenseId!)
        .maybeSingle();
      if (error) throw error;

      let creator: any = null;
      if (exp?.created_by) {
        const { data: p } = await supabase
          .from("profiles").select("full_name, email").eq("id", exp.created_by).maybeSingle();
        creator = p;
      }
      return { exp, creator };
    },
  });

  const exp = data?.exp as any;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="size-5" /> تفاصيل المصروف
          </DialogTitle>
        </DialogHeader>

        {isLoading || !exp ? <LoadingState /> : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <Info label="رقم المصروف" value={<span className="font-mono text-xs" dir="ltr">{exp.id.slice(0, 8)}</span>} />
              <Info label="التاريخ" value={formatDate(exp.expense_date)} />
              <Info label="المبلغ" value={<span className="tabular-nums font-semibold">{formatCurrency(exp.amount)}</span>} />
              <Info label="النطاق" value={
                exp.expense_scope === "asset" ? "أصل" :
                exp.expense_scope === "project" ? "مشروع" : "عام"
              } />
              {exp.expense_scope === "project" && exp.projects && (
                <Info label="المشروع" value={`${exp.projects.name} (${exp.projects.code})`} />
              )}
              {exp.expense_scope === "asset" && exp.assets && (
                <Info label="الأصل" value={`${exp.assets.asset_name} (${exp.assets.asset_code})`} />
              )}
              <Info label="الفئة" value={exp.expense_categories?.name ?? "—"} />
              {exp.expense_scope === "asset" && (
                <>
                  <Info label="نوع مصروف الأصل" value={exp.asset_expense_type ?? "—"} />
                  <Info label="المعالجة المحاسبية" value={
                    exp.asset_cost_treatment === "capital_improvement"
                      ? <Badge>تحسين رأسمالي</Badge>
                      : <Badge variant="outline">مصروف تشغيلي</Badge>
                  } />
                </>
              )}
              <Info label="حالة الدفع" value={
                exp.payment_status === "payable"
                  ? <Badge variant="destructive">آجل</Badge>
                  : <Badge>مدفوع</Badge>
              } />
              {exp.payment_status === "payable" && (
                <>
                  <Info label="الدائن" value={exp.creditor_name ?? "—"} />
                  <Info label="تاريخ الاستحقاق" value={exp.due_date ? formatDate(exp.due_date) : "—"} />
                </>
              )}
              <Info label="أنشئ بواسطة" value={data?.creator?.full_name ?? data?.creator?.email ?? "—"} />
              <Info label="تاريخ الإنشاء" value={formatDate(exp.created_at)} />
              {exp.journal_entry_id && (
                <Info label="قيد اليومية" value={<span className="font-mono text-xs" dir="ltr">{exp.journal_entry_id.slice(0, 8)}</span>} />
              )}
            </div>

            {exp.description && (
              <Card><CardHeader><CardTitle className="text-sm">الوصف</CardTitle></CardHeader>
                <CardContent className="text-sm text-muted-foreground whitespace-pre-wrap">{exp.description}</CardContent></Card>
            )}

            {exp.payment_status === "paid" && (exp.expense_funding_allocations ?? []).length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-sm">تخصيصات صكوك التمويل</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>رقم الصك</TableHead>
                      <TableHead>الممول</TableHead>
                      <TableHead>حساب الإيداع</TableHead>
                      <TableHead className="text-left">المبلغ المخصص</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {(exp.expense_funding_allocations ?? []).map((a: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell dir="ltr" className="tabular-nums">{a.funding_checks?.check_number ?? "—"}</TableCell>
                          <TableCell>{a.funding_checks?.funders?.name ?? "—"}</TableCell>
                          <TableCell>{a.funding_checks?.cash_accounts?.name ?? "—"}</TableCell>
                          <TableCell className="text-left tabular-nums">{formatCurrency(a.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {exp.payment_status === "payable" && (exp.payables ?? []).length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-sm">حالة الذمة الدائنة</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                  {(exp.payables ?? []).map((p: any) => (
                    <div key={p.id} className="contents">
                      <Info label="المبلغ الأصلي" value={formatCurrency(p.original_amount)} />
                      <Info label="المسدد" value={formatCurrency(p.paid_amount)} />
                      <Info label="المتبقي" value={formatCurrency(Number(p.original_amount) - Number(p.paid_amount))} />
                      <Info label="الحالة" value={p.status} />
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {(exp.attachment_url || exp.excel_attachment_url) && (
              <Card>
                <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Paperclip className="size-4" /> المرفقات</CardTitle></CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  {exp.attachment_url && <AttachmentLink url={exp.attachment_url} label="المرفق الرئيسي" />}
                  {exp.excel_attachment_url && <AttachmentLink url={exp.excel_attachment_url} label="ملف Excel" />}
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-lg border p-2.5 bg-muted/30 min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium mt-1 text-sm truncate" title={typeof value === "string" ? value : undefined}>{value}</div>
    </div>
  );
}

function AttachmentLink({ url, label }: { url: string; label: string }) {
  const isPath = !url.startsWith("http");
  const { data } = useQuery({
    enabled: isPath,
    queryKey: ["signed-url", url],
    queryFn: async () => {
      const bucket = "expense-attachments";
      const { data } = await supabase.storage.from(bucket).createSignedUrl(url, 3600);
      return data?.signedUrl ?? null;
    },
  });
  const href = isPath ? data : url;
  return (
    <a href={href ?? "#"} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
      <Paperclip className="size-3.5" /> {label}
    </a>
  );
}
