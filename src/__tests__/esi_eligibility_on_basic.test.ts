import { describe, expect, it } from "vitest";
import { ESI_GROSS_LIMIT, calculateSalary, clampBasicPercent } from "../salary";
import { buildOfficialRow } from "../officialSheet";
import type { EmployeeInput } from "../types";

/**
 * ADR-0011 — ESI eligibility is tested on Basic on BOTH sheets. The Reference
 * sheet used to test the package (Total Salary <= 21,000) while Official tested
 * the basic, so the two could disagree about the same employee.
 */

const employee = (over: Partial<EmployeeInput>): EmployeeInput => ({
  id: "esi",
  name: "ESI Row",
  category: "Skilled",
  monthlySalary: 20000,
  daysWorked: 30,
  extraDays: 0,
  basicPercent: 70,
  pfOptIn: true,
  esiOptIn: true,
  otherDeduction: 0,
  ...over,
});

const compute = (input: EmployeeInput, workingDays = 30) =>
  calculateSalary(input, {
    workingDays,
    basicShare: clampBasicPercent(input.basicPercent) / 100,
  });

describe("ADR-0011: ESI eligibility on Basic", () => {
  it("turns ESI off exactly at the standing-basic threshold", () => {
    // basic% 70 ⇒ the cutoff sits at M = 21,000 / 0.7 = 30,000.
    expect(compute(employee({ monthlySalary: 30000 })).esiOptIn).toBe(true);
    expect(compute(employee({ monthlySalary: 30001 })).esiOptIn).toBe(false);
  });

  it("uses the standing basic, so attendance never flips eligibility", () => {
    for (const daysWorked of [1, 7, 15, 29, 30]) {
      const row = compute(employee({ monthlySalary: 40000, daysWorked }));
      expect(row.esiOptIn, `${daysWorked} days`).toBe(false);
      const eligible = compute(employee({ monthlySalary: 20000, daysWorked }));
      expect(eligible.esiOptIn, `${daysWorked} days`).toBe(true);
    }
  });

  it("agrees with the Official sheet on a package above the limit whose basic is below it", () => {
    const row = compute(employee({ monthlySalary: 21000, totalSalary: 25000 }));
    expect(row.totalSalary).toBeGreaterThan(ESI_GROSS_LIMIT);
    expect(row.esiOptIn).toBe(true);
    // Official charges ESI on the same row rather than exempting it.
    expect(buildOfficialRow(row, 30).esi).toBeGreaterThan(0);
  });

  it("keeps ESI off for Special and for an explicit opt-out", () => {
    expect(compute(employee({ category: "Special" })).esiOptIn).toBe(false);
    expect(compute(employee({ esiOptIn: false })).esiOptIn).toBe(false);
    expect(compute(employee({ esiOptIn: false })).esi).toBe(0);
  });

  it("moves the basic cutoff with Basic %, since the basic itself moves", () => {
    // At 51% basic a 40,000 package keeps a basic of 20,400 — still eligible.
    expect(compute(employee({ monthlySalary: 40000, basicPercent: 51 })).esiOptIn).toBe(true);
    expect(compute(employee({ monthlySalary: 40000, basicPercent: 70 })).esiOptIn).toBe(false);
  });
});
