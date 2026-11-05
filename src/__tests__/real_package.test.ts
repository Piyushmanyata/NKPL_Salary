import { describe, expect, it } from "vitest";
import { buildOfficialRow } from "../officialSheet";
import { calculateSalary } from "../salary";
import { applyEmployeeEdit } from "../editEmployee";
import { applyEmployeeRates, buildRateMap, carryForwardEmployee, sanitizeEmployee } from "../roster";
import { buildReferenceExportRows } from "../exportSheet";
import type { EmployeeInput } from "../types";

const sajamal = (over: Partial<EmployeeInput> = {}): EmployeeInput => ({
  id: "emp-4",
  name: "S K SAJAMAL",
  category: "Skilled",
  monthlySalary: 17000,
  totalSalary: 25100,
  salaryPerDay: 756.67,
  bonusPerDay: 0,
  daysWorked: 29,
  extraDays: 0,
  basicPercent: 70,
  pfOptIn: false,
  esiOptIn: false,
  otherDeduction: 0,
  fullAttendanceBasic: 25100,
  realPackage: 22700,
  ...over,
});

const OCT = { workingDays: 31, monthLabel: "October 2026" };

describe("Real Package cut (ADR-0025)", () => {
  it("cuts the package gap for the days paid, to the nearest 100", () => {
    expect(calculateSalary(sajamal(), OCT).packageCut).toBe(2200);
    expect(calculateSalary(sajamal({ daysWorked: 31 }), OCT).packageCut).toBe(2400);
    expect(calculateSalary(sajamal(), { workingDays: 30, monthLabel: "September 2026" }).packageCut).toBe(2300);
  });

  it("counts extra days, which are paid at the raised rate", () => {
    expect(calculateSalary(sajamal({ daysWorked: 31, extraDays: 2 }), OCT).packageCut).toBe(2600);
  });

  it("leaves gross on the raised package and takes the cut from net", () => {
    const without = calculateSalary(sajamal({ realPackage: undefined }), OCT);
    const withCut = calculateSalary(sajamal(), OCT);
    expect(withCut.grossPayable).toBe(without.grossPayable);
    expect(withCut.netPayable).toBeCloseTo(without.netPayable - 2200, 2);
    expect(withCut.totalCost).toBeCloseTo(without.totalCost - 2200, 2);
  });

  it("keeps the 25,100 Official basic at full attendance and books the cut as Advance", () => {
    const row = calculateSalary(sajamal({ daysWorked: 30, advance: 500 }), { workingDays: 30, monthLabel: "November 2026" });
    const official = buildOfficialRow(row, 30);
    expect(official.attendance).toBe(26);
    expect(official.monthlyBasic).toBe(25100);
    expect(official.advance).toBe(2900);
    expect(official.packageCut).toBe(2400);
    expect(official.netPayable).toBeCloseTo(row.netPayable, 2);
  });

  it("exports the cut inside the Advance column", () => {
    const [exported] = buildReferenceExportRows([calculateSalary(sajamal(), OCT)], "October 2026");
    expect(exported.Advance).toBe(-2200);
  });

  it("does nothing when unset, not below Total Salary, or Special", () => {
    expect(calculateSalary(sajamal({ realPackage: undefined }), OCT).packageCut).toBe(0);
    expect(calculateSalary(sajamal({ realPackage: 25100 }), OCT).packageCut).toBe(0);
    expect(calculateSalary(sajamal({ realPackage: 30000 }), OCT).packageCut).toBe(0);
    expect(calculateSalary(sajamal({ category: "Special", monthlySalary: 25100 }), OCT).packageCut).toBe(0);
  });

  it("still cuts when the package has no separate allowance or is built from day rates", () => {
    const flat = sajamal({ monthlySalary: 25100, totalSalary: 25100, daysWorked: 31 });
    expect(calculateSalary(flat, OCT).packageCut).toBe(2400);
    const daily = sajamal({ category: "Unskilled", totalSalary: undefined, salaryPerDay: 700, bonusPerDay: 110, daysWorked: 31 });
    expect(calculateSalary(daily, OCT).packageCut).toBe(2400);
  });

  it("never pushes net below zero", () => {
    const row = calculateSalary(sajamal({ realPackage: 100, daysWorked: 31 }), OCT);
    expect(row.netPayable).toBeGreaterThanOrEqual(0);
    expect(row.packageCut).toBeLessThan(25100);
  });

  it("is standing rate data: kept by the rate card and carried into a new month", () => {
    const card = buildRateMap([sajamal()]);
    expect(card["emp-4"].realPackage).toBe(22700);
    const applied = applyEmployeeRates([sajamal({ realPackage: undefined })], card);
    expect(applied[0].realPackage).toBe(22700);
    expect(carryForwardEmployee(sajamal(), 30).realPackage).toBe(22700);
    expect(buildRateMap([sajamal({ realPackage: undefined })])["emp-4"]).not.toHaveProperty("realPackage");
  });

  it("clears on blank or 0 and sanitises junk", () => {
    expect(applyEmployeeEdit(sajamal(), "realPackage", 0).realPackage).toBeUndefined();
    expect(applyEmployeeEdit(sajamal(), "realPackage", "").realPackage).toBeUndefined();
    expect(applyEmployeeEdit(sajamal({ realPackage: undefined }), "realPackage", 22700).realPackage).toBe(22700);
    expect(sanitizeEmployee({ ...sajamal(), realPackage: -5 } as EmployeeInput).realPackage).toBeUndefined();
  });
});
