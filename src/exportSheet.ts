import { roundMoney } from "./salary";
import type { OfficialRow } from "./officialSheet";
import type { SalaryRow } from "./types";

export const csvEscape = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;

export const htmlEscape = (value: string | number) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Neutralize spreadsheet formula injection: a free-text name starting with
// =, +, -, or @ would otherwise execute as a formula when the exported
// CSV/Excel file is opened. Prefixing with an apostrophe forces text.
export const sanitizeSpreadsheetCell = (value: string) =>
  /^[=+\-@]/.test(value) ? `'${value}` : value;

export type ExportRow = Record<string, string | number>;

export function buildReferenceExportRows(rows: SalaryRow[]): ExportRow[] {
  return rows.map((row, index) => ({
    "Sl No": index + 1,
    "Employee Name": sanitizeSpreadsheetCell(row.name),
    Category: row.category,
    "Basic Percent": row.basicPercent,
    "Salary Per Day": roundMoney(row.salaryPerDay),
    "Bonus Per Day": roundMoney(row.bonusPerDay),
    "Salary Per Month": roundMoney(row.monthlySalary),
    "Total Salary": roundMoney(row.totalSalary),
    "Days Worked": row.daysWorked,
    "Extra Days": row.extraDays,
    "Absent Days": row.absentDays,
    "PF Opt In": row.pfOptIn ? "Yes" : "No",
    "ESI Opt In": row.esiOptIn ? "Yes" : "No",
    "Absent Deduction": roundMoney(row.absentDeduction),
    "Earned Salary": roundMoney(row.earnedSalary),
    "Basic Salary": roundMoney(row.basicSalary),
    HRA: roundMoney(row.hra),
    "Travel Allowance": roundMoney(row.travelAllowance),
    "Performance Bonus": roundMoney(row.performanceBonus),
    "Special Bonus": roundMoney(row.specialBonus),
    "Daily Bonus Amount": roundMoney(row.dailyBonus),
    "Employee PF Deduction": roundMoney(row.employeePf),
    "Employer PF Contribution": roundMoney(row.employerPf),
    "ESI Deduction": roundMoney(row.esi),
    "Employer ESI Contribution": roundMoney(row.employerEsi),
    "P-Tax": roundMoney(row.professionalTax),
    Advance: row.advance !== undefined && row.advance !== null ? -roundMoney(row.advance) : "",
    "Other Deduction": roundMoney(row.otherDeduction),
    "Net Payable": roundMoney(row.netPayable),
    "Employer Total Cost": roundMoney(row.totalCost),
  }));
}

export function buildOfficialExportRows(rows: OfficialRow[]): ExportRow[] {
  return rows.map((row, index) => ({
    "Sl No": index + 1,
    "Employee Name": sanitizeSpreadsheetCell(row.name),
    "Wage Category": row.wageCategory,
    "Employee Types": row.employeeTypes,
    "Allowed Basic": roundMoney(row.allowedBasic),
    "Official Basic": roundMoney(row.monthlyBasic),
    HRA: roundMoney(row.monthlyHra),
    "Travel Allowance": roundMoney(row.monthlyTravelAllowance),
    Attendance: row.attendance,
    "Extra Days": row.extraDays,
    Bonus: roundMoney(row.bonus),
    PF: roundMoney(row.pf),
    ESI: roundMoney(row.esi),
    "P-Tax": roundMoney(row.professionalTax),
    Advance: row.advance !== undefined && row.advance !== null ? -roundMoney(row.advance) : "",
    "Other Deduction": roundMoney(row.otherDeduction),
    "Net Payable": roundMoney(row.netPayable),
  }));
}

export function serializeCsv(exportRows: ExportRow[]): string {
  const headers = Object.keys(exportRows[0] ?? { "Employee Name": "" });
  return [
    headers.map(csvEscape).join(","),
    ...exportRows.map((row) => headers.map((header) => csvEscape(row[header] ?? "")).join(",")),
  ].join("\n");
}

export function serializeSpreadsheetHtml(exportRows: ExportRow[]): string {
  const headers = Object.keys(exportRows[0] ?? { "Employee Name": "" });
  // Excel drops a <style> block on import but honours the border attribute and
  // inline cell styles, so every cell carries its own rule (ADR-0014).
  const cellStyle = "border:1px solid #000000;padding:4px";
  const headStyle = `${cellStyle};font-weight:bold;background:#f2f2f2`;
  const body = exportRows
    .map(
      (row) =>
        `<tr>${headers
          .map((header) => `<td style="${cellStyle}">${htmlEscape(row[header] ?? "")}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8" /></head><body><table border="1" style="border-collapse:collapse"><thead><tr>${headers
    .map((header) => `<th style="${headStyle}">${htmlEscape(header)}</th>`)
    .join("")}</tr></thead><tbody>${body}</tbody></table></body></html>`;
}
