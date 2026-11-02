import { describe, expect, it } from "vitest";
import { calculateProfessionalTax, calculateSalary } from "../salary";
import type { EmployeeInput } from "../types";

describe("West Bengal P-Tax slab by salary month (ADR-0019)", () => {
  it("October 2026 onward uses notification 1407-F.T. at every band edge", () => {
    const cases: Array<[number, number]> = [
      [0, 0], [20000, 0], [20000.01, 100], [30000, 100], [30000.01, 140],
      [50000, 140], [50000.01, 170], [100000, 170], [100000.01, 208],
    ];
    for (const [wages, tax] of cases) {
      expect(calculateProfessionalTax(wages, "October 2026"), `${wages}`).toBe(tax);
      expect(calculateProfessionalTax(wages, "March 2027"), `${wages}`).toBe(tax);
    }
  });

  it("September 2026 and earlier keep the slab they were paid on", () => {
    const cases: Array<[number, number]> = [
      [10000, 0], [10000.01, 110], [15000, 110], [15000.01, 130], [25000, 130],
      [25000.01, 150], [40000, 150], [40000.01, 200], [150000, 200],
    ];
    for (const [wages, tax] of cases) {
      expect(calculateProfessionalTax(wages, "September 2026"), `${wages}`).toBe(tax);
      expect(calculateProfessionalTax(wages, "June 2025"), `${wages}`).toBe(tax);
    }
  });

  it("a missing or unreadable month gets the slab in force now", () => {
    expect(calculateProfessionalTax(12000)).toBe(0);
    expect(calculateProfessionalTax(12000, "")).toBe(0);
    expect(calculateProfessionalTax(45000, "not a month")).toBe(140);
  });

  it("the same employee pays less in October than in September; TDS payers still pay none", () => {
    const base: EmployeeInput = {
      id: "pt",
      name: "Clerk",
      category: "Skilled",
      monthlySalary: 18000,
      daysWorked: 30,
      extraDays: 0,
      basicPercent: 70,
      pfOptIn: false,
      esiOptIn: false,
      otherDeduction: 0,
    };
    const sep = calculateSalary(base, { workingDays: 30, monthLabel: "September 2026" });
    const oct = calculateSalary(base, { workingDays: 30, monthLabel: "October 2026" });
    expect(sep.professionalTax).toBe(130);
    expect(oct.professionalTax).toBe(0);
    expect(oct.netPayable - sep.netPayable).toBeCloseTo(130, 2);

    const tds = calculateSalary({ ...base, monthlySalary: 120000, otherDeduction: 5000 }, {
      workingDays: 30,
      monthLabel: "October 2026",
    });
    expect(tds.professionalTax).toBe(0);
  });
});
