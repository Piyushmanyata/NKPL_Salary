import { describe, expect, it } from "vitest";
import { applyEmployeeEdit } from "../editEmployee";
import { createExportDownload } from "../exportActions";
import { buildOfficialExportRows, buildReferenceExportRows } from "../exportSheet";
import { buildOfficialRow } from "../officialSheet";
import {
  applyEmployeeRates,
  buildRateMap,
  hydrateRoster,
  hydrateSavedMonth,
  sanitizeEmployee,
} from "../roster";
import { alignReferenceEsi, calculateSalary } from "../salary";
import type { EmployeeInput, SalaryRow } from "../types";

const D = 30;

const abhijeet = (over: Partial<EmployeeInput> = {}): EmployeeInput => ({
  id: "emp-am",
  name: "Abhijeet Mali",
  category: "Skilled",
  monthlySalary: 16000,
  totalSalary: 18000,
  salaryPerDay: 0,
  bonusPerDay: 0,
  daysWorked: 30,
  extraDays: 0,
  basicPercent: 70,
  pfOptIn: true,
  esiOptIn: true,
  otherDeduction: 0,
  ...over,
});

const sepRise = { month: "September 2026", amount: 1000, note: "annual" };
const octRise = { month: "October 2026", amount: 500 };

function referenceRow(employee: EmployeeInput): SalaryRow {
  const raw = calculateSalary(employee, { workingDays: D });
  const official = buildOfficialRow(raw, D);
  return alignReferenceEsi(raw, official.esi, official.employerEsi);
}

describe("Increments — Rate Card round trip", () => {
  it("are recorded through the one edit entry point", () => {
    const edited = applyEmployeeEdit(abhijeet(), "increments", [sepRise, octRise], D);
    expect(edited.increments).toEqual([sepRise, octRise]);
  });

  it("still throws for unknown fields", () => {
    expect(() => applyEmployeeEdit(abhijeet(), "id" as "increments", [], D)).toThrow(
      /Unknown employee field/,
    );
  });

  it("survive a save and a load into a different, already-saved month", () => {
    const september = applyEmployeeEdit(abhijeet(), "increments", [sepRise], D);
    const rates = buildRateMap([september]);

    const savedAugust = [abhijeet({ daysWorked: 25 })];
    const [august] = hydrateSavedMonth(savedAugust, 31, rates);
    expect(august!.increments).toEqual([sepRise]);
    expect(august!.daysWorked).toBe(25);

    const [carried] = hydrateRoster(savedAugust, 31, rates);
    expect(carried!.increments).toEqual([sepRise]);
  });

  it("keep a saved month's own salaries when only the history is overlaid", () => {
    const rates = buildRateMap([abhijeet({ monthlySalary: 17000, increments: [sepRise] })]);
    const [august] = hydrateSavedMonth([abhijeet()], 31, rates);
    expect(august!.monthlySalary).toBe(16000);
    expect(august!.totalSalary).toBe(18000);
    expect(august!.increments).toEqual([sepRise]);
  });

  it("deleting one removes it from every month, saved months included", () => {
    const both = abhijeet({ increments: [sepRise, octRise] });
    const afterDelete = applyEmployeeEdit(both, "increments", [octRise], D);
    const rates = buildRateMap([afterDelete]);

    expect(hydrateSavedMonth([both], 31, rates)[0]!.increments).toEqual([octRise]);
    expect(applyEmployeeRates([both], rates)[0]!.increments).toEqual([octRise]);
  });

  it("deleting the last one clears saved months and omits the field from the card", () => {
    const cleared = applyEmployeeEdit(abhijeet({ increments: [sepRise] }), "increments", [], D);
    expect(cleared.increments).toBeUndefined();

    const rates = buildRateMap([cleared]);
    expect(rates["emp-am"]).not.toHaveProperty("increments");
    expect(hydrateSavedMonth([abhijeet({ increments: [sepRise] })], 31, rates)[0]!.increments).toBeUndefined();
  });

  it("leave a saved month's history alone when the card has no entry for the employee", () => {
    const [august] = hydrateSavedMonth([abhijeet({ increments: [sepRise] })], 31, {});
    expect(august!.increments).toEqual([sepRise]);
  });

  it("drop entries with an unparseable month or a non-positive or non-numeric amount", () => {
    const messy = [
      { month: "nonsense", amount: 100 },
      { month: "", amount: 100 },
      { month: "Oct 2026", amount: 0 },
      { month: "Oct 2026", amount: -5 },
      { month: "Oct 2026", amount: "abc" },
      { month: "Oct 2026", amount: Number.POSITIVE_INFINITY },
      { month: "Oct 2026", amount: 1000.456 },
      "not an entry",
      null,
    ] as unknown as EmployeeInput["increments"];
    const kept = [{ month: "October 2026", amount: 1000.46 }];

    expect(applyEmployeeEdit(abhijeet(), "increments", messy, D).increments).toEqual(kept);
    expect(sanitizeEmployee(abhijeet({ increments: messy }), 0, D)?.increments).toEqual(kept);
    const rates = { "emp-am": { ...buildRateMap([abhijeet()])["emp-am"]!, increments: messy } };
    expect(applyEmployeeRates([abhijeet()], rates)[0]!.increments).toEqual(kept);
  });

  it("trim notes and omit blank ones", () => {
    const edited = applyEmployeeEdit(
      abhijeet(),
      "increments",
      [
        { month: "September 2026", amount: 1000, note: "  into Travelling  " },
        { month: "October 2026", amount: 500, note: "   " },
      ],
      D,
    );
    expect(edited.increments).toEqual([
      { month: "September 2026", amount: 1000, note: "into Travelling" },
      { month: "October 2026", amount: 500 },
    ]);
    expect(edited.increments![1]).not.toHaveProperty("note");
  });

  it("omit an empty list from the employee and from storage", () => {
    expect(sanitizeEmployee(abhijeet({ increments: [] }), 0, D)?.increments).toBeUndefined();
    expect(buildRateMap([abhijeet({ increments: [] })])["emp-am"]).not.toHaveProperty("increments");
  });

  it("are stored in chronological order, same-month entries kept as recorded", () => {
    const edited = applyEmployeeEdit(
      abhijeet(),
      "increments",
      [
        { month: "October 2026", amount: 500 },
        { month: "Sep 2026", amount: 300, note: "first" },
        { month: "October 2025", amount: 200 },
        { month: "September 2026", amount: 700, note: "second" },
      ],
      D,
    );
    expect(edited.increments).toEqual([
      { month: "October 2025", amount: 200 },
      { month: "September 2026", amount: 300, note: "first" },
      { month: "September 2026", amount: 700, note: "second" },
      { month: "October 2026", amount: 500 },
    ]);
  });
});

