import { describe, expect, it } from "vitest";
import { createExportDownload } from "../exportActions";
import { buildOfficialRow } from "../officialSheet";
import { calculateSalary } from "../salary";
import { sortRows } from "../sortRows";
import { calculateCategoryTotals, calculateMonthTotals } from "../totals";
import type { OfficialRow } from "../officialSheet";

const employee = {
  id: "e1",
  name: "Asha",
  category: "Unskilled" as const,
  monthlySalary: 0,
  salaryPerDay: 400,
  bonusPerDay: 0,
  daysWorked: 26,
  extraDays: 0,
  basicPercent: 50,
  pfOptIn: true,
  esiOptIn: true,
  otherDeduction: 0,
};

describe("App pure seams", () => {
  it("keeps a newly added row first while sorting the remaining rows", () => {
    const rows = [
      { id: "a", name: "Zed" },
      { id: "new", name: "Asha" },
      { id: "b", name: "Mina" },
    ];

    expect(sortRows(rows, "name", "asc", "new").map((row) => row.id)).toEqual([
      "new",
      "b",
      "a",
    ]);
  });

  it("preserves the reference and official total seams", () => {
    const salaryRow = calculateSalary(employee, { basicShare: 0.5, workingDays: 26 });
    const officialRow = buildOfficialRow(salaryRow, 26);

    expect(calculateMonthTotals("reference", [salaryRow], [officialRow]).employees).toBe(1);
    expect(calculateMonthTotals("main", [salaryRow], [officialRow]).employees).toBe(1);
    expect(calculateCategoryTotals([salaryRow])).toEqual([
      { category: "Unskilled", total: salaryRow.netPayable },
    ]);
  });

  it("blocks unpackable main exports and builds reference downloads", () => {
    const blockedRow = { id: "e1", name: "Asha", unpackable: true } as OfficialRow;
    const blocked = createExportDownload({
      mode: "main",
      companyName: "NKPL",
      monthLabel: "May 2026",
      salaryRows: [],
      officialRows: [blockedRow],
      format: "csv",
    });
    expect(blocked).toEqual({ blocked: ["Asha"] });

    const download = createExportDownload({
      mode: "reference",
      companyName: "NKPL",
      monthLabel: "May 2026",
      salaryRows: [],
      officialRows: [],
      format: "csv",
    });
    expect("download" in download && download.download.fileName).toBe(
      "NKPL Reference Salary Sheet May 2026.csv",
    );
  });
});
