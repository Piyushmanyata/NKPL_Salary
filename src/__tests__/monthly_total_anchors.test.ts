import { describe, expect, it } from "vitest";
import { calculateSalary } from "../salary";
import { buildOfficialRow, officialBasic, wageBoardCategory } from "../officialSheet";
import type { Category, EmployeeInput } from "../types";

/**
 * M and T are the typed anchors for Semi-skilled / Skilled / Special; `r` and `b`
 * are derived from them. Unskilled is unchanged: `r` and `b` are typed, T derived.
 */
const base = (category: Category, over: Partial<EmployeeInput> = {}): EmployeeInput => ({
  id: "e1",
  name: "Test",
  category,
  isSecurity: false,
  monthlySalary: 30000,
  salaryPerDay: 0,
  bonusPerDay: 0,
  daysWorked: 30,
  extraDays: 0,
  basicPercent: 50,
  pfOptIn: false,
  esiOptIn: false,
  otherDeduction: 0,
  ...over,
});

const fixedMonthly: Category[] = ["Semi-skilled", "Skilled", "Special"];

describe("M + T as typed anchors", () => {
  it.each(fixedMonthly)("%s: a stored total is used verbatim, not re-derived", (category) => {
    const row = calculateSalary(base(category, { totalSalary: 45000 }), { workingDays: 30 });
    expect(row.monthlySalary).toBe(30000);
    expect(row.totalSalary).toBe(45000);
  });

  it.each(fixedMonthly)("%s: stored total is invariant to month length", (category) => {
    const input = base(category, { totalSalary: 45000 });
    for (const workingDays of [28, 30, 31]) {
      const row = calculateSalary(input, { workingDays });
      expect(row.monthlySalary).toBe(30000);
      expect(row.totalSalary).toBe(45000);
    }
  });

  it("Semi-skilled/Skilled: bonus per day is derived as (T - M) / D", () => {
    for (const category of ["Semi-skilled", "Skilled"] as Category[]) {
      const row = calculateSalary(base(category, { totalSalary: 45000 }), { workingDays: 30 });
      expect(row.bonusPerDay).toBe(500); // (45000 - 30000) / 30
      expect(row.salaryPerDay).toBe(1000); // M / D, unchanged rule
    }
  });

  it("Special keeps b = 0 while still honouring a total above M (SPEC §2.2)", () => {
    const row = calculateSalary(base("Special", { totalSalary: 45000 }), { workingDays: 30 });
    expect(row.bonusPerDay).toBe(0);
    expect(row.salaryPerDay).toBe(0);
    expect(row.dailyBonus).toBe(0);
    expect(row.totalSalary).toBe(45000);
    // Reference gross is M-only for Special — the total moves Official, not Reference.
    expect(row.grossPayable).toBe(30000);
  });

  it("Special: the total drives the Official 51% basic floor", () => {
    const withTotal = calculateSalary(base("Special", { totalSalary: 60000 }), { workingDays: 30 });
    const withoutTotal = calculateSalary(base("Special"), { workingDays: 30 });
    const at26 = (r: typeof withTotal) => officialBasic(r, wageBoardCategory("Special"), 26);

    // PF is always off for Special, so basic = max(21100, 0.51 × T) — T is the only lever.
    expect(at26(withTotal)).toBe(Math.round(60000 * 0.51));
    expect(at26(withoutTotal)).toBe(21100); // 0.51 × 30000 = 15300 < floor
    expect(at26(withTotal)).toBeGreaterThan(at26(withoutTotal));
  });

  it("a total at or below M means no bonus, exactly as before", () => {
    const row = calculateSalary(base("Skilled", { totalSalary: 30000 }), { workingDays: 30 });
    expect(row.totalSalary).toBe(30000);
    expect(row.bonusPerDay).toBe(0);
  });

  it("Unskilled ignores a stored total — r and b stay the anchors", () => {
    const input = base("Unskilled", {
      monthlySalary: 0,
      salaryPerDay: 400,
      bonusPerDay: 100,
      totalSalary: 99999,
    });
    const row = calculateSalary(input, { workingDays: 30 });
    expect(row.monthlySalary).toBe(12000); // D × r
    expect(row.totalSalary).toBe(15000); // M + D × b — the stored total is not used
  });

  it("legacy rows without a stored total compute exactly as before", () => {
    for (const category of [...fixedMonthly, "Unskilled"] as Category[]) {
      const legacy = base(category, { salaryPerDay: 400, bonusPerDay: 165 });
      const withUndefined = { ...legacy, totalSalary: undefined };
      expect(calculateSalary(withUndefined, { workingDays: 30 })).toEqual(
        calculateSalary(legacy, { workingDays: 30 }),
      );
    }
  });

  it("net equality still holds on the Official sheet with a stored total", () => {
    for (const category of fixedMonthly) {
      const row = calculateSalary(base(category, { totalSalary: 45000 }), { workingDays: 30 });
      const official = buildOfficialRow(row, 30);
      expect(official.unpackable).toBe(false);
      expect(official.netPayable).toBeCloseTo(row.netPayable, 2);
    }
  });
});
