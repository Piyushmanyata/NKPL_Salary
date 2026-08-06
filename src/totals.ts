import { ESI_EMPLOYER_RATE, numberValue, roundMoney } from "./salary";
import type { OfficialRow } from "./officialSheet";
import type { SalaryRow } from "./types";

export type SheetMode = "reference" | "main";

export type MonthTotals = {
  employees: number;
  unpackableCount: number;
  gross: number;
  net: number;
  pf: number;
  employerPf: number;
  employerEsi: number;
  esi: number;
  professionalTax: number;
  deductions: number;
  cost: number;
};

const sum = <T extends Record<string, unknown>>(rows: T[], key: keyof T): number =>
  rows.reduce((total, row) => total + numberValue(row[key]), 0);

export function calculateMonthTotals(
  sheetMode: SheetMode,
  salaryRows: SalaryRow[],
  officialRows: OfficialRow[],
): MonthTotals {
  if (sheetMode === "main") {
    const packable = officialRows.filter((row) => !row.unpackable);
    const unpackableCount = officialRows.length - packable.length;
    const gross = packable.reduce((total, row) => total + row.grossPayable, 0);
    const net = packable.reduce((total, row) => total + row.netPayable, 0);
    const pf = packable.reduce((total, row) => total + row.pf, 0);
    const employerPf = pf;
    const esi = packable.reduce((total, row) => total + row.esi, 0);
    const professionalTax = packable.reduce((total, row) => total + row.professionalTax, 0);
    const employerEsi = packable.reduce(
      (total, row) => total + (row.esi > 0 ? roundMoney(row.monthlyBasic * ESI_EMPLOYER_RATE) : 0),
      0,
    );
    const deductions =
      pf +
      esi +
      professionalTax +
      packable.reduce((total, row) => total + (row.advance || 0) + row.otherDeduction, 0);
    return {
      employees: officialRows.length,
      unpackableCount,
      gross,
      net,
      pf,
      employerPf,
      employerEsi,
      esi,
      professionalTax,
      deductions,
      cost: gross + employerPf + employerEsi,
    };
  }

  const gross = sum(salaryRows, "grossPayable");
  const net = sum(salaryRows, "netPayable");
  const pf = sum(salaryRows, "employeePf");
  const employerPf = sum(salaryRows, "employerPf");
  const employerEsi = sum(salaryRows, "employerEsi");
  const esi = sum(salaryRows, "esi");
  const professionalTax = sum(salaryRows, "professionalTax");
  const deductions =
    pf +
    esi +
    professionalTax +
    sum(salaryRows, "advance") +
    sum(salaryRows, "otherDeduction");
  return {
    employees: salaryRows.length,
    unpackableCount: 0,
    gross,
    net,
    pf,
    employerPf,
    employerEsi,
    esi,
    professionalTax,
    deductions,
    cost: sum(salaryRows, "totalCost"),
  };
}

export function calculateCategoryTotals(
  salaryRows: SalaryRow[],
): Array<{ category: string; total: number }> {
  const grouped = salaryRows.reduce<Record<string, number>>((acc, row) => {
    const category = row.category.trim() || "Staff";
    acc[category] = (acc[category] || 0) + row.netPayable;
    return acc;
  }, {});

  return Object.entries(grouped)
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);
}
