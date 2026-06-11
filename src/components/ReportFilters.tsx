import { useQuery } from "@tanstack/react-query";
import { Filter, RotateCcw, FileSpreadsheet, Printer, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/lib/auth";

export interface ReportFiltersState {
  from?: string;
  to?: string;
  projectId?: string;
  assetId?: string;
  funderId?: string;
  checkId?: string;
  categoryId?: string;
  creditor?: string;
  paymentStatus?: "paid" | "payable" | "";
  expenseScope?: "project" | "asset" | "general" | "";
  userId?: string;
  q?: string;
}

interface Props {
  value: ReportFiltersState;
  onChange: (v: ReportFiltersState) => void;
  onApply?: () => void;
  onReset?: () => void;
  onExportExcel?: () => void;
  onPrint?: () => void;
  /** Subset of filters to show. Defaults to all. */
  show?: Array<keyof ReportFiltersState>;
}

const ALL: Array<keyof ReportFiltersState> = [
  "from",
  "to",
  "projectId",
  "assetId",
  "funderId",
  "checkId",
  "categoryId",
  "creditor",
  "paymentStatus",
  "expenseScope",
  "userId",
  "q",
];

export function ReportFilters({
  value,
  onChange,
  onApply,
  onReset,
  onExportExcel,
  onPrint,
  show = ALL,
}: Props) {
  const [open, setOpen] = useState(false);
  const { can } = useAuth();
  const canExport = can("reports.export");
  const has = (k: keyof ReportFiltersState) => show.includes(k);

  const { data: refs } = useQuery({
    queryKey: ["report-filter-refs"],
    queryFn: async () => {
      const [projects, assets, funders, checks, cats, users] = await Promise.all([
        has("projectId")
          ? supabase.from("projects").select("id,code,name").is("deleted_at", null).order("code")
          : Promise.resolve({ data: [] as any[] }),
        has("assetId")
          ? supabase.from("assets").select("id,asset_name").is("deleted_at", null).order("asset_name")
          : Promise.resolve({ data: [] as any[] }),
        has("funderId")
          ? supabase.from("funders").select("id,name").is("deleted_at", null).order("name")
          : Promise.resolve({ data: [] as any[] }),
        has("checkId")
          ? supabase.from("funding_checks").select("id,check_number").is("deleted_at", null).order("check_number")
          : Promise.resolve({ data: [] as any[] }),
        has("categoryId")
          ? supabase.from("expense_categories").select("id,name").order("name")
          : Promise.resolve({ data: [] as any[] }),
        has("userId")
          ? supabase.from("profiles").select("id,full_name,email").order("full_name")
          : Promise.resolve({ data: [] as any[] }),
      ]);
      return {
        projects: projects.data ?? [],
        assets: assets.data ?? [],
        funders: funders.data ?? [],
        checks: checks.data ?? [],
        categories: cats.data ?? [],
        users: users.data ?? [],
      };
    },
  });

  const set = (patch: Partial<ReportFiltersState>) => onChange({ ...value, ...patch });
  const selVal = (v: string | undefined) => (v && v.length > 0 ? v : "__all__");
  const fromSel = (v: string) => (v === "__all__" ? undefined : v);

  return (
    <Card className="no-print mb-3">
      <CardContent className="p-3">
        <div className="flex flex-wrap items-center gap-2 justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOpen((v) => !v)}
            className="gap-1"
          >
            <Filter className="size-4" />
            الفلاتر
            {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          </Button>
          <div className="flex flex-wrap gap-2">
            {onApply && (
              <Button size="sm" onClick={onApply} className="gap-1">
                تطبيق
              </Button>
            )}
            {onReset && (
              <Button size="sm" variant="outline" onClick={onReset} className="gap-1">
                <RotateCcw className="size-3" />
                إعادة تعيين
              </Button>
            )}
            {onExportExcel && canExport && (
              <Button size="sm" variant="outline" onClick={onExportExcel} className="gap-1">
                <FileSpreadsheet className="size-3" />
                Excel
              </Button>
            )}
            {onPrint && canExport && (
              <Button size="sm" variant="outline" onClick={onPrint} className="gap-1">
                <Printer className="size-3" />
                طباعة / PDF
              </Button>
            )}
          </div>
        </div>
        {open && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {has("from") && (
              <Field label="من تاريخ">
                <Input
                  type="date"
                  value={value.from ?? ""}
                  onChange={(e) => set({ from: e.target.value || undefined })}
                />
              </Field>
            )}
            {has("to") && (
              <Field label="إلى تاريخ">
                <Input
                  type="date"
                  value={value.to ?? ""}
                  onChange={(e) => set({ to: e.target.value || undefined })}
                />
              </Field>
            )}
            {has("projectId") && refs && (
              <Field label="المشروع">
                <Select value={selVal(value.projectId)} onValueChange={(v) => set({ projectId: fromSel(v) })}>
                  <SelectTrigger><SelectValue placeholder="الكل" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">الكل</SelectItem>
                    {refs.projects.map((p: any) => (
                      <SelectItem key={p.id} value={p.id} title={`${p.code} — ${p.name}`}>
                        {p.code} — {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            {has("assetId") && refs && (
              <Field label="الأصل">
                <Select value={selVal(value.assetId)} onValueChange={(v) => set({ assetId: fromSel(v) })}>
                  <SelectTrigger><SelectValue placeholder="الكل" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">الكل</SelectItem>
                    {refs.assets.map((a: any) => (
                      <SelectItem key={a.id} value={a.id} title={a.asset_name}>{a.asset_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            {has("funderId") && refs && (
              <Field label="الممول">
                <Select value={selVal(value.funderId)} onValueChange={(v) => set({ funderId: fromSel(v) })}>
                  <SelectTrigger><SelectValue placeholder="الكل" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">الكل</SelectItem>
                    {refs.funders.map((f: any) => (
                      <SelectItem key={f.id} value={f.id} title={f.name}>{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            {has("checkId") && refs && (
              <Field label="الصك">
                <Select value={selVal(value.checkId)} onValueChange={(v) => set({ checkId: fromSel(v) })}>
                  <SelectTrigger><SelectValue placeholder="الكل" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">الكل</SelectItem>
                    {refs.checks.map((c: any) => (
                      <SelectItem key={c.id} value={c.id} title={c.check_number}>صك {c.check_number}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            {has("categoryId") && refs && (
              <Field label="فئة المصروف">
                <Select value={selVal(value.categoryId)} onValueChange={(v) => set({ categoryId: fromSel(v) })}>
                  <SelectTrigger><SelectValue placeholder="الكل" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">الكل</SelectItem>
                    {refs.categories.map((c: any) => (
                      <SelectItem key={c.id} value={c.id} title={c.name}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            {has("creditor") && (
              <Field label="الدائن">
                <Input
                  value={value.creditor ?? ""}
                  onChange={(e) => set({ creditor: e.target.value || undefined })}
                  placeholder="اسم الدائن"
                />
              </Field>
            )}
            {has("paymentStatus") && (
              <Field label="حالة الدفع">
                <Select
                  value={value.paymentStatus && value.paymentStatus.length > 0 ? value.paymentStatus : "__all__"}
                  onValueChange={(v) => set({ paymentStatus: v === "__all__" ? "" : (v as any) })}
                >
                  <SelectTrigger><SelectValue placeholder="الكل" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">الكل</SelectItem>
                    <SelectItem value="paid">مدفوع</SelectItem>
                    <SelectItem value="payable">آجل</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            )}
            {has("expenseScope") && (
              <Field label="نطاق المصروف">
                <Select
                  value={value.expenseScope && value.expenseScope.length > 0 ? value.expenseScope : "__all__"}
                  onValueChange={(v) => set({ expenseScope: v === "__all__" ? "" : (v as any) })}
                >
                  <SelectTrigger><SelectValue placeholder="الكل" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">الكل</SelectItem>
                    <SelectItem value="project">مشروع</SelectItem>
                    <SelectItem value="asset">أصل</SelectItem>
                    <SelectItem value="general">عام</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            )}
            {has("userId") && refs && (
              <Field label="المستخدم">
                <Select value={selVal(value.userId)} onValueChange={(v) => set({ userId: fromSel(v) })}>
                  <SelectTrigger><SelectValue placeholder="الكل" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">الكل</SelectItem>
                    {refs.users.map((u: any) => (
                      <SelectItem key={u.id} value={u.id} title={u.full_name ?? u.email}>
                        {u.full_name ?? u.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            {has("q") && (
              <Field label="بحث نصي">
                <Input
                  value={value.q ?? ""}
                  onChange={(e) => set({ q: e.target.value || undefined })}
                  placeholder="ابحث..."
                />
              </Field>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

export function emptyFilters(): ReportFiltersState {
  return {};
}

export function periodLabel(f: ReportFiltersState) {
  if (f.from && f.to) return `${f.from} → ${f.to}`;
  if (f.from) return `من ${f.from}`;
  if (f.to) return `حتى ${f.to}`;
  return "كل الفترات";
}
