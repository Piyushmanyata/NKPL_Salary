/**
 * Issue #26 — payroll pipeline characterization seam.
 *
 * Persisted record + Rate Card → hydrate → scripted edits → engine → export bytes.
 * Expected values captured from current modules; must stay green through every phase.
 * Golden engine fixtures remain the money lock; this locks the path around them.
 */
import { describe, expect, it } from "vitest";
import { applyEmployeeEdit } from "../editEmployee";
import {
  buildOfficialExportRows,
  buildReferenceExportRows,
  serializeCsv,
  serializeSpreadsheetHtml,
} from "../exportSheet";
import { buildOfficialRow } from "../officialSheet";
import {
  applyEmployeeRates,
  buildRateMap,
  carryForwardEmployee,
  hydrateRoster,
  sanitizeEmployee,
} from "../roster";
import { alignReferenceEsi, calculateSalary, clampBasicPercent, roundMoney } from "../salary";
import type { EmployeeInput } from "../types";
import type { EmployeeRateMap } from "../db";

const D = 30;

const storedEmployees: unknown[] = [
  {
    id: "e1",
    name: "Ravi Kumar",
    category: "Skilled",
    monthlySalary: 15000,
    totalSalary: 18000,
    salaryPerDay: 500,
    bonusPerDay: 100,
    daysWorked: 28,
    extraDays: 1,
    basicPercent: 70,
    pfOptIn: true,
    esiOptIn: true,
    advance: 500,
    otherDeduction: 0,
    specialBonus: 200,
  },
  {
    id: "e2",
    name: "Unskilled Worker",
    category: "Unskilled",
    monthlySalary: 0,
    salaryPerDay: 400,
    bonusPerDay: 50,
    daysWorked: 26,
    extraDays: 0,
    basicPercent: 50,
    pfOptIn: true,
    esiOptIn: true,
    otherDeduction: 100,
  },
  {
    // legacy isSpecial → Special migration
    id: "e3",
    name: "Special Person",
    isSpecial: true,
    monthlySalary: 20000,
    totalSalary: 22000,
    daysWorked: 10,
    extraDays: 5,
    pfOptIn: true,
    esiOptIn: true,
    otherDeduction: 0,
  },
];

const rates: EmployeeRateMap = {
  e1: {
    id: "e1",
    name: "Ravi Kumar",
    salaryPerDay: 520,
    bonusPerDay: 110,
    monthlySalary: 15600,
    totalSalary: 18900,
    notes: "Apr-26 +600",
  },
};

function runPipeline(list: EmployeeInput[]) {
  const salaryRows = list.map((employee) => {
    const share = clampBasicPercent(employee.basicPercent) / 100;
    return calculateSalary(employee, { workingDays: D, basicShare: share });
  });
  const officialRows = salaryRows.map((row) => buildOfficialRow(row, D));
  const aligned = salaryRows.map((row, i) =>
    alignReferenceEsi(row, officialRows[i]!.esi, officialRows[i]!.employerEsi),
  );
  const refExport = buildReferenceExportRows(aligned);
  const offExport = buildOfficialExportRows(officialRows);
  return {
    nets: aligned.map((r) => roundMoney(r.netPayable)),
    officialNets: officialRows.map((r) => roundMoney(r.netPayable)),
    refCsv: serializeCsv(refExport),
    offCsv: serializeCsv(offExport),
    refHtml: serializeSpreadsheetHtml(refExport),
    offHtml: serializeSpreadsheetHtml(offExport),
  };
}

