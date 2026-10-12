import { describe, expect, it } from "vitest";
import { applyRateCardPatch, isRateCardPatch, rateCardPatch } from "../../api/_lib/rateCard";
import { ratesSignature } from "../hooks/useMonthLifecycle";
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

  it("an employee missing from the roster for a while keeps their baseline, so they never return as new", () => {
    const olderMonth = hydrateSavedMonth([asha({ monthlySalary: 10000 })], D, buildRateMap([asha()]));
    const loaded = ratesSignature(olderMonth);
    const blanked = ratesSignature(olderMonth.map((row) => ({ ...row, name: "" })), loaded);

    expect(blanked).toBe(loaded);
    expect(ratesSignature(olderMonth, blanked)).toBe(loaded);
    expect(ratesSignature([], loaded)).toBe(loaded);
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

  it("an edit for an employee the card does not hold writes their whole entry", () => {
    const loaded = [asha({ salaryPerDay: 400, bonusPerDay: 50 })];
    const edited = [asha({ salaryPerDay: 400, bonusPerDay: 50, notes: "Joined 2019" })];

    const stored = applyRateCardPatch({}, rateCardPatch(buildRateMap(loaded), buildRateMap(edited)));

    expect(stored["emp-asha"]).toMatchObject({
      name: "Asha Patil",
      salaryPerDay: 400,
      bonusPerDay: 50,
      monthlySalary: 12000,
      notes: "Joined 2019",
    });
  });

  it("accepts only per-employee entries with the list of changed fields", () => {
    expect(isRateCardPatch({})).toBe(true);
    expect(isRateCardPatch({ "emp-asha": { entry: { name: "Asha" }, changed: ["notes"] } })).toBe(true);
    expect(isRateCardPatch(undefined)).toBe(false);
    expect(isRateCardPatch([])).toBe(false);
    expect(isRateCardPatch({ "emp-asha": null })).toBe(false);
    expect(isRateCardPatch({ "emp-asha": { notes: "x" } })).toBe(false);
    expect(isRateCardPatch({ "emp-asha": { entry: [], changed: [] } })).toBe(false);
    expect(isRateCardPatch({ "emp-asha": { entry: {}, changed: "notes" } })).toBe(false);
    expect(isRateCardPatch({ "emp-asha": { entry: {}, changed: [1] } })).toBe(false);
  });
});
