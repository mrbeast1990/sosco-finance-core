import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/States";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshCw, Trash2, CloudUpload } from "lucide-react";
import { useOfflineQueue, useOnlineStatus } from "@/lib/use-online-status";
import { processQueue, removeOp, retryOp } from "@/lib/offline-queue";
import { toast } from "sonner";
import { formatDate } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/offline-queue")({ component: OfflineQueuePage });

const typeLabels: Record<string, string> = {
  "expense.create": "تسجيل مصروف",
  "check.create": "تسجيل صك تمويل",
};

function OfflineQueuePage() {
  const queue = useOfflineQueue();
  const online = useOnlineStatus();
  const qc = useQueryClient();

  async function syncAll() {
    if (!online) return toast.error("لا يوجد اتصال بالإنترنت");
    const res = await processQueue();
    if (res.ok > 0) {
      toast.success(`تمت مزامنة ${res.ok} عملية`);
      qc.invalidateQueries();
    }
    if (res.failed > 0) toast.error(`فشلت ${res.failed} عملية`);
    if (res.ok === 0 && res.failed === 0) toast.info("لا توجد عمليات معلقة");
  }

  async function retry(id: string) {
    await retryOp(id);
    if (online) await syncAll();
  }

  async function discard(id: string) {
    await removeOp(id);
    toast.success("تم الحذف من الطابور");
  }

  const pending = queue.filter((q) => q.status === "pending");
  const failed = queue.filter((q) => q.status === "failed");

  return (
    <div>
      <PageHeader
        title="العمليات المعلقة"
        description="العمليات التي تم تسجيلها أوفلاين وتنتظر المزامنة مع السيرفر"
        actions={
          <Button onClick={syncAll} disabled={!online || queue.length === 0}>
            <CloudUpload className="size-4" /> مزامنة الآن
          </Button>
        }
      />

      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">إجمالي</div><div className="text-2xl font-bold tabular-nums">{queue.length}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">في الانتظار</div><div className="text-2xl font-bold tabular-nums text-warning">{pending.length}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">فاشلة</div><div className="text-2xl font-bold tabular-nums text-destructive">{failed.length}</div></CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-6">
          {queue.length === 0 ? (
            <EmptyState title="لا توجد عمليات معلقة" description="جميع العمليات متزامنة مع السيرفر" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>النوع</TableHead>
                  <TableHead>الوصف</TableHead>
                  <TableHead>أُنشئت</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>الخطأ</TableHead>
                  <TableHead className="text-left">إجراء</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {queue.map((op) => (
                  <TableRow key={op.id}>
                    <TableCell>{typeLabels[op.type] ?? op.type}</TableCell>
                    <TableCell className="max-w-[300px] truncate">{op.label}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(new Date(op.createdAt).toISOString())}</TableCell>
                    <TableCell>
                      {op.status === "failed" ? (
                        <Badge variant="destructive">فشل ({op.attempts})</Badge>
                      ) : (
                        <Badge variant="secondary">في الانتظار</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-destructive max-w-[260px] truncate">{op.lastError ?? "—"}</TableCell>
                    <TableCell className="text-left">
                      <div className="flex gap-1 justify-end">
                        <Button size="sm" variant="ghost" onClick={() => retry(op.id)} disabled={!online}>
                          <RefreshCw className="size-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => discard(op.id)}>
                          <Trash2 className="size-3.5 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
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