describe("pipeline characterization (#26)", () => {
  it("hydrates stored record with Rate Card overlay and legacy migration", () => {
    const roster = hydrateRoster(storedEmployees, D, rates);
    expect(roster).toHaveLength(3);

    const ravi = roster.find((e) => e.id === "e1")!;
    // Rate Card overlays standing package
    expect(ravi.monthlySalary).toBe(15600);
    expect(ravi.totalSalary).toBe(18900);
    expect(ravi.salaryPerDay).toBe(520);
    expect(ravi.bonusPerDay).toBe(110);
    expect(ravi.notes).toBe("Apr-26 +600");
    // per-month fields preserved from month record
    expect(ravi.daysWorked).toBe(28);
    expect(ravi.advance).toBe(500);
    expect(ravi.specialBonus).toBe(200);

    const special = roster.find((e) => e.id === "e3")!;
    expect(special.category).toBe("Special");
    expect(special.daysWorked).toBe(D); // Special forced to full month days
    expect(special.extraDays).toBe(0);
    expect(special.pfOptIn).toBe(false);
    expect(special.esiOptIn).toBe(false);
  });

  it("carry-forward resets manual inputs and keeps rates", () => {
    const roster = hydrateRoster(storedEmployees, D, rates);
    const carried = roster.map((e) => carryForwardEmployee(e, 31));
    expect(carried[0]!.daysWorked).toBe(31);
    expect(carried[0]!.extraDays).toBe(0);
    expect(carried[0]!.advance).toBeUndefined();
    expect(carried[0]!.specialBonus).toBeUndefined();
    expect(carried[0]!.monthlySalary).toBe(15600);
    expect(carried[0]!.category).toBe("Skilled");
  });

  it("scripted edits + engine + export bytes stay stable", () => {
    let roster = hydrateRoster(storedEmployees, D, rates);

    // Scripted user edits
    roster = roster.map((e) =>
      e.id === "e1" ? applyEmployeeEdit(e, "advance", 750, D) : e,
    );
    roster = roster.map((e) =>
      e.id === "e1" ? applyEmployeeEdit(e, "daysWorked", 29, D) : e,
    );
    roster = roster.map((e) =>
      e.id === "e2" ? applyEmployeeEdit(e, "salaryPerDay", 420, D) : e,
    );
    roster = roster.map((e) =>
      e.id === "e1" ? applyEmployeeEdit(e, "esiOverLimitOptIn", true, D) : e,
    );

    // Negative advance rejected
    roster = roster.map((e) =>
      e.id === "e2" ? applyEmployeeEdit(e, "advance", -10, D) : e,
    );
    expect(roster.find((e) => e.id === "e2")!.advance).toBeUndefined();

    const result = runPipeline(roster);

    // Characterization lock from current build (2026-08-06); e2 re-locked
    // 11,399 → 11,396 by ratio-based Official attendance (ADR-0013), which
    // raises that row's Official basic and so its 0.75% ESI charge.
    expect(result.nets).toEqual([16862.25, 11396, 19870]);
    expect(result.officialNets).toEqual([16862.25, 11396, 19870]);

    // Byte-level export locks
    expect(result.refCsv).toContain('"Ravi Kumar"');
    expect(result.refCsv).toContain('"-750"'); // display sign: recovered
    expect(result.offCsv).toContain('"Wage Category"');
    expect(result.refHtml).toContain('<table border="1"');
    expect(result.offHtml).toContain("Official Basic");

    // Full byte hashes via length + content fingerprint
    expect(result.refCsv.length).toBeGreaterThan(200);
    expect(result.offCsv.length).toBeGreaterThan(100);
    // Stable full-string lock for both formats of both sheets
    expect(result.refCsv).toMatchSnapshot("ref-csv");
    expect(result.offCsv).toMatchSnapshot("off-csv");
    expect(result.refHtml).toMatchSnapshot("ref-html");
    expect(result.offHtml).toMatchSnapshot("off-html");
  });

  it("buildRateMap records standing package for shared store", () => {
    const roster = hydrateRoster(storedEmployees, D, rates);
    const map = buildRateMap(roster);
    expect(map.e1?.monthlySalary).toBe(15600);
    expect(map.e1?.notes).toBe("Apr-26 +600");
    expect(map.e2?.salaryPerDay).toBe(400);
  });

  it("sanitize drops empty nameless zero-rate rows", () => {
    expect(sanitizeEmployee({ name: "", monthlySalary: 0 }, 0, D)).toBeNull();
  });

  it("applyEmployeeRates leaves unknown ids alone", () => {
    const list: EmployeeInput[] = [
      {
        id: "x",
        name: "Solo",
        category: "Skilled",
        monthlySalary: 10000,
        daysWorked: 30,
        extraDays: 0,
        otherDeduction: 0,
      },
    ];
    expect(applyEmployeeRates(list, {})[0]!.monthlySalary).toBe(10000);
  });
});
