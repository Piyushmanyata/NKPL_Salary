import {
  buildOfficialExportRows,
  buildReferenceExportRows,
  serializeCsv,
  serializeXlsx,
} from "./exportSheet";
import type { OfficialRow } from "./officialSheet";
import type { SalaryRow } from "./types";

export type ExportMode = "reference" | "main";

export type ExportDownload = {
  content: string | Uint8Array<ArrayBuffer>;
  fileName: string;
  type: string;
};

export type ExportResult =
  | { blocked: string[] }
  | { blocked: []; download: ExportDownload };

export function createExportDownload({
  mode,
  companyName,
  monthLabel,
  salaryRows,
  officialRows,
  format,
}: {
  mode: ExportMode;
  companyName: string;
  monthLabel: string;
  salaryRows: SalaryRow[];
  officialRows: OfficialRow[];
  format: "csv" | "workbook";
}): ExportResult {
  if (mode === "main") {
    const blocked = officialRows.filter((row) => row.unpackable).map((row) => row.name);
    if (blocked.length) return { blocked };
  }

  const rows = mode === "main"
    ? buildOfficialExportRows(officialRows)
    : buildReferenceExportRows(salaryRows);
  const sheetLabel = mode === "main" ? "Official Main Sheet" : "Reference Salary Sheet";
  const fileStem = `${companyName || "Company"} ${sheetLabel} ${monthLabel}`;
  return {
    blocked: [],
    download:
      format === "csv"
        ? { content: serializeCsv(rows), fileName: `${fileStem}.csv`, type: "text/csv;charset=utf-8;" }
        : {
            content: serializeXlsx(rows, sheetLabel),
            fileName: `${fileStem}.xlsx`,
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          },
  };
}

export function downloadBlob(download: ExportDownload): void {
  const blob = new Blob([download.content], { type: download.type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = download.fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
