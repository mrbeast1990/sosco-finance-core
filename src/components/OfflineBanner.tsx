import { WifiOff } from "lucide-react";
import { useOnlineStatus, useOfflineQueue } from "@/lib/use-online-status";

export function OfflineBanner() {
  const online = useOnlineStatus();
  const queue = useOfflineQueue();
  const pending = queue.filter((q) => q.status === "pending" || q.status === "failed").length;

  if (online) return null;

  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm text-warning-foreground"
      dir="rtl"
    >
      <WifiOff className="size-4 text-warning shrink-0" />
      <div className="flex-1 leading-tight">
        <div className="font-semibold">أنت تعمل بدون اتصال بالإنترنت</div>
        <div className="text-xs text-muted-foreground">
          سيتم حفظ العمليات في المعلّقة حتى تتم المزامنة
          {pending > 0 ? ` — ${pending} عملية في الانتظار` : ""}
        </div>
      </div>
    </div>
  );
}
