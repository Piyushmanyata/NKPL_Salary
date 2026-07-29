import { describe, expect, it } from "vitest";
import { juneEmployees } from "../juneEmployees";
import { calculateSalary, clampBasicPercent } from "../salary";
import type { EmployeeInput } from "../types";
import aptusInputs from "./fixtures/aptus-june-inputs.json";

/**
 * Issue #24 — the Reference Sheet reproduces the statutory arithmetic of the
 * Source Workbooks under `Excel/`. See ADR-0004.
 *
 *   ESI  =IF(J<=21000, ROUNDUP(O*0.75%, 0), 0)   J = Total Salary, O = Earned Salary
 *   PF   =ROUND(IF(V<=15000, V*12%, 0), 0)       V = earned basic
 */

/** Workbook row → EmployeeInput. `K` = Salary P.M, `N` = Increase in Salary Amount. */
function fromWorkbook(row: { K: number; N: number; F: number; basicPercent: number }): EmployeeInput {
  return {
    id: "wb",
    name: "Workbook Row",
    category: "Semi-skilled",
    monthlySalary: row.K,
    totalSalary: row.K + row.N,
    daysWorked: row.F,
    extraDays: 0,
    basicPercent: row.basicPercent,
    pfOptIn: true,
    esiOptIn: true,
    otherDeduction: 0,
  };
}

const compute = (input: EmployeeInput) =>
  calculateSalary(input, {
    workingDays: 30,
    basicShare: clampBasicPercent(input.basicPercent) / 100,
  });

describe("Issue #24: Source Workbook parity", () => {
  it("NKPL ACTUAL row 16 — Keya Patra: ESI 48, PF 528, net 5,997.33", () => {
    const ref = compute(fromWorkbook({ K: 6500, N: 300, F: 29, basicPercent: 70 }));
    expect(ref.esi).toBe(48);
    expect(ref.employeePf).toBe(528);
    expect(ref.netPayable).toBeCloseTo(5997.33, 2);
  });

  it("APTUS ACTUALL — full-attendance row with no allowance", () => {
    const ref = compute(fromWorkbook({ K: 9000, N: 0, F: 30, basicPercent: 70 }));
    // O = 9000 → ESI = ROUNDUP(67.5) = 68; V = 6300 → PF = ROUND(756) = 756
    expect(ref.esi).toBe(68);
    expect(ref.employeePf).toBe(756);
    expect(ref.netPayable).toBeCloseTo(9000 - 68 - 756, 2);
  });

  it("above the ESI threshold — Total Salary > 21,000 pays no ESI", () => {
    const ref = compute(fromWorkbook({ K: 21000, N: 500, F: 30, basicPercent: 70 }));
    expect(ref.totalSalary).toBeGreaterThan(21000);
    expect(ref.esiOptIn).toBe(false);
    expect(ref.esi).toBe(0);
    expect(ref.employerEsi).toBe(0);
  });

  it("eligibility is a property of the package, not the month: short month below 21k still pays no ESI", () => {
    const ref = compute(fromWorkbook({ K: 22000, N: 0, F: 15, basicPercent: 70 }));
    expect(ref.grossPayable).toBeLessThan(21000);
    expect(ref.totalSalary).toBeGreaterThan(21000);
    expect(ref.esi).toBe(0);
  });

  it("ESI and PF are whole rupees on every row of both June rosters", () => {
    for (const emp of [...juneEmployees, ...(aptusInputs as EmployeeInput[])]) {
      const ref = compute(emp);
      expect(Number.isInteger(ref.esi), `${emp.name} esi ${ref.esi}`).toBe(true);
      expect(Number.isInteger(ref.employerEsi), `${emp.name} employerEsi`).toBe(true);
      expect(Number.isInteger(ref.employeePf), `${emp.name} pf ${ref.employeePf}`).toBe(true);
      expect(Number.isInteger(ref.employerPf), `${emp.name} employerPf`).toBe(true);
    }
  });

  it("TDS payers are exempt from Professional Tax (TICKET-15)", () => {
    const base: EmployeeInput = {
      id: "ptax",
      name: "High Earner",
      category: "Skilled",
      monthlySalary: 99990,
      daysWorked: 30,
      extraDays: 0,
      basicPercent: 70,
      pfOptIn: false,
      esiOptIn: false,
      otherDeduction: 0,
    };
    expect(compute(base).professionalTax).toBe(200);
    // TDS is stored as otherDeduction — any TDS at all waives P-Tax.
    expect(compute({ ...base, otherDeduction: 20000 }).professionalTax).toBe(0);
    expect(compute({ ...base, otherDeduction: 20000 }).netPayable).toBeCloseTo(79990, 2);
  });

  it("Special Employees still get zero ESI and zero PF regardless of Total Salary", () => {
    for (const monthlySalary of [8000, 20000, 40000]) {
      const ref = compute({
        id: "sp",
        name: "Special",
        category: "Special",
        monthlySalary,
        totalSalary: monthlySalary + 1000,
        daysWorked: 30,
        extraDays: 0,
        pfOptIn: true,
        esiOptIn: true,
        otherDeduction: 0,
      });
      expect(ref.esi).toBe(0);
      expect(ref.employerEsi).toBe(0);
      expect(ref.employeePf).toBe(0);
    }
  });
});
