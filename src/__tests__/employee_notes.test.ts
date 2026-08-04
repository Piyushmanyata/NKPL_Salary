import { describe, expect, it } from "vitest";
import { calculateSalary } from "../salary";
import { buildOfficialRow } from "../officialSheet";
import type { EmployeeInput } from "../types";

// Notes are a free-text log kept per employee (increments, remarks). They ride
// along on the row and must never move a single rupee.

const base: EmployeeInput = {
  id: "emp-n",
  name: "Noted",
  category: "Skilled",
  monthlySalary: 20000,
  totalSalary: 21500,
  salaryPerDay: 0,
  bonusPerDay: 0,
  daysWorked: 30,
  extraDays: 0,
  basicPercent: 70,
  pfOptIn: true,
  esiOptIn: true,
  otherDeduction: 0,
};

describe("employee notes", () => {
  it("never changes any calculated figure", () => {
    const without = calculateSalary(base, { workingDays: 30 });
    const withNotes = calculateSalary(
      { ...base, notes: "Apr-26 +500 allowance (now 1500)\nID 4471" },
      { workingDays: 30 },
    );
    expect(withNotes.netPayable).toBe(without.netPayable);
    expect(withNotes.grossPayable).toBe(without.grossPayable);
    expect(withNotes.basicSalary).toBe(without.basicSalary);
    expect(withNotes.totalCost).toBe(without.totalCost);
    expect(buildOfficialRow(withNotes, 30).netPayable).toBe(
      buildOfficialRow(without, 30).netPayable,
    );
  });

  it("carries multi-line text through the calculation unchanged", () => {
    const notes = "Apr-26 +500\nJul-26 +600\nAsked for a shift change";
    expect(calculateSalary({ ...base, notes }, { workingDays: 30 }).notes).toBe(notes);
  });
});
