import { describe, expect, it } from "vitest";
import { OFFICIAL_WAGE_DAYS, buildOfficialRow, officialAttendanceMax } from "../officialSheet";
import { calculateSalary } from "../salary";
import type { EmployeeInput } from "../types";

/** ADR-0013: Official attendance scales days worked into the 26-day frame. */

const worker = (over: Partial<EmployeeInput> = {}): EmployeeInput => ({
  id: "emp-r1",
  name: "RATIO WORKER",
  category: "Skilled",
  monthlySalary: 19500,
  salaryPerDay: 650,
  bonusPerDay: 223,
  daysWorked: 30,
  extraDays: 0,
  basicPercent: 70,
  pfOptIn: true,
  esiOptIn: false,
  advance: null,
  otherDeduction: 0,
  ...over,
});

describe("officialAttendanceMax", () => {
  it("scales days worked by 26 / calendar days", () => {
    // 10 / 30 × 26 = 8.67 → 9. The old subtractive rule gave 26 − 20 = 6.
    expect(officialAttendanceMax(10, 30)).toBe(9);
    expect(officialAttendanceMax(20, 30)).toBe(17);
    expect(officialAttendanceMax(26, 30)).toBe(23);
  });

  it("prints 26 at full attendance in every month length", () => {
    for (const D of [28, 29, 30, 31]) {
      expect(officialAttendanceMax(D, D)).toBe(OFFICIAL_WAGE_DAYS);
    }
  });

  it("prints 0 for a zero-day month and clamps days worked to the month", () => {
    expect(officialAttendanceMax(0, 31)).toBe(0);
    expect(officialAttendanceMax(40, 30)).toBe(OFFICIAL_WAGE_DAYS);
    expect(officialAttendanceMax(-5, 30)).toBe(0);
    expect(officialAttendanceMax(10, 0)).toBe(0);
  });

  it("never returns NaN for a malformed input", () => {
    expect(officialAttendanceMax(Number.NaN, 30)).toBe(0);
    expect(officialAttendanceMax(10, Number.NaN)).toBe(0);
    expect(officialAttendanceMax(10, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("never hands the packer an empty range for someone who worked", () => {
    // 5 / 31 × 26 = 4.19 → 4; the old rule gave 26 − 26 = 0 against an A_min of 1.
    expect(officialAttendanceMax(5, 31)).toBe(4);
    for (const D of [28, 29, 30, 31]) {
      expect(officialAttendanceMax(1, D)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("buildOfficialRow attendance frame", () => {
  it("uses the ratio ceiling for an absent employee", () => {
    const row = calculateSalary(worker({ daysWorked: 20 }), { workingDays: 30 });
    expect(buildOfficialRow(row, 30).attendance).toBe(17);
  });

  it("leaves a fully present employee at 26", () => {
    const row = calculateSalary(worker(), { workingDays: 30 });
    expect(buildOfficialRow(row, 30).attendance).toBe(OFFICIAL_WAGE_DAYS);
  });

  it("keeps Official net equal to Reference net when attendance rises", () => {
    const row = calculateSalary(worker({ daysWorked: 20 }), { workingDays: 30 });
    const official = buildOfficialRow(row, 30);
    expect(official.netPayable).toBeCloseTo(official.referenceNetPayable, 2);
  });

  it("raises PF with the higher basic, since PF follows basic", () => {
    const row = calculateSalary(worker({ daysWorked: 20 }), { workingDays: 30 });
    const official = buildOfficialRow(row, 30);
    // Skilled wage board: 17 × 484 = 8,228 basic, PF 0.12 × 8,228.
    expect(official.monthlyBasic).toBeCloseTo(8228, 2);
    expect(official.pf).toBeCloseTo(987.36, 2);
  });
});
