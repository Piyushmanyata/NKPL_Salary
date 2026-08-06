import { describe, expect, it } from "vitest";
import { applyEmployeeEdit } from "../editEmployee";
import type { EmployeeInput } from "../types";

const D = 30;

const base = (overrides: Partial<EmployeeInput> = {}): EmployeeInput => ({
  id: "e1",
  name: "Ada",
  category: "Skilled",
  monthlySalary: 15000,
  totalSalary: 18000,
  salaryPerDay: 500,
  bonusPerDay: 100,
  daysWorked: 28,
  extraDays: 2,
  basicPercent: 70,
  pfOptIn: true,
  esiOptIn: true,
  otherDeduction: 0,
  ...overrides,
});

describe("applyEmployeeEdit", () => {
  it("edits name; Special also forces full days and PF/ESI off", () => {
    const normal = applyEmployeeEdit(base(), "name", "Bob", D);
    expect(normal.name).toBe("Bob");
    expect(normal.daysWorked).toBe(28);

    const special = applyEmployeeEdit(base({ category: "Special", daysWorked: 10 }), "name", "X", D);
    expect(special.name).toBe("X");
    expect(special.daysWorked).toBe(D);
    expect(special.pfOptIn).toBe(false);
    expect(special.esiOptIn).toBe(false);
  });

  it("stores notes trimmed or clears empty", () => {
    expect(applyEmployeeEdit(base(), "notes", "  hi  ", D).notes).toBe("  hi  ");
    expect(applyEmployeeEdit(base({ notes: "x" }), "notes", "   ", D).notes).toBeUndefined();
  });

  it("category → Special zeros rates, full days, PF/ESI off", () => {
    const next = applyEmployeeEdit(base(), "category", "Special", D);
    expect(next.category).toBe("Special");
    expect(next.salaryPerDay).toBe(0);
    expect(next.bonusPerDay).toBe(0);
    expect(next.extraDays).toBe(0);
    expect(next.daysWorked).toBe(D);
    expect(next.pfOptIn).toBe(false);
    expect(next.esiOptIn).toBe(false);
  });

  it("category other values normalize", () => {
    expect(applyEmployeeEdit(base(), "category", "Unskilled", D).category).toBe("Unskilled");
  });

  it("Special blocks PF/ESI toggles", () => {
    const emp = base({ category: "Special", pfOptIn: false, esiOptIn: false });
    const next = applyEmployeeEdit(emp, "pfOptIn", true, D);
    expect(next.pfOptIn).toBe(false);
    expect(next.esiOptIn).toBe(false);
  });

  it("esiOverLimitOptIn is true-only and couples esiOptIn", () => {
    const on = applyEmployeeEdit(base({ esiOptIn: false }), "esiOverLimitOptIn", true, D);
    expect(on.esiOverLimitOptIn).toBe(true);
    expect(on.esiOptIn).toBe(true);
    const off = applyEmployeeEdit(on, "esiOverLimitOptIn", false, D);
    expect(off.esiOverLimitOptIn).toBeUndefined();
    expect(off.esiOptIn).toBe(false);
  });

  it("monthlySalary for Skilled holds allowance in T", () => {
    // old M=15000 T=18000 → bonus/day = 100; new M=16000 → T = 16000 + 30*100
    const next = applyEmployeeEdit(base(), "monthlySalary", 16000, D);
    expect(next.monthlySalary).toBe(16000);
    expect(next.totalSalary).toBe(16000 + D * 100);
  });

  it("allowance for Skilled sets T = M + allowance", () => {
    const next = applyEmployeeEdit(base(), "allowance", 2000, D);
    expect(next.monthlySalary).toBe(15000);
    expect(next.totalSalary).toBe(17000);
  });

  it("Unskilled monthlySalary anchors r = M/D full precision", () => {
    const next = applyEmployeeEdit(base({ category: "Unskilled", totalSalary: undefined }), "monthlySalary", 12000, D);
    expect(next.monthlySalary).toBe(12000);
    expect(next.salaryPerDay).toBe(12000 / D);
  });

  it("Unskilled allowance sets b = allowance/D", () => {
    const next = applyEmployeeEdit(
      base({ category: "Unskilled", totalSalary: undefined, bonusPerDay: 0 }),
      "allowance",
      3000,
      D,
    );
    expect(next.bonusPerDay).toBe(3000 / D);
  });

  it("salaryPerDay for fixed-monthly sets M = D×r and keeps allowance", () => {
    // old M=15000 T=18000 allowance=3000; r=600 → M=18000 T=21000
    const next = applyEmployeeEdit(base(), "salaryPerDay", 600, D);
    expect(next.salaryPerDay).toBe(600);
    expect(next.monthlySalary).toBe(18000);
    expect(next.totalSalary).toBe(21000);
  });

  it("salaryPerDay for Unskilled only updates r", () => {
    const next = applyEmployeeEdit(
      base({ category: "Unskilled", totalSalary: undefined, monthlySalary: 0 }),
      "salaryPerDay",
      400,
      D,
    );
    expect(next.salaryPerDay).toBe(400);
    expect(next.monthlySalary).toBe(0);
  });

  it("basicPercent clamps", () => {
    expect(applyEmployeeEdit(base(), "basicPercent", 40, D).basicPercent).toBe(50);
    expect(applyEmployeeEdit(base(), "basicPercent", 120, D).basicPercent).toBe(100);
  });

  it("advance rejects negatives and zeros; stores positive", () => {
    expect(applyEmployeeEdit(base(), "advance", -50, D).advance).toBeUndefined();
    expect(applyEmployeeEdit(base(), "advance", 0, D).advance).toBeUndefined();
    expect(applyEmployeeEdit(base(), "advance", 500, D).advance).toBe(500);
  });

  it("specialBonus accepts number or clears", () => {
    expect(applyEmployeeEdit(base(), "specialBonus", 100, D).specialBonus).toBe(100);
    expect(applyEmployeeEdit(base(), "specialBonus", "", D).specialBonus).toBeUndefined();
  });

  it("throws on unknown field instead of numeric fallthrough", () => {
    expect(() =>
      applyEmployeeEdit(base(), "id" as "name", "x", D),
    ).toThrow(/Unknown employee field/);
  });
});
