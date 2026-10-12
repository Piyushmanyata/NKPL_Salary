import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { createExportDownload } from "../exportActions";
import { serializeXlsx } from "../exportSheet";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function unzipText(bytes: Uint8Array, path: string): string {
  const workbook = XLSX.read(bytes, { type: "array", bookFiles: true }) as XLSX.WorkBook & {
    files: Record<string, { content: Uint8Array }>;
  };
  return new TextDecoder().decode(workbook.files[path]!.content);
}

describe("xlsx export", () => {
  it("downloads a real .xlsx workbook, not HTML renamed to .xls", () => {
    const result = createExportDownload({
      mode: "reference",
      companyName: "NKPL",
      monthLabel: "May 2026",
      salaryRows: [],
      officialRows: [],
      format: "workbook",
    });
    if (!("download" in result)) throw new Error("export blocked");
    const { content, fileName, type } = result.download;

    expect(fileName).toBe("NKPL Reference Salary Sheet May 2026.xlsx");
    expect(type).toBe(XLSX_MIME);
    expect(content).toBeInstanceOf(Uint8Array);
    expect(Array.from((content as Uint8Array).slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("round-trips typed cells through a spreadsheet reader", () => {
    const bytes = serializeXlsx(
      [
        { "Sl No": 1, "Employee Name": "Ravi & <Sons>", Advance: -750, Note: "" },
        { "Sl No": 2, "Employee Name": "Asha\u0007", Advance: 12584.5, Note: "x" },
      ],
      "Official Main Sheet",
    );
    const workbook = XLSX.read(bytes, { type: "array" });

    expect(workbook.SheetNames).toEqual(["Official Main Sheet"]);
    const sheet = workbook.Sheets["Official Main Sheet"]!;
    expect(sheet["!ref"]).toBe("A1:D3");
    expect(sheet.A1).toMatchObject({ t: "s", v: "Sl No" });
    expect(sheet.B2).toMatchObject({ t: "s", v: "Ravi & <Sons>" });
    expect(sheet.C2).toMatchObject({ t: "n", v: -750 });
    expect(sheet.C3).toMatchObject({ t: "n", v: 12584.5 });
    expect(sheet.B3).toMatchObject({ t: "s", v: "Asha" });
    expect(sheet.AA1).toBeUndefined();
  });

  it("rules every cell and bolds the header (ADR-0014)", () => {
    const bytes = serializeXlsx([{ "Sl No": 1, Advance: "" }], "Sheet");
    const styles = unzipText(bytes, "xl/styles.xml");
    const sheet = unzipText(bytes, "xl/worksheets/sheet1.xml");

    expect(styles).toContain('<left style="thin">');
    expect(styles).toContain("<b/>");
    expect(sheet).toContain('<c r="A1" s="2"');
    expect(sheet).toContain('<c r="A2" s="1"');
    expect(sheet).toContain('<c r="B2" s="1"/>');
  });

  it("names columns past Z", () => {
    const row = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`H${i}`, i]));
    const sheet = XLSX.read(serializeXlsx([row], "Sheet"), { type: "array" }).Sheets.Sheet!;
    expect(sheet["!ref"]).toBe("A1:AD2");
    expect(sheet.AD2).toMatchObject({ t: "n", v: 29 });
  });
});
