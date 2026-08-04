import { describe, expect, it } from "vitest";
import {
  OFFICIAL_WAGE_DAYS,
  buildOfficialRow,
  officialBasic,
  officialEsi,
  officialPf,
  wageBoardCategory,
} from "../officialSheet";
import { calculateSalary } from "../salary";
import type { EmployeeInput, SalaryRow } from "../types";

function refRow(partial: EmployeeInput, monthDays = 30): SalaryRow {
  return calculateSalary(partial, { workingDays: monthDays });
}

describe("TICKET-07: single Official path + 26-day frame", () => {
  it("exports pure officialBasic / officialPf / officialEsi", () => {
    const row = refRow({
      id: "helpers",
      name: "Helper Worker",
      category: "Skilled",
      monthlySalary: 18000,
      daysWorked: 26,
      extraDays: 0,
      pfOptIn: true,
      esiOptIn: true,
      otherDeduction: 0,
    });
    const wage = wageBoardCategory(row.category);
    const basic = officialBasic(row, wage, 26);
    // PF on + ESI on → wage board daily × A (Skilled 26×484); no display cap (T-08)
    expect(basic).toBe(12584);
    expect(officialPf(row, basic)).toBe(Math.round(Math.min(basic, 15000) * 0.12 * 100) / 100);
    expect(officialEsi(row, basic)).toBe(Math.round(basic * 0.0075 * 100) / 100);
  });

  it("officialPf is 0 when PF is off; officialEsi is 0 when ESI is off", () => {
    const row = refRow({
      id: "opt-out",
      name: "Opt Out",
      category: "Skilled",
      monthlySalary: 45000,
      daysWorked: 30,
      extraDays: 0,
      pfOptIn: false,
      esiOptIn: false,
      otherDeduction: 0,
    });
    const wage = wageBoardCategory(row.category);
    const basic = officialBasic(row, wage, 26);
    expect(basic).toBeGreaterThan(0);
    expect(officialPf(row, basic)).toBe(0);
    expect(officialEsi(row, basic)).toBe(0);
  });

  it("officialEsi is not forced on merely because PF is on", () => {
    const row = refRow({
      id: "pf-no-esi",
      name: "PF only",
      category: "Skilled",
      monthlySalary: 18000,
      daysWorked: 30,
      extraDays: 0,
      pfOptIn: true,
      esiOptIn: false,
      otherDeduction: 0,
    });
    const wage = wageBoardCategory(row.category);
    const basic = officialBasic(row, wage, 26);
    expect(officialPf(row, basic)).toBeGreaterThan(0);
    expect(officialEsi(row, basic)).toBe(0);
  });

  it("GURU PRASAD PATRA-style PF-off row: Official attendance is 26, not daysWorked 30", () => {
    // Full calendar month, PF off — old path printed attendance = daysWorked (30).
    // Day rate high enough that packing stays at A_max (low packages may walk down; T-09).
    const row = refRow({
      id: "guru",
      name: "GURU PRASAD PATRA",
      category: "Unskilled",
      monthlySalary: 0,
      salaryPerDay: 500,
      bonusPerDay: 50,
      daysWorked: 30,
      extraDays: 0,
      pfOptIn: false,
      esiOptIn: true,
      otherDeduction: 0,
    });
    expect(row.daysWorked).toBe(30);
    const off = buildOfficialRow(row, 30);
    expect(off.attendance).toBe(23);
    expect(off.attendance).toBeLessThanOrEqual(OFFICIAL_WAGE_DAYS);
    expect(off.attendance).not.toBe(row.daysWorked);
  });

  it("even when packing walks down, Official attendance never exceeds 26 or equals uncapped daysWorked", () => {
    const row = refRow({
      id: "low-package",
      name: "Low Package Labour",
      category: "Unskilled",
      monthlySalary: 0,
      salaryPerDay: 400,
      bonusPerDay: 50,
      daysWorked: 30,
      extraDays: 0,
      pfOptIn: false,
      esiOptIn: true,
      otherDeduction: 0,
    });
    const off = buildOfficialRow(row, 30);
    expect(off.attendance).toBeLessThanOrEqual(OFFICIAL_WAGE_DAYS);
    expect(off.attendance).toBeLessThan(row.daysWorked);
    expect(off.attendance).not.toBe(30);
  });

  it("0 <= attendance <= 26 for full-month and partial fixtures (PF on and off)", () => {
    const fixtures: EmployeeInput[] = [
      {
        id: "full-pf-off",
        name: "Full PF off",
        category: "Unskilled",
        monthlySalary: 0,
        salaryPerDay: 400,
        daysWorked: 30,
        extraDays: 0,
        pfOptIn: false,
        esiOptIn: true,
        otherDeduction: 0,
      },
      {
        id: "full-pf-on",
        name: "Full PF on",
        category: "Semi-skilled",
        monthlySalary: 18000,
        daysWorked: 30,
        extraDays: 0,
        pfOptIn: true,
        esiOptIn: true,
        otherDeduction: 0,
      },
      {
        id: "partial",
        name: "Partial",
        category: "Skilled",
        monthlySalary: 20000,
        daysWorked: 20,
        extraDays: 0,
        pfOptIn: true,
        esiOptIn: true,
        otherDeduction: 0,
      },
      {
        id: "zero",
        name: "Zero days",
        category: "Unskilled",
        monthlySalary: 0,
        salaryPerDay: 400,
        daysWorked: 0,
        extraDays: 0,
        pfOptIn: false,
        esiOptIn: false,
        otherDeduction: 0,
      },
    ];

    for (const f of fixtures) {
      const ref = refRow(f, 30);
      const off = buildOfficialRow(ref, 30);
      expect(off.attendance).toBeGreaterThanOrEqual(0);
      expect(off.attendance).toBeLessThanOrEqual(OFFICIAL_WAGE_DAYS);
    }
  });

  it("toggling pfOptIn does not change attendance when packing stays at A_max", () => {
    const base: EmployeeInput = {
      id: "toggle-pf",
      name: "Toggle PF",
      category: "Semi-skilled",
      monthlySalary: 16950,
      salaryPerDay: 400,
      bonusPerDay: 165,
      daysWorked: 27,
      extraDays: 0,
      pfOptIn: true,
      esiOptIn: true,
      otherDeduction: 0,
    };
    const withPf = buildOfficialRow(refRow({ ...base, pfOptIn: true }), 30);
    const withoutPf = buildOfficialRow(refRow({ ...base, pfOptIn: false }), 30);

    // Same calendar frame → same A_max; packing should not walk solely due to PF flag here.
    expect(withPf.attendance).toBe(withoutPf.attendance);
    // PF amount and basic formula may differ
    expect(withPf.pf).not.toBe(withoutPf.pf);
  });

  it("buildReferenceOfficialRow is not exported (single builder)", async () => {
    const mod = await import("../officialSheet");
    expect("buildReferenceOfficialRow" in mod).toBe(false);
    expect(typeof mod.buildOfficialRow).toBe("function");
  });
});
