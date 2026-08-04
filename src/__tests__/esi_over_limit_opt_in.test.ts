import { describe, expect, it } from "vitest";
import { ESI_GROSS_LIMIT, PF_BASIC_LIMIT, calculateSalary, clampBasicPercent } from "../salary";
import { buildOfficialRow, officialBasic } from "../officialSheet";
import type { EmployeeInput } from "../types";

/**
 * ADR-0011 (docs/adr/0011-esi-over-limit-opt-in.md)
 * Above a ₹21,000 package ESI is off by default but no longer
 * forced off. Turning the single ESI toggle on marks the row and the charge
 * applies; the Official sheet then holds the basic inside (15,000, 21,000] so
 * the ESI actually lands instead of being cancelled by its own basic ceiling.
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

describe("ADR-0011: ESI above the package limit is opt-in", () => {
  it("stays on by default at or below a 21,000 package", () => {
    expect(compute(employee({ monthlySalary: 21000 })).esiOptIn).toBe(true);
    expect(compute(employee({ monthlySalary: 21000 })).esi).toBeGreaterThan(0);
  });

  it("is off by default above a 21,000 package", () => {
    const row = compute(employee({ monthlySalary: 21000, totalSalary: 21001 }));
    expect(row.esiOptIn).toBe(false);
    expect(row.esi).toBe(0);
    expect(row.employerEsi).toBe(0);
  });

  it("cannot be switched on by the default esiOptIn of an untouched row", () => {
    // Every row loaded from storage carries esiOptIn true unless someone turned
    // it off, so that flag alone must never count as consent here.
    expect(compute(employee({ monthlySalary: 40000, esiOptIn: true })).esiOptIn).toBe(false);
    expect(compute(employee({ monthlySalary: 40000, esiOptIn: undefined })).esiOptIn).toBe(false);
  });

  it("applies once enabled by hand, at any package size", () => {
    for (const monthlySalary of [22000, 40000, 90000]) {
      const row = compute(employee({ monthlySalary, esiOverLimitOptIn: true }));
      expect(row.esiOptIn, `${monthlySalary}`).toBe(true);
      expect(row.esi, `${monthlySalary}`).toBeGreaterThan(0);
      expect(row.employerEsi, `${monthlySalary}`).toBeGreaterThan(0);
    }
  });

  it("enables through a stale esiOptIn: false (Biswasundar Bhoi, July 2026)", () => {
    // The shape that made the button look dead: the click recorded the consent,
    // but a leftover opt-out from the forced-off era vetoed it. Over the limit,
    // esiOverLimitOptIn is the only answer that counts.
    const row = compute(
      employee({
        monthlySalary: 23200,
        totalSalary: 25200,
        basicPercent: 54,
        pfOptIn: true,
        esiOptIn: false,
        esiOverLimitOptIn: true,
      }),
    );
    expect(row.esiOptIn).toBe(true);
    expect(row.esi).toBeGreaterThan(0);
  });

  it("enables a PF-on row just over the limit (Piku Mondal, July 2026)", () => {
    // No stored totalSalary, so the package is the monthly salary itself:
    // ₹21,100, ₹100 over the line. PF stays on (basic 10,550 ≤ 15,000), so the
    // Official basic comes from the wage board and is well under the ESI ceiling.
    const row = compute(
      employee({
        category: "Semi-skilled",
        monthlySalary: 21100,
        totalSalary: undefined,
        basicPercent: 50,
        pfOptIn: true,
        esiOptIn: false,
        esiOverLimitOptIn: true,
      }),
    );
    expect(row.totalSalary).toBeGreaterThan(ESI_GROSS_LIMIT);
    expect(row.pfOptIn).toBe(true);
    expect(row.esiOptIn).toBe(true);
    expect(row.esi).toBeGreaterThan(0);
    expect(buildOfficialRow(row, 30).esi).toBeGreaterThan(0);
  });

  it("turns back off when the consent is withdrawn", () => {
    const row = compute(
      employee({ monthlySalary: 40000, esiOverLimitOptIn: undefined, esiOptIn: true }),
    );
    expect(row.esiOptIn).toBe(false);
    expect(row.esi).toBe(0);
  });

  it("keeps ESI off for Special whatever the flags say", () => {
    expect(
      compute(employee({ category: "Special", esiOverLimitOptIn: true })).esiOptIn,
    ).toBe(false);
  });

  it("holds the Official basic inside (15,000, 21,000] for an enabled PF-off row", () => {
    for (const monthlySalary of [22000, 30000, 45000, 90000]) {
      const row = compute(
        employee({ monthlySalary, pfOptIn: false, esiOverLimitOptIn: true }),
      );
      expect(row.esiOptIn, `${monthlySalary}`).toBe(true);
      const basic = officialBasic(row, "Skilled", 26);
      expect(basic, `${monthlySalary} basic ${basic}`).toBeGreaterThan(PF_BASIC_LIMIT);
      expect(basic, `${monthlySalary} basic ${basic}`).toBeLessThanOrEqual(ESI_GROSS_LIMIT);
      // The point of the cap: the enabled ESI is actually charged on Official.
      expect(buildOfficialRow(row, 30).esi, `${monthlySalary}`).toBeGreaterThan(0);
    }
  });

  it("leaves the ESI-off basic floor alone", () => {
    // PF off + ESI off keeps the elevated 21,100 floor, above the ESI ceiling.
    const row = compute(employee({ monthlySalary: 45000, pfOptIn: false }));
    expect(row.esiOptIn).toBe(false);
    expect(officialBasic(row, "Skilled", 26)).toBeGreaterThan(ESI_GROSS_LIMIT);
    expect(buildOfficialRow(row, 30).esi).toBe(0);
  });

  it("does not disturb the PF-on path", () => {
    const row = compute(employee({ monthlySalary: 18000, pfOptIn: true }));
    expect(row.pfOptIn).toBe(true);
    // Wage-board daily × attendance, untouched by any ESI rule.
    expect(officialBasic(row, "Skilled", 26)).toBeCloseTo(26 * 484, 2);
  });
});
