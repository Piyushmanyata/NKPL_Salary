import { describe, expect, it } from "vitest";
import { calculateSalary, isSpecialEmployee } from "../salary";
import type { EmployeeInput } from "../types";

describe("Issue #2: Employee Rate Model & Special Employee Flag", () => {
  it("Labour (Unskilled): Salary Per Day is source of truth and Monthly Salary equals day rate x Calendar Days", () => {
    const labourInput: EmployeeInput = {
      id: "emp-1",
      name: "Ramesh Labour",
      category: "Unskilled",
      monthlySalary: 0, // Should be calculated from day rate
      salaryPerDay: 500,
      bonusPerDay: 50,
      daysWorked: 30,
      extraDays: 0,
      otherDeduction: 0,
    };

    const row30 = calculateSalary(labourInput, { workingDays: 30 });
    expect(row30.salaryPerDay).toBe(500);
    expect(row30.monthlySalary).toBe(15000); // 500 * 30

    const row31 = calculateSalary(labourInput, { workingDays: 31 });
    expect(row31.salaryPerDay).toBe(500);
    expect(row31.monthlySalary).toBe(15500); // 500 * 31
  });

  it("Semi-skilled and Skilled: Monthly Salary is fixed for the month and Wage Per Day is derived", () => {
    const skilledInput: EmployeeInput = {
      id: "emp-2",
      name: "Suresh Skilled",
      category: "Skilled",
      monthlySalary: 31000,
      salaryPerDay: 0,
      bonusPerDay: 0,
      daysWorked: 30,
      extraDays: 0,
      otherDeduction: 0,
    };

    const row31 = calculateSalary(skilledInput, { workingDays: 31 });
    expect(row31.monthlySalary).toBe(31000);
    expect(row31.salaryPerDay).toBe(1000); // 31000 / 31

    const row30 = calculateSalary(skilledInput, { workingDays: 30 });
    expect(row30.monthlySalary).toBe(31000);
    expect(row30.salaryPerDay).toBe(1033.33); // 31000 / 30
  });

  it("Special Employee is an explicit flag: full month Days Worked, no PF, no ESI, attendance-exempt", () => {
    const specialInput: EmployeeInput = {
      id: "emp-3",
      name: "Custom Special Officer",
      category: "Skilled",
      monthlySalary: 50000,
      daysWorked: 10, // Even if 10 is passed, special is attendance-exempt!
      extraDays: 0,
      isSpecial: true, // Explicit flag!
      pfOptIn: true, // Requested, but must be forced off for special
      esiOptIn: true,
      otherDeduction: 0,
    };

    const row = calculateSalary(specialInput, { workingDays: 30 });
    expect(row.isSpecial).toBe(true);
    expect(row.daysWorked).toBe(30);
    expect(row.absentDays).toBe(0);
    expect(row.absentDeduction).toBe(0);
    expect(row.pfOptIn).toBe(false);
    expect(row.esiOptIn).toBe(false);
    expect(row.employeePf).toBe(0);
    expect(row.esi).toBe(0);
  });

  it("evaluates isSpecial helper based on explicit boolean flag", () => {
    expect(isSpecialEmployee({ name: "Anjali Sodhani", isSpecial: true } as EmployeeInput)).toBe(true);
    expect(isSpecialEmployee({ name: "Normal Worker", isSpecial: false } as EmployeeInput)).toBe(false);
    expect(isSpecialEmployee({ name: "Default Worker" } as EmployeeInput)).toBe(false);
  });
});
