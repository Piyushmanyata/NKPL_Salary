import { describe, expect, it } from "vitest";
import { calculateSalary, isSpecialCategory } from "../salary";
import { normalizeCategory } from "../officialSheet";
import type { EmployeeInput } from "../types";

describe("Issue #2 / TICKET-01: Employee Rate Model & Special Category", () => {
  it("Labour (Unskilled): Salary Per Day is source of truth and Monthly Salary equals day rate x Calendar Days", () => {
    const labourInput: EmployeeInput = {
      id: "emp-1",
      name: "Ramesh Labour",
      category: "Unskilled",
      monthlySalary: 0,
      salaryPerDay: 500,
      bonusPerDay: 50,
      daysWorked: 30,
      extraDays: 0,
      otherDeduction: 0,
    };

    const row30 = calculateSalary(labourInput, { workingDays: 30 });
    expect(row30.salaryPerDay).toBe(500);
    expect(row30.monthlySalary).toBe(15000);

    const row31 = calculateSalary(labourInput, { workingDays: 31 });
    expect(row31.salaryPerDay).toBe(500);
    expect(row31.monthlySalary).toBe(15500);
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
    expect(row31.salaryPerDay).toBe(1000);

    const row30 = calculateSalary(skilledInput, { workingDays: 30 });
    expect(row30.monthlySalary).toBe(31000);
    expect(row30.salaryPerDay).toBe(1033.33);
  });

  it("Special is a Category: full month Days Worked, no day rate, no PF, no ESI", () => {
    const specialInput: EmployeeInput = {
      id: "emp-3",
      name: "Custom Special Officer",
      category: "Special",
      monthlySalary: 50000,
      daysWorked: 10,
      extraDays: 0,
      pfOptIn: true,
      esiOptIn: true,
      otherDeduction: 0,
    };

    const row = calculateSalary(specialInput, { workingDays: 30 });
    expect(row.category).toBe("Special");
    expect(row.salaryPerDay).toBe(0);
    expect(row.bonusPerDay).toBe(0);
    expect(row.daysWorked).toBe(30);
    expect(row.extraDays).toBe(0);
    expect(row.absentDays).toBe(0);
    expect(row.absentDeduction).toBe(0);
    expect(row.pfOptIn).toBe(false);
    expect(row.esiOptIn).toBe(false);
    expect(row.employeePf).toBe(0);
    expect(row.esi).toBe(0);
    expect(row.monthlySalary).toBe(50000);
  });

  it("Special monthly salary is invariant to month length", () => {
    const base: EmployeeInput = {
      id: "emp-s",
      name: "Sonal",
      category: "Special",
      monthlySalary: 60000,
      daysWorked: 1,
      extraDays: 0,
      otherDeduction: 0,
    };
    const d28 = calculateSalary(base, { workingDays: 28 });
    const d31 = calculateSalary(base, { workingDays: 31 });
    expect(d28.monthlySalary).toBe(d31.monthlySalary);
    expect(d28.monthlySalary).toBe(60000);
    expect(d28.professionalTax).toBe(200);
    expect(d31.professionalTax).toBe(200);
  });

  it("isSpecialCategory and normalizeCategory", () => {
    expect(isSpecialCategory("Special")).toBe(true);
    expect(isSpecialCategory("Skilled")).toBe(false);
    expect(normalizeCategory("Special")).toBe("Special");
    expect(normalizeCategory("semi skilled")).toBe("Semi-skilled");
    expect(normalizeCategory("Manager")).toBe(null);
  });
});
