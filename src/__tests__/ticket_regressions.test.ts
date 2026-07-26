/**
 * TICKET-14 — one named regression per batch ticket (01–12).
 * Names match TICKET-14 §4 so each AC checkbox maps to a single `it(...)`.
 */
import { describe, expect, it } from "vitest";
import { calendarDaysForMonth } from "../attendance";
import {
  OFFICIAL_WAGE_DAYS,
  buildOfficialRow,
  normalizeCategory,
} from "../officialSheet";
import {
  calculateSalary,
  clampBasicPercent,
  repairRates,
  roundMoney,
} from "../salary";
import { juneEmployees } from "../juneEmployees";
import { sampleEmployees } from "../sampleEmployees";
import type { EmployeeInput } from "../types";

function refFrom(partial: EmployeeInput, monthDays = 30) {
  return calculateSalary(partial, {
    workingDays: monthDays,
    basicShare: clampBasicPercent(partial.basicPercent) / 100,
  });
}

describe("TICKET-14: targeted ticket regressions", () => {
  it("special_is_month_length_invariant", () => {
    const base: EmployeeInput = {
      id: "t01",
      name: "Special Officer",
      category: "Special",
      monthlySalary: 60000,
      daysWorked: 1,
      extraDays: 5,
      otherDeduction: 0,
    };
    const d28 = refFrom(base, 28);
    const d31 = refFrom(base, 31);
    expect(d28.monthlySalary).toBe(d31.monthlySalary);
    expect(d28.monthlySalary).toBe(60000);
    expect(d28.daysWorked).toBe(28);
    expect(d31.daysWorked).toBe(31);
  });

  it("security_never_earns_extra_days", () => {
    const row = refFrom({
      id: "t02",
      name: "Guard",
      category: "Semi-skilled",
      monthlySalary: 15000,
      daysWorked: 28,
      extraDays: 5,
      isSecurity: true,
      pfOptIn: true,
      esiOptIn: true,
      otherDeduction: 0,
    });
    expect(row.extraDays).toBe(0);
    expect(row.performanceBonus).toBe(0);
  });

  it("month_days_from_label", () => {
    expect(calendarDaysForMonth("February 2026")).toBe(28);
    expect(calendarDaysForMonth("February 2028")).toBe(29);
    expect(calendarDaysForMonth("July 2026")).toBe(31);
    expect(calendarDaysForMonth("June 2026")).toBe(30);
    expect(calendarDaysForMonth("not-a-month")).toBe(30);
  });

  it("unskilled_backfills_day_rate", () => {
    const repaired = repairRates("Unskilled", 9600, 0, 0, 30);
    expect(repaired.salaryPerDay).toBe(320);
    expect(repaired.missingRate).toBe(false);
    const row = calculateSalary(
      {
        id: "t04",
        name: "Labour",
        category: "Unskilled",
        monthlySalary: repaired.monthlySalary,
        salaryPerDay: repaired.salaryPerDay,
        daysWorked: 26,
        extraDays: 0,
        otherDeduction: 0,
      },
      { workingDays: 30 },
    );
    expect(row.grossPayable).toBeGreaterThan(0);
    // calculateSalary must NOT re-backfill when r is missing (I10 / T-04)
    const missing = calculateSalary(
      {
        id: "t04b",
        name: "Missing",
        category: "Unskilled",
        monthlySalary: 9600,
        salaryPerDay: 0,
        daysWorked: 26,
        extraDays: 0,
        otherDeduction: 0,
      },
      { workingDays: 30 },
    );
    expect(missing.missingRate).toBe(true);
    expect(missing.grossPayable).toBe(0);
  });

  it("seed_rosters_store_base_salary", () => {
    for (const [label, roster] of [
      ["juneEmployees", juneEmployees],
      ["sampleEmployees", sampleEmployees],
    ] as const) {
      for (const e of roster) {
        if (e.category === "Special") continue;
        if (!e.salaryPerDay || !e.bonusPerDay) continue;
        const base = e.salaryPerDay * 30;
        const totalPackage = (e.salaryPerDay + e.bonusPerDay) * 30;
        expect(
          Math.abs(e.monthlySalary - base),
          `${label} ${e.name}: monthlySalary should be base r×30`,
        ).toBeLessThanOrEqual(15);
        expect(
          Math.abs(e.monthlySalary - totalPackage),
          `${label} ${e.name}: monthlySalary must not be total package`,
        ).toBeGreaterThan(15);
      }
    }
  });

  it("advance_always_reduces_net", () => {
    const base: EmployeeInput = {
      id: "t06",
      name: "Advance Worker",
      category: "Skilled",
      monthlySalary: 20000,
      daysWorked: 30,
      extraDays: 0,
      pfOptIn: false,
      esiOptIn: false,
      otherDeduction: 0,
    };
    const zero = refFrom({ ...base, advance: 0 });
    const pos = refFrom({ ...base, advance: 1500 });
    const neg = refFrom({ ...base, advance: -1500 });

    expect(roundMoney(zero.netPayable - pos.netPayable)).toBe(1500);
    // T-06: negative input clamps to 0 — must not *add* to net
    expect(neg.advance).toBe(0);
    expect(neg.netPayable).toBe(zero.netPayable);
    expect(pos.netPayable).toBeLessThan(zero.netPayable);
  });

  it("official_attendance_capped", () => {
    const fixtures: EmployeeInput[] = [
      {
        id: "t07-on",
        name: "PF on",
        category: "Skilled",
        monthlySalary: 18000,
        daysWorked: 30,
        extraDays: 0,
        pfOptIn: true,
        esiOptIn: true,
        otherDeduction: 0,
      },
      {
        id: "t07-off",
        name: "PF off",
        category: "Skilled",
        monthlySalary: 45000,
        daysWorked: 30,
        extraDays: 0,
        pfOptIn: false,
        esiOptIn: false,
        otherDeduction: 0,
      },
      {
        id: "t07-low",
        name: "Low attendance",
        category: "Unskilled",
        monthlySalary: 0,
        salaryPerDay: 400,
        daysWorked: 5,
        extraDays: 0,
        pfOptIn: true,
        esiOptIn: true,
        otherDeduction: 0,
      },
    ];
    for (const emp of fixtures) {
      const off = buildOfficialRow(refFrom(emp, 30), 30);
      expect(off.attendance).toBeGreaterThanOrEqual(0);
      expect(off.attendance).toBeLessThanOrEqual(OFFICIAL_WAGE_DAYS);
    }
  });

  it("bidyut_ray_wage_board_basic", () => {
    const ref = refFrom(
      {
        id: "bidyut",
        name: "BIDYUT RAY",
        category: "Skilled",
        monthlySalary: 15990,
        bonusPerDay: 257,
        daysWorked: 30,
        extraDays: 0,
        pfOptIn: true,
        esiOptIn: false,
        otherDeduction: 0,
      },
      30,
    );
    const off = buildOfficialRow(ref, 30);
    expect(off.monthlyBasic).toBe(12584);
    expect(off.pf).toBe(1510.08);
    expect(off.grossPayable).toBeCloseTo(23866.92, 2);
    expect(off.netPayable).toBeCloseTo(22226.84, 2);
  });

  it("official_net_is_computed", () => {
    const ref = refFrom({
      id: "t09",
      name: "Computed net",
      category: "Semi-skilled",
      monthlySalary: 18000,
      daysWorked: 28,
      extraDays: 1,
      basicPercent: 60,
      pfOptIn: true,
      esiOptIn: true,
      otherDeduction: 100,
      advance: 500,
    });
    const off = buildOfficialRow(ref, 30);
    const recomputed = roundMoney(
      off.grossPayable -
        off.pf -
        off.esi -
        off.professionalTax -
        (off.advance || 0) -
        off.otherDeduction,
    );
    expect(off.netPayable).toBe(recomputed);
    if (!off.unpackable) {
      expect(off.netPayable).toBeCloseTo(ref.netPayable, 2);
    }
  });

  it("category_survives_salary_change", () => {
    for (const category of ["Unskilled", "Semi-skilled", "Skilled", "Special"] as const) {
      const base: EmployeeInput = {
        id: `t11-${category}`,
        name: category,
        category,
        monthlySalary: category === "Unskilled" ? 0 : 12000,
        salaryPerDay: category === "Unskilled" ? 400 : 0,
        daysWorked: 20,
        extraDays: 0,
        otherDeduction: 0,
      };
      const low = refFrom(base, 30);
      const high = refFrom(
        {
          ...base,
          monthlySalary: category === "Unskilled" ? 0 : 80000,
          salaryPerDay: category === "Unskilled" ? 2500 : base.salaryPerDay,
        },
        30,
      );
      expect(low.category).toBe(category);
      expect(high.category).toBe(category);
      // normalizeCategory never invents grade from a number
      expect(normalizeCategory("80000")).toBe(null);
      expect(normalizeCategory(category)).toBe(category);
    }
  });

  it("special_renders_on_official_sheet", () => {
    const specials = juneEmployees.filter((e) => e.category === "Special");
    expect(specials.length).toBeGreaterThanOrEqual(6);
    expect(() => {
      for (const emp of specials) {
        buildOfficialRow(refFrom(emp, 30), 30);
      }
    }).not.toThrow();
  });
});
