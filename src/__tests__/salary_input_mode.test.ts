import { describe, expect, it } from "vitest";
import { calculateSalary, dailyFromMonthly, monthlyFromDaily } from "../salary";
import type { EmployeeInput } from "../types";

// The Per Day / Per Month switch in Settings types one salary two ways. These
// guard the conversion the switch relies on: M = D x r, both directions.

const base: EmployeeInput = {
  id: "t1",
  name: "Test",
  category: "Unskilled",
  monthlySalary: 0,
  salaryPerDay: 0,
  bonusPerDay: 0,
  daysWorked: 30,
  extraDays: 0,
  basicPercent: 70,
  pfOptIn: true,
  esiOptIn: true,
  otherDeduction: 0,
};

describe("salary input mode: per day <-> per month", () => {
  it("round-trips a day rate through a monthly package", () => {
    for (const D of [28, 30, 31]) {
      for (const r of [400, 440, 484, 512.5, 733]) {
        expect(dailyFromMonthly(monthlyFromDaily(r, D), D)).toBeCloseTo(r, 2);
      }
    }
  });

  it("clamps calendar days the same way the engine does", () => {
    // 45 clamps to 31, 0/blank fall back to the 30-day default.
    expect(monthlyFromDaily(100, 45)).toBe(monthlyFromDaily(100, 31));
    expect(monthlyFromDaily(100, "")).toBe(3000);
    expect(dailyFromMonthly(3000, "")).toBe(100);
  });

  it("never returns a negative rate", () => {
    expect(monthlyFromDaily(-500, 30)).toBe(0);
    expect(dailyFromMonthly(-15000, 30)).toBe(0);
  });

  it("pays an Unskilled row identically whichever way the salary was typed", () => {
    const D = 30;
    const typedPerDay = calculateSalary({ ...base, salaryPerDay: 500 }, { workingDays: D });
    // Typing 15,000/month on the same row stores r = M / D (what updateEmployee does).
    const typedPerMonth = calculateSalary(
      { ...base, monthlySalary: 15000, salaryPerDay: dailyFromMonthly(15000, D) },
      { workingDays: D },
    );

    expect(typedPerMonth.salaryPerDay).toBe(typedPerDay.salaryPerDay);
    expect(typedPerMonth.monthlySalary).toBe(typedPerDay.monthlySalary);
    expect(typedPerMonth.netPayable).toBe(typedPerDay.netPayable);
  });

  it("pays a Skilled row identically whichever way the salary was typed", () => {
    const D = 31;
    const skilled = { ...base, category: "Skilled" as const, daysWorked: D };
    const typedPerMonth = calculateSalary({ ...skilled, monthlySalary: 24800 }, { workingDays: D });
    // Typing 800/day on the same row stores M = D x r (what updateEmployee does).
    const typedPerDay = calculateSalary(
      { ...skilled, salaryPerDay: 800, monthlySalary: monthlyFromDaily(800, D) },
      { workingDays: D },
    );

    expect(typedPerDay.monthlySalary).toBe(typedPerMonth.monthlySalary);
    expect(typedPerDay.netPayable).toBe(typedPerMonth.netPayable);
  });
});
