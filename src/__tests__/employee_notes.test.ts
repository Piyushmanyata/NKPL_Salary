import { describe, expect, it } from "vitest";
import { calculateSalary } from "../salary";
import { buildOfficialRow } from "../officialSheet";
import { applyEmployeeRates, buildRateMap, hydrateRoster, hydrateSavedMonth } from "../roster";
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

describe("notes on a saved month", () => {
  const card = buildRateMap(
    hydrateRoster([base], 30).map((employee) => ({ ...employee, notes: "ID 44" })),
  );

  it("come from the Rate Card when the month record has none", () => {
    expect(hydrateSavedMonth([base], 30, card)[0].notes).toBe("ID 44");
  });

  it("survive from the month record for an employee the Rate Card does not hold", () => {
    expect(hydrateSavedMonth([{ ...base, notes: "ID 44" }], 30, {})[0].notes).toBe("ID 44");
  });

  it("stay cleared once cleared on the Rate Card, in saved and new months alike", () => {
    const cleared = buildRateMap(hydrateRoster([base], 30));
    const stale = { ...base, notes: "ID 44" };
    expect(hydrateSavedMonth([stale], 30, cleared)[0].notes).toBeUndefined();
    expect(applyEmployeeRates([stale], cleared)[0].notes).toBeUndefined();
  });

  it("prefer the Rate Card over the month record", () => {
    expect(hydrateSavedMonth([{ ...base, notes: "old" }], 30, card)[0].notes).toBe("ID 44");
  });

  it("rebuild the exact Rate Card that was loaded, so the auto-save erases nothing", () => {
    const loaded = hydrateSavedMonth([base], 30, card);
    expect(JSON.stringify(buildRateMap(loaded))).toBe(JSON.stringify(card));
  });

  it("do not bring the Rate Card's salary onto a saved month", () => {
    const raised = buildRateMap([{ ...base, monthlySalary: 25000, notes: "ID 44" }]);
    expect(hydrateSavedMonth([base], 30, raised)[0].monthlySalary).toBe(
      hydrateRoster([base], 30)[0].monthlySalary,
    );
  });
});
