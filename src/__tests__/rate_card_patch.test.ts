import { describe, expect, it } from "vitest";
import { applyRateCardPatch, isRateCardPatch, rateCardPatch } from "../../api/_lib/rateCard";
import { blankEmployee, buildRateMap, hydrateSavedMonth } from "../roster";
import type { EmployeeInput } from "../types";

const D = 30;

const employee = (over: Partial<EmployeeInput>): EmployeeInput => ({
  ...blankEmployee(D),
  ...over,
});

const asha = (over: Partial<EmployeeInput> = {}) =>
  employee({ id: "emp-asha", name: "Asha Patil", monthlySalary: 12000, ...over });

const ravi = (over: Partial<EmployeeInput> = {}) =>
  employee({ id: "emp-ravi", name: "Ravi Kale", monthlySalary: 9000, notes: "Hired in May", ...over });

describe("Rate Card patch", () => {
  it("an edit in an older month writes only the edited field and keeps absent employees", () => {
    const card = buildRateMap([asha({ notes: "Joined 2019" }), ravi()]);
    const olderMonth = hydrateSavedMonth([asha({ monthlySalary: 10000 })], D, card);
    const increment = { month: "April 2026", amount: 500 };
    const edited = olderMonth.map((row) => ({ ...row, increments: [increment] }));

    const stored = applyRateCardPatch(card, rateCardPatch(buildRateMap(olderMonth), buildRateMap(edited)));

    expect(stored["emp-asha"]).toMatchObject({ monthlySalary: 12000, notes: "Joined 2019" });
    expect(stored["emp-asha"].increments).toEqual([increment]);
    expect(stored["emp-ravi"]).toEqual(card["emp-ravi"]);
  });

  it("clearing a field removes it, and removing an employee keeps their entry", () => {
    const card = buildRateMap([asha({ notes: "Joined 2019" }), ravi()]);
    const loaded = [asha({ notes: "Joined 2019" }), ravi()];
    const edited = [asha({ notes: "" })];

    const stored = applyRateCardPatch(card, rateCardPatch(buildRateMap(loaded), buildRateMap(edited)));

    expect(stored["emp-asha"]).not.toHaveProperty("notes");
    expect(stored["emp-asha"].monthlySalary).toBe(12000);
    expect(stored["emp-ravi"].notes).toBe("Hired in May");
  });

  it("writes a new employee whole", () => {
    const patch = rateCardPatch({}, buildRateMap([ravi()]));

    expect(applyRateCardPatch({}, patch)).toEqual(buildRateMap([ravi()]));
  });

  it("accepts only an object of per-employee field objects", () => {
    expect(isRateCardPatch({})).toBe(true);
    expect(isRateCardPatch({ "emp-asha": { notes: null } })).toBe(true);
    expect(isRateCardPatch(undefined)).toBe(false);
    expect(isRateCardPatch([])).toBe(false);
    expect(isRateCardPatch({ "emp-asha": null })).toBe(false);
    expect(isRateCardPatch({ "emp-asha": [] })).toBe(false);
    expect(isRateCardPatch({ "emp-asha": "12000" })).toBe(false);
  });
});
