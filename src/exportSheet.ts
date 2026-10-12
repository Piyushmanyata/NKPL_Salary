import { roundMoney } from "./salary";
import type { OfficialRow } from "./officialSheet";
import type { SalaryRow } from "./types";
import { zipStored } from "./zip";

export const csvEscape = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;

export const htmlEscape = (value: string | number) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Neutralize CSV formula injection: a free-text cell starting with =, +, -,
// or @ would otherwise execute as a formula when the CSV is opened. Prefixing
// with an apostrophe forces text. The .xlsx needs no guard: it writes text as
// inline strings, which are never evaluated.
export const sanitizeSpreadsheetCell = (value: string) =>
  /^[=+\-@]/.test(value) ? `'${value}` : value;

export type ExportRow = Record<string, string | number>;

export function buildReferenceExportRows(rows: SalaryRow[]): ExportRow[] {
  return rows.map((row, index) => ({
    "Sl No": index + 1,
    "Employee Name": row.name,
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
    "Employee Name": row.name,
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
    ...exportRows.map((row) =>
      headers
        .map((header) => {
          const value = row[header] ?? "";
          return csvEscape(typeof value === "string" ? sanitizeSpreadsheetCell(value) : value);
        })
        .join(","),
    ),
  ].join("\n");
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const SHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const STYLE_RULED = 1;
const STYLE_HEADER = 2;

const xmlText = (value: string) =>
  htmlEscape(value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, ""));

const columnName = (index: number): string =>
  (index >= 26 ? columnName(Math.floor(index / 26) - 1) : "") + String.fromCharCode(65 + (index % 26));

function xlsxCell(ref: string, value: string | number, style: number): string {
  if (value === "") return `<c r="${ref}" s="${style}"/>`;
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  }
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlText(String(value))}</t></is></c>`;
}

const RULE = '<color rgb="FF000000"/>';
const STYLES_XML = `${XML_HEAD}<styleSheet xmlns="${SHEET_NS}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin">${RULE}</left><right style="thin">${RULE}</right><top style="thin">${RULE}</top><bottom style="thin">${RULE}</bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

export function serializeXlsx(exportRows: ExportRow[], sheetName: string): Uint8Array<ArrayBuffer> {
  const headers = Object.keys(exportRows[0] ?? { "Employee Name": "" });
  const widths = headers.map((header) =>
    Math.min(50, Math.max(...[header, ...exportRows.map((row) => row[header] ?? "")].map((v) => String(v).length)) + 2),
  );
  const cols = widths
    .map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`)
    .join("");
  const headerRow = `<row r="1">${headers
    .map((header, i) => xlsxCell(`${columnName(i)}1`, header, STYLE_HEADER))
    .join("")}</row>`;
  const bodyRows = exportRows
    .map(
      (row, r) =>
        `<row r="${r + 2}">${headers
          .map((header, i) => xlsxCell(`${columnName(i)}${r + 2}`, row[header] ?? "", STYLE_RULED))
          .join("")}</row>`,
    )
    .join("");

  return zipStored({
    "[Content_Types].xml": `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    "_rels/.rels": `${XML_HEAD}<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `${XML_HEAD}<workbook xmlns="${SHEET_NS}" xmlns:r="${REL_NS}"><sheets><sheet name="${xmlText(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `${XML_HEAD}<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": STYLES_XML,
    "xl/worksheets/sheet1.xml": `${XML_HEAD}<worksheet xmlns="${SHEET_NS}"><cols>${cols}</cols><sheetData>${headerRow}${bodyRows}</sheetData></worksheet>`,
  });
}
