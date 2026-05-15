import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadingState, EmptyState } from "@/components/States";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/journal-entries")({ component: JournalPage });

function JournalPage() {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const { data, isLoading } = useQuery({
    queryKey: ["journal"],
    queryFn: async () => {
      const { data, error } = await supabase.from("journal_entries")
        .select("*, journal_lines(*, accounts(code, name))")
        .order("entry_date", { ascending: false }).limit(200);
      if (error) throw error;
      return data;
    },
  });

  return (
    <div>
      <PageHeader title="القيود اليومية" description="سجل القيود المحاسبية - يتم إنشاؤها تلقائياً مع كل عملية" />
      <Card>
        <CardContent className="p-4">
          {isLoading ? <LoadingState /> : (data?.length ?? 0) === 0 ? <EmptyState title="لا توجد قيود بعد" /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead></TableHead>
                  <TableHead>رقم القيد</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>البيان</TableHead>
                  <TableHead className="text-left">إجمالي مدين</TableHead>
                  <TableHead className="text-left">إجمالي دائن</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data ?? []).map((je: any) => {
                  const totalDebit = je.journal_lines.reduce((s: number, l: any) => s + Number(l.debit), 0);
                  const totalCredit = je.journal_lines.reduce((s: number, l: any) => s + Number(l.credit), 0);
                  const isOpen = expanded[je.id];
                  return (
                    <Fragment key={je.id}>
                      <TableRow className="cursor-pointer" onClick={() => setExpanded((s) => ({ ...s, [je.id]: !s[je.id] }))}>
                        <TableCell>
                          <Button size="sm" variant="ghost">{isOpen ? <ChevronDown className="size-4" /> : <ChevronLeft className="size-4" />}</Button>
                        </TableCell>
                        <TableCell className="font-medium tabular-nums" dir="ltr">{je.entry_number}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{formatDate(je.entry_date)}</TableCell>
                        <TableCell>{je.description}</TableCell>
                        <TableCell className="text-left font-medium tabular-nums">{formatCurrency(totalDebit)}</TableCell>
                        <TableCell className="text-left font-medium tabular-nums">{formatCurrency(totalCredit)}</TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow>
                          <TableCell colSpan={6} className="bg-muted/40 p-0">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="w-12"></TableHead>
                                  <TableHead>الحساب</TableHead>
                                  <TableHead>البيان</TableHead>
                                  <TableHead className="text-left">مدين</TableHead>
                                  <TableHead className="text-left">دائن</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {je.journal_lines.map((l: any) => (
                                  <TableRow key={l.id}>
                                    <TableCell></TableCell>
                                    <TableCell><span className="tabular-nums text-muted-foreground" dir="ltr">{l.accounts?.code}</span> — {l.accounts?.name}</TableCell>
                                    <TableCell className="text-muted-foreground text-sm">{l.description ?? "—"}</TableCell>
                                    <TableCell className="text-left tabular-nums">{Number(l.debit) > 0 ? formatCurrency(l.debit) : "—"}</TableCell>
                                    <TableCell className="text-left tabular-nums">{Number(l.credit) > 0 ? formatCurrency(l.credit) : "—"}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
