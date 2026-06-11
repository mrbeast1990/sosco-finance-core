import * as XLSX from "xlsx";

export interface ExcelReportMeta {
  companyName?: string;
  reportName: string;
  periodLabel?: string;
  userLabel?: string;
}

export interface ExcelColumn<T = Record<string, unknown>> {
  header: string;
  key: keyof T | string;
  width?: number;
  formatter?: (value: unknown, row: T) => string | number;
}

/**
 * Export a tabular dataset to xlsx with a report header (company / report name / period / user / date).
 * Layout (rows are 1-indexed):
 *   1: companyName (merged)
 *   2: reportName (merged)
 *   3: period | user | generated-at
 *   4: blank
 *   5: column headers
 *   6..: data rows
 */
export function exportToExcel<T extends Record<string, unknown>>(
  rows: T[],
  columns: ExcelColumn<T>[],
  meta: ExcelReportMeta,
  filename?: string,
) {
  const company = meta.companyName ?? "سوسكو — النظام المحاسبي";
  const generatedAt = new Date().toLocaleString("ar-LY");

  const aoa: (string | number)[][] = [];
  aoa.push([company]);
  aoa.push([meta.reportName]);
  aoa.push([
    meta.periodLabel ? `الفترة: ${meta.periodLabel}` : "",
    meta.userLabel ? `المستخدم: ${meta.userLabel}` : "",
    `تاريخ الإنشاء: ${generatedAt}`,
  ]);
  aoa.push([]);
  aoa.push(columns.map((c) => c.header));
  for (const r of rows) {
    aoa.push(
      columns.map((c) => {
        const raw = (r as Record<string, unknown>)[c.key as string];
        if (c.formatter) return c.formatter(raw, r);
        if (raw == null) return "";
        if (typeof raw === "number") return raw;
        return String(raw);
      }),
    );
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Merge header rows across all columns
  const lastCol = Math.max(columns.length - 1, 2);
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: lastCol } },
  ];
  ws["!cols"] = columns.map((c) => ({ wch: c.width ?? 18 }));
  // RTL display
  ws["!sheetView"] = [{ RTL: true }] as never;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(meta.reportName));
  const file =
    filename ??
    `${meta.reportName.replace(/[\\/:*?"<>|]/g, "_")}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, file);
}

function sanitizeSheetName(name: string) {
  return name.replace(/[\\/?*[\]:]/g, "_").slice(0, 31) || "Report";
}
