import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function Kpi({
  label,
  value,
  tone,
  hint,
  onClick,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "bad" | "info";
  hint?: string;
  onClick?: () => void;
}) {
  const cls =
    tone === "ok"
      ? "text-success"
      : tone === "bad"
        ? "text-destructive"
        : tone === "warn"
          ? "text-amber-600"
          : tone === "info"
            ? "text-primary"
            : "";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "rounded-md border p-3 text-right w-full min-w-0",
        onClick && "hover:bg-accent/40 cursor-pointer transition-colors",
      )}
    >
      <div className="text-xs text-muted-foreground mb-1 truncate">{label}</div>
      <div className={cn("text-base sm:text-lg font-bold tabular-nums truncate", cls)}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-1 truncate">{hint}</div>}
    </button>
  );
}

export function ReportHeader({ title, period, count }: { title: string; period?: string; count?: number }) {
  return (
    <div className="print-only mb-3 border-b pb-2 text-sm">
      <div className="font-bold">سوسكو — النظام المحاسبي</div>
      <div className="text-base font-semibold">{title}</div>
      <div className="text-xs text-muted-foreground flex gap-3">
        {period && <span>الفترة: {period}</span>}
        {count != null && <span>عدد السجلات: {count}</span>}
        <span>تاريخ الإنشاء: {new Date().toLocaleString("ar-LY")}</span>
      </div>
    </div>
  );
}

export function SectionCard({ title, right, children }: { title?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardContent className="p-3 sm:p-4 space-y-3">
        {(title || right) && (
          <div className="flex items-center justify-between gap-2 flex-wrap">
            {title && <h3 className="text-sm font-semibold">{title}</h3>}
            {right}
          </div>
        )}
        {children}
      </CardContent>
    </Card>
  );
}

export function WarnPill({ tone, children }: { tone: "warn" | "bad" | "ok"; children: ReactNode }) {
  const map = {
    warn: "bg-amber-500 hover:bg-amber-500/90 text-white",
    bad: "",
    ok: "bg-success hover:bg-success/90 text-success-foreground",
  };
  if (tone === "bad") return <Badge variant="destructive">{children}</Badge>;
  return <Badge className={map[tone]}>{children}</Badge>;
}
