import { describe, expect, it } from "vitest";
import { buildMonthSheets } from "../monthSheets";
import {
  emptyNewEmployeeForm,
  employeeFromForm,
  esiChecked,
  esiDefaultOn,
  newEmployeeErrors,
  salaryModeFor,
  withEsiChoice,
  type NewEmployeeForm,
} from "../newEmployee";

const D = 30;
const MONTH = "November 2026";

const form = (overrides: Partial<NewEmployeeForm> = {}): NewEmployeeForm => ({
  ...emptyNewEmployeeForm(D),
  name: "Ravi Das",
  category: "Skilled",
  salary: 15000,
  ...overrides,
});

const rowOf = (input: NewEmployeeForm) =>
  buildMonthSheets([employeeFromForm(input, D)], D, MONTH).salaryRows[0]!;

describe("new employee pop-up", () => {
  it("types Unskilled per day and the rest per month", () => {
    expect(salaryModeFor("Unskilled")).toBe("perDay");
    expect(salaryModeFor("Semi-skilled")).toBe("perMonth");
    expect(salaryModeFor("Skilled")).toBe("perMonth");
    expect(salaryModeFor("Special")).toBe("perMonth");
  });

  it("starts as Unskilled with the full month and PF on", () => {
    expect(emptyNewEmployeeForm(D)).toMatchObject({ category: "Unskilled", daysWorked: D, pfOptIn: true });
  });

  it("builds a Skilled employee from monthly salary + travelling", () => {
    const employee = employeeFromForm(form({ extra: 3000, daysWorked: 20, notes: "Aadhaar 1234" }), D);
    expect(employee).toMatchObject({
      name: "Ravi Das",
      category: "Skilled",
      monthlySalary: 15000,
      totalSalary: 18000,
      daysWorked: 20,
      extraDays: 0,
      pfOptIn: true,
      esiOptIn: true,
      notes: "Aadhaar 1234",
    });
    expect(rowOf(form({ extra: 3000 })).totalSalary).toBe(18000);
  });

  it("builds an Unskilled employee from day rate + bonus per day", () => {
    const row = rowOf(form({ category: "Unskilled", salary: 400, extra: 50 }));
    expect(row.salaryPerDay).toBe(400);
    expect(row.bonusPerDay).toBe(50);
    expect(row.totalSalary).toBe(D * 450);
    expect(row.missingRate).not.toBe(true);
  });

  it("forces full month and no PF/ESI for Special", () => {
    const employee = employeeFromForm(
      form({ category: "Special", salary: 40000, daysWorked: 5, extraDays: 2 }),
      D,
    );
    expect(employee).toMatchObject({
      category: "Special",
      monthlySalary: 40000,
      daysWorked: D,
      extraDays: 0,
      pfOptIn: false,
      esiOptIn: false,
    });
  });

  it("records ESI above the 21,000 limit as explicit consent", () => {
    const high = form({ salary: 20000, extra: 5000 });
    const over = employeeFromForm(withEsiChoice(high, true, D), D);
    expect(over.esiOverLimitOptIn).toBe(true);
    expect(over.esiOptIn).toBe(true);
    const off = employeeFromForm(withEsiChoice(high, false, D), D);
    expect(off.esiOverLimitOptIn).toBeUndefined();
    expect(off.esiOptIn).toBe(false);
  });

  it("drops an ESI tick made below the limit once pay goes above it", () => {
    const ticked = withEsiChoice(form({ salary: 15000 }), true, D);
    const raised = { ...ticked, salary: 25000 };
    expect(esiChecked(raised, D)).toBe(false);
    const employee = employeeFromForm(raised, D);
    expect(employee.esiOverLimitOptIn).toBeUndefined();
    expect(rowOf(raised).esi).toBe(0);
  });

  it("keeps an ESI choice while pay stays on the same side of the limit", () => {
    const unticked = withEsiChoice(form({ salary: 15000 }), false, D);
    expect(esiChecked({ ...unticked, salary: 16000 }, D)).toBe(false);
    expect(esiChecked({ ...unticked, salary: 25000 }, D)).toBe(false);
    const consent = withEsiChoice(form({ salary: 25000 }), true, D);
    expect(esiChecked({ ...consent, salary: 30000 }, D)).toBe(true);
    expect(esiChecked({ ...consent, salary: 15000 }, D)).toBe(true);
  });

  it("turns ESI off by default only above the limit, using the sheet's own Total Salary", () => {
    expect(esiDefaultOn(form({ salary: 18000, extra: 3000 }), D)).toBe(true);
    expect(esiDefaultOn(form({ salary: 18000, extra: 3001 }), D)).toBe(false);
    expect(esiDefaultOn(form({ category: "Unskilled", salary: 700, extra: 1 }), D)).toBe(false);
    const untouched = employeeFromForm(form({ salary: 18000, extra: 3001 }), D);
    expect(rowOf(form({ salary: 18000, extra: 3001 })).esi).toBe(0);
    expect(untouched.esiOverLimitOptIn).toBeUndefined();
    expect(rowOf(form({ salary: 18000, extra: 3000 })).esi).toBeGreaterThan(0);
  });

  it("keeps advance, trims the name and clamps days to the month", () => {
    const employee = employeeFromForm(form({ name: "  Ravi  ", advance: 2000, daysWorked: 45 }), D);
    expect(employee.name).toBe("Ravi");
    expect(employee.advance).toBe(2000);
    expect(employee.daysWorked).toBe(D);
  });

  it("refuses a blank name or no salary, and flags a name already on the sheet", () => {
    expect(newEmployeeErrors(form({ name: "  " }), D, [])).toMatchObject({ name: expect.any(String) });
    expect(newEmployeeErrors(form({ salary: 0 }), D, [])).toMatchObject({ salary: expect.any(String) });
    expect(newEmployeeErrors(form({ daysWorked: 31 }), D, [])).toMatchObject({ daysWorked: expect.any(String) });
    expect(newEmployeeErrors(form(), D, [])).toEqual({});
    expect(newEmployeeErrors(form({ name: "ravi das " }), D, ["Ravi Das"])).toMatchObject({
      duplicate: expect.any(String),
    });
  });
});
