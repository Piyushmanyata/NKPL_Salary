import { numberValue } from "./salary";
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
    // Reconciliation summary excludes unpackable rows (TICKET-09); sheet still lists them.
    const packable = officialRows.filter((row) => !row.unpackable);
    const gross = sum(packable, "grossPayable");
    const pf = sum(packable, "pf");
    // Employer PF mirrors employee PF in this model (both 12% of basic, capped
    // at PF_BASIC_LIMIT) -- see calculateSalary. Reusing `pf` here (instead of
    // recomputing from monthlyBasic without the cap) keeps this in sync with
    // that formula and avoids overstating employer cost for high-basic rows.
    const employerPf = pf;
    const esi = sum(packable, "esi");
    const employerEsi = sum(packable, "employerEsi");
    const professionalTax = sum(packable, "professionalTax");
    const deductions =
      pf + esi + professionalTax + sum(packable, "advance") + sum(packable, "otherDeduction");
    return {
      employees: officialRows.length,
      unpackableCount: officialRows.length - packable.length,
      gross,
      net: sum(packable, "netPayable"),
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
