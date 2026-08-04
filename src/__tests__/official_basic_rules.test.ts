import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  OFFICIAL_WAGE_DAYS,
  buildOfficialRow,
  officialBasic,
  officialEsi,
  officialPf,
  wageBoardCategory,
} from "../officialSheet";
import { alignReferenceEsi, calculateSalary, roundMoney } from "../salary";
import type { EmployeeInput, SalaryRow } from "../types";

const WAGE_BOARD_DAILY = {
  Unskilled: 400,
  "Semi-skilled": 440,
  Skilled: 484,
} as const;

function refRow(
  partial: EmployeeInput,
  monthDays = 30,
  options?: { basicShare?: number },
): SalaryRow {
  const raw = calculateSalary(partial, { workingDays: monthDays, ...options });
  const official = buildOfficialRow(raw, monthDays);
  return alignReferenceEsi(raw, official.esi, official.employerEsi);
}

/** SPEC §8 worked example — BIDYUT RAY, NKPL June 2026 (basicShare 70%). */
function bidyutRay(): SalaryRow {
  return refRow(
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
    { basicShare: 0.7 },
  );
}

describe("TICKET-08: Official basic = wage board when PF on; no ₹15k display cap", () => {
  it("BIDYUT RAY: Official basic 12,584 / PF 1,510.08 / gross 23,867.08 / net 22,227 (re-pinned by issue #24; prior 23,866.92 / 22,226.84)", () => {
    const ref = bidyutRay();
    expect(ref.netPayable).toBeCloseTo(22227, 2);

    const off = buildOfficialRow(ref, 30);
    expect(off.attendance).toBe(26);
    expect(off.monthlyBasic).toBe(12584);
    expect(off.pf).toBe(1510.08);
    expect(off.esi).toBe(0);
    expect(off.grossPayable).toBeCloseTo(23867.08, 2);
    expect(off.netPayable).toBeCloseTo(22227, 2);
    expect(off.netPayable).toBeCloseTo(ref.netPayable, 2);
  });

  it("PF-on: officialBasic === A × wageBoardDaily for every category and A", () => {
    for (const category of ["Unskilled", "Semi-skilled", "Skilled"] as const) {
      const row = refRow({
        id: `pf-on-${category}`,
        name: category,
        category,
        monthlySalary: category === "Unskilled" ? 0 : 20000,
        salaryPerDay: category === "Unskilled" ? 500 : undefined,
        bonusPerDay: 0,
        daysWorked: 26,
        extraDays: 0,
        pfOptIn: true,
        esiOptIn: true,
        otherDeduction: 0,
      });
      // Force PF on even if auto-off for high basic
      const forced = { ...row, pfOptIn: true as const };
      const wage = wageBoardCategory(category);
      const daily = WAGE_BOARD_DAILY[wage];
      for (const A of [1, 13, 26]) {
        expect(officialBasic(forced, wage, A)).toBe(roundMoney(A * daily));
      }
    }
  });

  it("PF-on + ESI-off uses wage board, not the ₹21,100 opt-out elevation", () => {
    const row = bidyutRay();
    const wage = wageBoardCategory(row.category);
    expect(row.pfOptIn).toBe(true);
    expect(row.esiOptIn).toBe(false);
    expect(officialBasic(row, wage, 26)).toBe(12584);
    expect(officialBasic(row, wage, 26)).not.toBe(21100);
    expect(officialBasic(row, wage, 26)).not.toBe(15000);
  });

  it("Math.min(..., PF_BASIC_LIMIT) appears only once in officialSheet.ts (inside officialPf)", () => {
    const src = readFileSync(join(__dirname, "../officialSheet.ts"), "utf8");
    const matches = src.match(/Math\.min\([^)]*PF_BASIC_LIMIT/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(src).toMatch(/export function officialPf[\s\S]*Math\.min\([^)]*PF_BASIC_LIMIT/);
  });

  it("officialPf still caps contribution at 0.12 × 15,000 = 1,800 when basic exceeds ₹15,000", () => {
    const row = refRow({
      id: "high-basic-pf",
      name: "High basic PF",
      category: "Skilled",
      monthlySalary: 20000,
      daysWorked: 26,
      extraDays: 0,
      pfOptIn: true,
      esiOptIn: true,
      otherDeduction: 0,
    });
    const forced = { ...row, pfOptIn: true as const };
    // Injected basic above wage board / EPF ceiling — contribution ceiling only.
    expect(officialPf(forced, 20000)).toBe(1800);
    expect(officialPf(forced, 15000)).toBe(1800);
    expect(officialPf(forced, 12584)).toBe(1510.08);
  });

  it("ESI-opted-out, PF-off employee still gets the ₹21,100 floor (prorated on 26)", () => {
    const row = refRow({
      id: "opt-out-floor",
      name: "Opt Out Floor",
      category: "Skilled",
      monthlySalary: 20000, // 0.51 × total may be lower than 21100
      daysWorked: 30,
      extraDays: 0,
      pfOptIn: false,
      esiOptIn: false,
      otherDeduction: 0,
    });
    const wage = wageBoardCategory(row.category);
    expect(row.pfOptIn).toBe(false);
    expect(row.esiOptIn).toBe(false);
    expect(officialBasic(row, wage, OFFICIAL_WAGE_DAYS)).toBe(21100);
    expect(officialBasic(row, wage, 13)).toBe(roundMoney((21100 / 26) * 13));
  });

  it("PF-off + ESI-on uses the ₹15,100 floor when 0.51×total is lower", () => {
    const row = refRow({
      id: "pf-off-esi-on",
      name: "PF off ESI on",
      category: "Unskilled",
      monthlySalary: 0,
      salaryPerDay: 500,
      bonusPerDay: 0,
      daysWorked: 30,
      extraDays: 0,
      pfOptIn: false,
      esiOptIn: true,
      otherDeduction: 0,
    });
    const wage = wageBoardCategory(row.category);
    expect(row.pfOptIn).toBe(false);
    expect(row.esiOptIn).toBe(true);
    // totalSalary = 15000 → 0.51× = 7650 → floor 15100
    expect(officialBasic(row, wage, 26)).toBe(15100);
  });

  it("net equality holds for BIDYUT and mixed PF/ESI fixtures", () => {
    const cases: Array<{ input: EmployeeInput; basicShare?: number }> = [
      {
        input: {
          id: "bidyut-eq",
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
        basicShare: 0.7,
      },
      {
        input: {
          id: "both-on",
          name: "Both on",
          category: "Semi-skilled",
          monthlySalary: 18000,
          daysWorked: 30,
          extraDays: 0,
          pfOptIn: true,
          esiOptIn: true,
          otherDeduction: 0,
        },
      },
      {
        input: {
          id: "both-off",
          name: "Both off",
          category: "Skilled",
          monthlySalary: 45000,
          daysWorked: 25,
          extraDays: 0,
          pfOptIn: false,
          esiOptIn: false,
          otherDeduction: 500,
        },
      },
    ];

    for (const c of cases) {
      const ref = refRow(c.input, 30, c.basicShare != null ? { basicShare: c.basicShare } : undefined);
      const off = buildOfficialRow(ref, 30);
      expect(off.netPayable).toBeCloseTo(ref.netPayable, 2);
    }
  });

  it("officialEsi stays 0 when ESI is opted out even if PF is on and basic is under ₹21,000", () => {
    const ref = bidyutRay();
    const off = buildOfficialRow(ref, 30);
    expect(off.monthlyBasic).toBeLessThanOrEqual(21000);
    expect(off.pf).toBeGreaterThan(0);
    expect(off.esi).toBe(0);
    expect(officialEsi(ref, off.monthlyBasic)).toBe(0);
  });
});
