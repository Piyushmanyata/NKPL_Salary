import { describe, expect, it } from "vitest";
import { buildOfficialRow } from "../officialSheet";
import { calculateSalary } from "../salary";
import type { EmployeeInput } from "../types";

describe("Issue #3: Dual-sheet statutory math & Net Equality Packing", () => {
  it("Reference ESI: ROUNDUP(0.75% of Earned Salary) when Total Salary <= 21,000; employer ESI 3.25% on same base", () => {
    const input: EmployeeInput = {
      id: "emp-ref-esi",
      name: "ESI Eligible Worker",
      category: "Unskilled",
      monthlySalary: 15000,
      salaryPerDay: 500,
      bonusPerDay: 0,
      daysWorked: 30,
      extraDays: 0,
      pfOptIn: false,
      esiOptIn: true,
      otherDeduction: 0,
    };

    const ref = calculateSalary(input, { workingDays: 30 });
    expect(ref.totalSalary).toBeLessThanOrEqual(21000);
    expect(ref.esiOptIn).toBe(true);
    expect(ref.esi).toBe(Math.ceil(ref.earnedSalary * 0.0075));
    expect(ref.employerEsi).toBe(Math.ceil(ref.earnedSalary * 0.0325));
  });

  it("Reference ESI excludes performanceBonus and specialBonus — base is Earned Salary, not Gross", () => {
    const input: EmployeeInput = {
      id: "emp-bonus-esi",
      name: "Bonus Worker",
      category: "Unskilled",
      monthlySalary: 12000,
      salaryPerDay: 400,
      bonusPerDay: 0,
      daysWorked: 30,
      extraDays: 2, // performanceBonus = 800
      specialBonus: 1000,
      pfOptIn: false,
      esiOptIn: true,
      otherDeduction: 0,
    };

    const ref = calculateSalary(input, { workingDays: 30 });
    // grossPayable = 12000 + 800 + 1000 = 13800, but ESI rides earnedSalary = 12000
    expect(ref.grossPayable).toBe(13800);
    expect(ref.earnedSalary).toBe(12000);
    expect(ref.esi).toBe(Math.ceil(12000 * 0.0075));
  });

  it("Reference PF: 12% of min(basic, 15,000); auto-off when full-month basic > 15,000", () => {
    const inputHighBasic: EmployeeInput = {
      id: "emp-high-pf",
      name: "High Basic Officer",
      category: "Skilled",
      monthlySalary: 50000, // basicShare = 70% -> standardBasic = 35,000 > 15,000 -> PF auto off
      salaryPerDay: 0,
      bonusPerDay: 0,
      daysWorked: 30,
      extraDays: 0,
      pfOptIn: true,
      esiOptIn: false,
      otherDeduction: 0,
    };

    const ref = calculateSalary(inputHighBasic, { workingDays: 30 });
    expect(ref.pfOptIn).toBe(false);
    expect(ref.employeePf).toBe(0);
  });

  it("Official ESI does NOT get forced on merely because PF is on when Official basic > 21,000", () => {
    const input: EmployeeInput = {
      id: "emp-pf-no-esi",
      name: "High Basic Opt-Out",
      category: "Skilled",
      monthlySalary: 18000,
      daysWorked: 30,
      extraDays: 0,
      pfOptIn: true,
      esiOptIn: false, // Explicitly opted out of ESI
      otherDeduction: 0,
    };

    const ref = calculateSalary(input, { workingDays: 30 });
    const off = buildOfficialRow(ref, 30);

    // ESI must be 0 because ESI is opted out, despite PF being ON!
    expect(off.pf).toBeGreaterThan(0);
    expect(off.esi).toBe(0);
  });

  it("handles divergent PF/ESI across sheets while keeping Net Payable equal", () => {
    const input: EmployeeInput = {
      id: "emp-divergent",
      name: "Divergent Worker",
      category: "Semi-skilled",
      monthlySalary: 18000,
      salaryPerDay: 600,
      bonusPerDay: 100,
      daysWorked: 30,
      extraDays: 0,
      pfOptIn: true,
      esiOptIn: true,
      otherDeduction: 0,
    };

    const ref = calculateSalary(input, { workingDays: 30 });
    const off = buildOfficialRow(ref, 30);

    // Reference ESI is computed on Earned Salary; Official ESI on Official Basic (11,440)
    expect(ref.esi).toBe(Math.ceil(ref.earnedSalary * 0.0075));
    expect(off.esi).toBe(Math.round(off.monthlyBasic * 0.0075 * 100) / 100);
    expect(off.esi).not.toBe(ref.esi); // Divergent!
    expect(off.netPayable).toBeCloseTo(ref.netPayable, 2); // Net Equality preserved!
  });

  it("Guarantees Official Net Payable == Reference Net Payable (ADR 0001) across diverse fixtures", () => {
    const fixtures: EmployeeInput[] = [
      {
        id: "fix-1",
        name: "Standard Semi-Skilled",
        category: "Semi-skilled",
        monthlySalary: 16950,
        salaryPerDay: 400,
        bonusPerDay: 165,
        daysWorked: 27,
        extraDays: 1,
        pfOptIn: true,
        esiOptIn: true,
        advance: 1000,
        otherDeduction: 100,
      },
      {
        id: "fix-2",
        name: "Labour Daily Paid",
        category: "Unskilled",
        monthlySalary: 0,
        salaryPerDay: 350,
        bonusPerDay: 50,
        daysWorked: 28,
        extraDays: 0,
        pfOptIn: true,
        esiOptIn: true,
        otherDeduction: 0,
      },
      {
        id: "fix-3",
        name: "Special Director",
        category: "Special",
        monthlySalary: 60000,
        daysWorked: 30,
        extraDays: 0,
        pfOptIn: false,
        esiOptIn: false,
        otherDeduction: 0,
      },
      {
        id: "fix-4",
        name: "Opt Out Employee",
        category: "Skilled",
        monthlySalary: 45000,
        daysWorked: 25,
        extraDays: 0,
        pfOptIn: false,
        esiOptIn: false,
        otherDeduction: 500,
      },
    ];

    fixtures.forEach((fix) => {
      const ref = calculateSalary(fix, { workingDays: 30 });
      const off = buildOfficialRow(ref, 30);
      expect(off.netPayable).toBeCloseTo(ref.netPayable, 2);
    });
  });
});