describe("Increments — Reference export", () => {
  const split = abhijeet({
    increments: [
      { month: "September 2026", amount: 1000, note: "annual" },
      { month: "September 2026", amount: 500 },
      { month: "October 2026", amount: 250 },
    ],
  });
  const plain = abhijeet({ id: "emp-x", name: "No Rise" });

  it("puts an Increment column right after Total Salary", () => {
    const [row] = buildReferenceExportRows([referenceRow(split)], "September 2026");
    const headers = Object.keys(row!);
    expect(headers[headers.indexOf("Total Salary") + 1]).toBe("Increment");
  });

  it("shows the month's total, blank for other months and for employees with none", () => {
    const rows = [referenceRow(split), referenceRow(plain)];
    const september = buildReferenceExportRows(rows, "September 2026");
    expect(september[0]!.Increment).toBe(1500);
    expect(september[1]!.Increment).toBe("");
    expect(buildReferenceExportRows(rows, "Sep 2026")[0]!.Increment).toBe(1500);
    expect(buildReferenceExportRows(rows, "August 2026")[0]!.Increment).toBe("");
  });

  it("reaches the downloaded Reference file for the exported month", () => {
    const result = createExportDownload({
      mode: "reference",
      companyName: "APTUS",
      monthLabel: "October 2026",
      salaryRows: [referenceRow(split)],
      officialRows: [],
      format: "csv",
    });
    if (!("download" in result)) throw new Error("export blocked");
    const [header, body] = String(result.download.content).split("\n");
    expect(header).toContain('"Total Salary","Increment"');
    expect(body).toContain('"18000","250"');
  });

  it("leaves the Official export unchanged", () => {
    const withRises = buildOfficialExportRows([buildOfficialRow(referenceRow(split), D)]);
    const without = buildOfficialExportRows([buildOfficialRow(referenceRow(abhijeet()), D)]);
    expect(withRises).toEqual(without);
    expect(buildOfficialRow(referenceRow(split), D)).not.toHaveProperty("increments");
  });
});

describe("Increments — pay invariance", () => {
  it("never change any calculated figure", () => {
    const without = referenceRow(abhijeet());
    const withRises = referenceRow(abhijeet({ increments: [sepRise, octRise] }));
    expect(withRises.netPayable).toBe(without.netPayable);
    expect(withRises.grossPayable).toBe(without.grossPayable);
    expect(withRises.basicSalary).toBe(without.basicSalary);
    expect(withRises.totalCost).toBe(without.totalCost);
    expect(buildOfficialRow(withRises, D).netPayable).toBe(buildOfficialRow(without, D).netPayable);
  });

  it("recording one never writes Travelling, salary or any rate", () => {
    const before = abhijeet({ salaryPerDay: 533.33, bonusPerDay: 66.67 });
    const after = applyEmployeeEdit(before, "increments", [sepRise], D);
    expect(after.monthlySalary).toBe(before.monthlySalary);
    expect(after.totalSalary).toBe(before.totalSalary);
    expect(after.salaryPerDay).toBe(before.salaryPerDay);
    expect(after.bonusPerDay).toBe(before.bonusPerDay);
  });
});
