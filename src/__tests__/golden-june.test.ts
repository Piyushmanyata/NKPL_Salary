/**
 * TICKET-14 — golden-master lock for June 2026 rosters.
 *
 * Expected money is recomputed from the SPEC-aligned engine
 * (scripts/gen-golden-fixtures.mjs), NOT copied from the stale 2026-07-07
 * .xls exports (see TICKET-15 / docs/archive/).
 *
 * NKPL inputs: src/juneEmployees.ts (corrected seed, 51 rows).
 * APTUS inputs: fixtures/aptus-june-inputs.json (36 rows from archive
 * structural columns; money re-derived).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildOfficialRow } from "../officialSheet";
import { alignReferenceEsi, calculateSalary, clampBasicPercent, roundMoney } from "../salary";
import { juneEmployees } from "../juneEmployees";
import type { EmployeeInput } from "../types";

type GoldenFile = {
  monthDays: number;
  roster: string;
  rows: Array<{
    id: string;
    name: string;
    category: string;
    reference: Record<string, number | boolean>;
    official: Record<string, number | boolean>;
  }>;
};

function loadGolden(name: string): GoldenFile {
  return JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf8")) as GoldenFile;
}

function compute(emp: EmployeeInput, monthDays: number) {
  const share = clampBasicPercent(emp.basicPercent) / 100;
  const raw = calculateSalary(emp, { workingDays: monthDays, basicShare: share });
  const off = buildOfficialRow(raw, monthDays);
  const ref = alignReferenceEsi(raw, off.esi, off.employerEsi);
  return { ref, off };
}

function assertClose(
  actual: number,
  expected: number,
  label: string,
  digits = 2,
) {
  expect(actual, label).toBeCloseTo(expected, digits);
}

describe("TICKET-14: golden-master June 2026", () => {
  it("NKPL juneEmployees locks every Reference and Official money field", () => {
    const golden = loadGolden("golden-nkpl-june-2026.json");
    expect(golden.rows).toHaveLength(51);
    expect(juneEmployees).toHaveLength(51);

    let unpackable = 0;
    for (let i = 0; i < juneEmployees.length; i += 1) {
      const emp = juneEmployees[i]!;
      const g = golden.rows[i]!;
      expect(emp.name).toBe(g.name);
      expect(emp.category).toBe(g.category);

      const { ref, off } = compute(emp, golden.monthDays);
      if (off.unpackable) unpackable += 1;

      assertClose(ref.netPayable, Number(g.reference.netPayable), `${emp.name} ref net`);
      assertClose(ref.grossPayable, Number(g.reference.grossPayable), `${emp.name} ref gross`);
      assertClose(ref.employeePf, Number(g.reference.employeePf), `${emp.name} ref pf`);
      assertClose(ref.esi, Number(g.reference.esi), `${emp.name} ref esi`);
      assertClose(ref.professionalTax, Number(g.reference.professionalTax), `${emp.name} ref pt`);
      assertClose(ref.basicSalary, Number(g.reference.basicSalary), `${emp.name} ref basic`);

      assertClose(off.netPayable, Number(g.official.netPayable), `${emp.name} off net`);
      assertClose(off.grossPayable, Number(g.official.grossPayable), `${emp.name} off gross`);
      assertClose(off.monthlyBasic, Number(g.official.monthlyBasic), `${emp.name} off basic`);
      assertClose(off.pf, Number(g.official.pf), `${emp.name} off pf`);
      assertClose(off.esi, Number(g.official.esi), `${emp.name} off esi`);
      expect(off.attendance, emp.name).toBe(g.official.attendance);
      expect(off.unpackable, emp.name).toBe(g.official.unpackable);

      if (!off.unpackable) {
        expect(off.netPayable).toBeCloseTo(ref.netPayable, 2);
      }
    }
    expect(unpackable).toBe(0);

    const netTotal = roundMoney(
      juneEmployees.reduce((s, e) => s + compute(e, 30).ref.netPayable, 0),
    );
    expect(netTotal).toBeCloseTo(
      roundMoney(golden.rows.reduce((s, r) => s + Number(r.reference.netPayable), 0)),
      2,
    );
  });

  it("APTUS June 2026 fixtures lock every Reference and Official money field", () => {
    const inputs = JSON.parse(
      readFileSync(join(__dirname, "fixtures", "aptus-june-inputs.json"), "utf8"),
    ) as EmployeeInput[];
    const golden = loadGolden("golden-aptus-june-2026.json");
    expect(inputs).toHaveLength(36);
    expect(golden.rows).toHaveLength(36);

    let unpackable = 0;
    for (let i = 0; i < inputs.length; i += 1) {
      const emp = inputs[i]!;
      const g = golden.rows[i]!;
      expect(emp.name).toBe(g.name);

      const { ref, off } = compute(emp, golden.monthDays);
      if (off.unpackable) unpackable += 1;

      assertClose(ref.netPayable, Number(g.reference.netPayable), `${emp.name} ref net`);
      assertClose(ref.grossPayable, Number(g.reference.grossPayable), `${emp.name} ref gross`);
      assertClose(off.netPayable, Number(g.official.netPayable), `${emp.name} off net`);
      assertClose(off.monthlyBasic, Number(g.official.monthlyBasic), `${emp.name} off basic`);
      expect(off.attendance, emp.name).toBe(g.official.attendance);
      expect(off.unpackable, emp.name).toBe(g.official.unpackable);
      if (!off.unpackable) {
        expect(off.netPayable).toBeCloseTo(ref.netPayable, 2);
      }
    }
    expect(unpackable).toBe(0);
  });

  it("BIDYUT RAY and known HANDOFF figures remain locked", () => {
    const bidyut = juneEmployees.find((e) => e.name === "BIDYUT RAY");
    expect(bidyut).toBeDefined();
    const { ref, off } = compute(bidyut!, 30);
    // Re-pinned for the Reference Daily Bonus Amount floor. Prior values:
    // gross 23,866.92 · net 22,226.84 · Ashok ref net 16,557.
    expect(off.monthlyBasic).toBe(8228);
    expect(off.pf).toBe(987.36);
    expect(off.grossPayable).toBeCloseTo(23344.36, 2);
    expect(off.netPayable).toBeCloseTo(22227, 2);
    expect(ref.netPayable).toBeCloseTo(22227, 2);

    const ashok = juneEmployees.find((e) => e.name === "Ashok Ram");
    expect(ashok).toBeDefined();
    const ashokRef = compute(ashok!, 30).ref;
    expect(ashokRef.netPayable).toBeCloseTo(16602.4, 2);
  });
});
