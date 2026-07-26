import { describe, expect, it } from "vitest";
import {
  OFFICIAL_WAGE_DAYS,
  buildOfficialRow,
  officialBasic,
  wageBoardCategory,
} from "../officialSheet";
import { calculateSalary, clampBasicPercent, roundMoney } from "../salary";
import type { EmployeeInput, SalaryRow } from "../types";
import { juneEmployees } from "../juneEmployees";

function refFrom(partial: EmployeeInput, monthDays = 30): SalaryRow {
  return calculateSalary(partial, {
    workingDays: monthDays,
    basicShare: clampBasicPercent(partial.basicPercent) / 100,
  });
}

const juneSpecials = juneEmployees.filter((e) => e.category === "Special");

describe("TICKET-12: Special Official presentation (SPEC A1)", () => {
  it("June has 6 Special employees", () => {
    expect(juneSpecials).toHaveLength(6);
  });

  it("Official sheet for all 6 Specials builds without throwing", () => {
    expect(() => {
      for (const emp of juneSpecials) {
        buildOfficialRow(refFrom(emp, 30), 30);
      }
    }).not.toThrow();
  });

  it("each Special: attendance 26, pf 0, esi 0, allowedBasic 12584, Skilled display types", () => {
    for (const emp of juneSpecials) {
      const ref = refFrom(emp, 30);
      const off = buildOfficialRow(ref, 30);
      expect(ref.category).toBe("Special");
      expect(ref.daysWorked).toBe(30);
      expect(ref.pfOptIn).toBe(false);
      expect(ref.esiOptIn).toBe(false);

      expect(off.attendance).toBe(26);
      expect(off.pf).toBe(0);
      expect(off.esi).toBe(0);
      expect(off.allowedBasic).toBe(12584);
      expect(off.sourceCategory).toBe("Special");
      expect(off.wageCategory).toBe("Skilled");
      expect(off.employeeTypes).toContain("Moulder");
    }
  });

  it("Special Official basic uses max(21100, 0.51×total) / 26 × A", () => {
    const emp = juneSpecials.find((e) => e.name === "Sonal Goenka")!;
    const ref = refFrom(emp, 30);
    const off = buildOfficialRow(ref, 30);
    const expectedFull = Math.max(21100, Math.round(ref.totalSalary * 0.51));
    expect(off.monthlyBasic).toBe(roundMoney(expectedFull)); // A=26 → full month rate
    expect(officialBasic(ref, wageBoardCategory("Special"), OFFICIAL_WAGE_DAYS)).toBe(
      roundMoney(expectedFull),
    );
    expect(officialBasic(ref, wageBoardCategory("Special"), 13)).toBe(
      roundMoney((expectedFull / 26) * 13),
    );
  });

  it("net equality holds for all 6 June Specials (I1)", () => {
    for (const emp of juneSpecials) {
      const ref = refFrom(emp, 30);
      const off = buildOfficialRow(ref, 30);
      expect(off.unpackable).toBe(false);
      expect(off.netPayable).toBeCloseTo(ref.netPayable, 2);
    }
  });

  it("Special with pfOptIn true throws a named invariant error", () => {
    const ref = refFrom({
      id: "broken-special",
      name: "Broken Special",
      category: "Special",
      monthlySalary: 60000,
      daysWorked: 30,
      extraDays: 0,
      pfOptIn: true,
      esiOptIn: false,
      otherDeduction: 0,
    });
    // calculateSalary forces PF off for Special — force the invariant breach on the row.
    const forced = { ...ref, pfOptIn: true, category: "Special" as const };
    expect(() => officialBasic(forced, wageBoardCategory("Special"), 26)).toThrow(
      /Invariant: Special employees cannot have PF on/,
    );
    expect(() => buildOfficialRow(forced, 30)).toThrow(
      /Invariant: Special employees cannot have PF on/,
    );
  });
});
