import { Link } from "@tanstack/react-router";
import { Wifi, WifiOff, CloudUpload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useOnlineStatus, useOfflineQueue } from "@/lib/use-online-status";

export function OfflineBadge() {
  const online = useOnlineStatus();
  const queue = useOfflineQueue();
  const pending = queue.filter((q) => q.status === "pending").length;
  const failed = queue.filter((q) => q.status === "failed").length;
  const total = pending + failed;

  return (
    <Link to="/offline-queue" className="flex items-center gap-2">
      {online ? (
        <Badge variant="outline" className="gap-1 text-success border-success/30">
          <Wifi className="size-3" /> متصل
        </Badge>
      ) : (
        <Badge variant="outline" className="gap-1 text-destructive border-destructive/30">
          <WifiOff className="size-3" /> أوفلاين
        </Badge>
      )}
      {total > 0 && (
        <Badge variant={failed > 0 ? "destructive" : "secondary"} className="gap-1">
          <CloudUpload className="size-3" /> {total} معلقة
        </Badge>
      )}
    </Link>
  );
}
