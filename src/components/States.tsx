import { Loader2 } from "lucide-react";

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="text-muted-foreground text-sm font-medium">{title}</div>
      {description && <div className="text-xs text-muted-foreground/70 mt-1">{description}</div>}
    </div>
  );
}

export function LoadingState() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="size-6 animate-spin text-primary" />
    </div>
  );
}
