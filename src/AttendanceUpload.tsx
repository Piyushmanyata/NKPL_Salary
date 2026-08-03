import { useRef, type ChangeEvent } from "react";
import {
  detectFormat,
  formatKind,
  getBestWorksheet,
  parseAttendanceExcel,
  type AttendanceFormat,
} from "./attendance";
import type { AttendanceEmployee, EmployeeInput } from "./types";

export type AttendanceSlot = "biometric" | "manual";

type Props = {
  monthLabel: string;
  employees: EmployeeInput[];
  loadXLSX: () => Promise<any>;
  onParsed: (args: {
    slot: AttendanceSlot;
    format: AttendanceFormat;
    employees: AttendanceEmployee[];
    monthLabel: string;
    sheetName: string;
  }) => void;
  onError: (message: string) => void;
  /** When true, caller must confirm before overwrite (A10). */
  hasSavedAttendance?: boolean;
  onConfirmOverwrite?: () => boolean;
};

export function AttendanceUpload({
  monthLabel,
  employees,
  loadXLSX,
  onParsed,
  onError,
  hasSavedAttendance,
  onConfirmOverwrite,
}: Props) {
  const bioRef = useRef<HTMLInputElement>(null);
  const manRef = useRef<HTMLInputElement>(null);

  const handleFile = async (slot: AttendanceSlot, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (hasSavedAttendance && onConfirmOverwrite && !onConfirmOverwrite()) {
        return;
      }
      const buffer = await file.arrayBuffer();
      const XLSX = await loadXLSX();
      const workbook = XLSX.read(buffer, { type: "array" });
      const { sheet: worksheet, sheetName } = getBestWorksheet(workbook, monthLabel);
      const rows = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        defval: null,
        raw: true,
      }) as any[][];
      const format = detectFormat(rows);
      const kind = formatKind(format);
      if (kind !== slot) {
        onError(
          `Wrong slot: file looks like "${format}" (${kind}) but you used the ${slot} upload.`
        );
        return;
      }
      const parsed = parseAttendanceExcel(rows, employees);
      onParsed({
        slot,
        format,
        employees: parsed.employees,
        monthLabel: parsed.monthLabel,
        sheetName,
      });
    } catch (err: any) {
      console.error(err);
      onError(err?.message || "Error parsing the Excel file.");
    } finally {
      event.target.value = "";
    }
  };

  return (
    <div className="attendance-dual-upload" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <label className="btn ghost" style={{ cursor: "pointer", fontSize: 12 }}>
        Biometric Export
        <input
          ref={bioRef}
          type="file"
          accept=".xlsx,.xls"
          hidden
          onChange={(e) => handleFile("biometric", e)}
        />
      </label>
      <label className="btn ghost" style={{ cursor: "pointer", fontSize: 12 }}>
        Manual Sheet
        <input
          ref={manRef}
          type="file"
          accept=".xlsx,.xls"
          hidden
          onChange={(e) => handleFile("manual", e)}
        />
      </label>
    </div>
  );
}
