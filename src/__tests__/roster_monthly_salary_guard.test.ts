import { describe, expect, it } from "vitest";
import { juneEmployees } from "../juneEmployees";
import { sampleEmployees } from "../sampleEmployees";
import type { EmployeeInput } from "../types";

/**
 * TICKET-05 — monthlySalary is base salary only (r × 30), never the total
 * package (r + b) × 30. Bundled seed rosters must not reintroduce this.
 */
function assertBaseMonthlySalary(roster: EmployeeInput[], label: string) {
  for (const e of roster) {
    if (e.category === "Special") continue;
    if (!e.salaryPerDay || !e.bonusPerDay) continue;

    const base = e.salaryPerDay * 30;
    const totalPackage = (e.salaryPerDay + e.bonusPerDay) * 30;

    expect(
      Math.abs(e.monthlySalary - base),
      `${label}: ${e.name} monthlySalary=${e.monthlySalary} should be base ${base} (r×30)`,
    ).toBeLessThanOrEqual(15);

    expect(
      Math.abs(e.monthlySalary - totalPackage),
      `${label}: ${e.name} monthlySalary must not equal total package ${totalPackage}`,
    ).toBeGreaterThan(15);
  }
}

describe("TICKET-05: bundled roster monthlySalary is base only", () => {
  it("juneEmployees: monthlySalary ≈ salaryPerDay × 30, not (salary+bonus)×30", () => {
    assertBaseMonthlySalary(juneEmployees, "juneEmployees");
  });

  it("sampleEmployees: monthlySalary ≈ salaryPerDay × 30, not (salary+bonus)×30", () => {
    assertBaseMonthlySalary(sampleEmployees, "sampleEmployees");
  });

  it("SISIR HEMRAM resolves to r=400, M=12000, totalSalary=16950", () => {
    const sisir = juneEmployees.find((e) => e.name === "SISIR HEMRAM");
    expect(sisir).toBeDefined();
    expect(sisir!.salaryPerDay).toBe(400);
    expect(sisir!.monthlySalary).toBe(12000);
    expect(sisir!.bonusPerDay).toBe(165);
    // totalSalary = M + D×b = 12000 + 30×165 = 16950
    expect(sisir!.monthlySalary + 30 * (sisir!.bonusPerDay ?? 0)).toBe(16950);
  });

  // UTTAM DAS / PRIYOJIT GHOSH appear on the July payroll records; keep them
  // in both standing seeds so month carry-forward preserves the roster.
  it("standing seeds include UTTAM DAS and PRIYOJIT GHOSH", () => {
    for (const [label, roster] of [
      ["juneEmployees", juneEmployees],
      ["sampleEmployees", sampleEmployees],
    ] as const) {
      expect(
        roster.some((e) => e.name === "UTTAM DAS"),
        `${label} missing UTTAM DAS`,
      ).toBe(true);
      expect(
        roster.some((e) => e.name === "PRIYOJIT GHOSH"),
        `${label} missing PRIYOJIT GHOSH`,
      ).toBe(true);
    }
  });
});
