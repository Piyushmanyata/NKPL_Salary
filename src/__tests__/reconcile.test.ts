import { describe, expect, it } from "vitest";
import { normalizeKey, parseAttendanceExcel } from "../attendance";
import { reconcile, type Conflict } from "../reconcile";
import type { AttendanceEmployee, AttendanceMetaV1, EmployeeInput } from "../types";
import nkplManual from "./fixtures/nkpl-july-2026-manual.json";
import nkplBio from "./fixtures/nkpl-july-2026-biometric.json";
import aptusManual from "./fixtures/aptus-may-2026-manual.json";
import aptusBio from "./fixtures/aptus-may-2026-biometric.json";

function rosterFrom(
  people: Array<{ name: string; isSecurity?: boolean }>
): EmployeeInput[] {
  return people.map((p, i) => ({
    id: `r-${i + 1}`,
    name: p.name,
    category: "Unskilled" as const,
    isSecurity: p.isSecurity === true,
    monthlySalary: 0,
    daysWorked: 0,
    extraDays: 0,
    otherDeduction: 0,
  }));
}

function countByKind(conflicts: Conflict[], kind: Conflict["kind"]) {
  return conflicts.filter((c) => c.kind === kind).length;
}

function emptyMeta(company: string, map: Record<string, string> = {}): AttendanceMetaV1 {
  return { v: 1, c: company, u: new Date().toISOString(), map, excluded: [] };
}

/** Biometric-name normalizeKey → manual-name normalizeKey (grill-session pairs). */
const NKPL_BIO_TO_MANUAL: Record<string, string> = {
  tapaskumar: "tapaschandrakumar",
  sisirheram: "sisirhemram",
  alida: "sksajamalali",
  surajitkole: "surojitkoley",
  bisajitpal: "biswajitpal",
  balaswarsah: "baleswarsaha",
  abhijitmaji: "abhijitmajhi",
  ajaymalik: "ajoymalik",
  ashis: "asishdastanti",
  nitishyadab: "nitishkumar",
  kamalsaha: "kamalkrishnasaha",
  miraprasad: "miradi",
  karabichakraborty: "karabichakrabarty",
  susantaghosh: "sushantaghosh",
  saumya: "saumyaroy",
  sunil: "sunilsahani",
  guruprasad: "guruprasadpatra",
};

function buildMap(
  bio: AttendanceEmployee[],
  roster: EmployeeInput[],
  aliases: Record<string, string> = {}
): Record<string, string> {
  const rosterByKey = new Map(roster.map((r) => [normalizeKey(r.name), r]));
  const used = new Set<string>();
  const map: Record<string, string> = {};
  for (const b of bio) {
    const bk = normalizeKey(b.name);
    const targetKey = aliases[bk] || bk;
    let r = rosterByKey.get(targetKey);
    if (!r) {
      const cands = roster.filter((x) => {
        const k = normalizeKey(x.name);
        return (k.includes(bk) || bk.includes(k)) && !used.has(x.id);
      });
      if (cands.length === 1) r = cands[0];
    }
    if (r && !used.has(r.id)) {
      map[b.biometricId || b.id] = r.id;
      used.add(r.id);
    }
  }
  return map;
}

describe("reconcile NKPL July 2026 (HANDOFF §5)", () => {
  const manual = parseAttendanceExcel(nkplManual as any[][], []);
  const bio = parseAttendanceExcel(nkplBio as any[][], []);
  const roster = rosterFrom(
    manual.employees.map((e) => ({ name: e.name, isSecurity: e.isSecurity }))
  );
  // Align manual parse ids to roster ids for findUniqueMatch path
  const manualAligned = manual.employees.map((e) => {
    const r = roster.find((x) => normalizeKey(x.name) === normalizeKey(e.name));
    return r ? { ...e, id: r.id, isSecurity: r.isSecurity || e.isSecurity } : e;
  });
  const map = buildMap(bio.employees, roster, NKPL_BIO_TO_MANUAL);
  const meta = emptyMeta("NKPL", map);

  const { employees, conflicts } = reconcile({
    manual: manualAligned,
    biometric: bio.employees,
    roster,
    meta,
    monthLabel: "July 2026",
  });

  it("employee counts and missing/unmapped biometric", () => {
    expect(manual.employees.length).toBe(44);
    expect(bio.employees.length).toBe(38);
    expect(countByKind(conflicts, "missing-biometric")).toBe(7);
    expect(countByKind(conflicts, "unmapped-biometric")).toBe(1);
    const missingNames = conflicts
      .filter((c) => c.kind === "missing-biometric")
      .map((c) => c.name)
      .sort();
    expect(missingNames).toEqual(
      [
        "TANMOY DASTANTI",
        "KEYA PATRA",
        "MONAJ CHATTERJEE",
        "PARIMAL GHOSH",
        "GOUTAM MALIK",
        "PINTU POREL",
        "PANCHA MALIK",
      ].sort()
    );
    const unmapped = conflicts.find((c) => c.kind === "unmapped-biometric");
    expect(unmapped?.name.toLowerCase()).toContain("joy");
  });

  it("day conflict counts", () => {
    expect(countByKind(conflicts, "sheet-present-short-stay")).toBe(73);
    expect(countByKind(conflicts, "sheet-present-no-punch")).toBe(10);
    expect(countByKind(conflicts, "punched-sheet-absent")).toBe(49);
  });

  it("agreeing employee-days = 1064 (old bio-present = punch && !shortStay)", () => {
    const sheetPresentBioAbsent =
      countByKind(conflicts, "sheet-present-short-stay") +
      countByKind(conflicts, "sheet-present-no-punch");
    expect(sheetPresentBioAbsent).toBe(83);

    let agreeCount = 0;
    let totalJoinedDays = 0;
    for (const emp of employees) {
      if (!emp.biometricId) continue;
      const man = manualAligned.find((m) => m.id === emp.id || m.name === emp.name);
      const bEmp = bio.employees.find(
        (x) => (x.biometricId || x.id) === emp.biometricId
      );
      if (!man || !bEmp) continue;
      const D = Math.min(man.daysDetail.length, bEmp.daysDetail.length);
      for (let i = 0; i < D; i++) {
        totalJoinedDays++;
        const sp = man.daysDetail[i].isPresent;
        // Spec §2.2 table used duration-based bio presence (pre-ADR-0005)
        const bp =
          bEmp.daysDetail[i].punchTimes.length > 0 && !bEmp.daysDetail[i].isShortStay;
        if (sp === bp) agreeCount++;
      }
    }
    expect(totalJoinedDays).toBe(1147);
    expect(agreeCount).toBe(1064);
  });

  it("guards keep Dw=29 Xd=2 with missing-biometric (A8)", () => {
    const monaj = employees.find((e) => /MONAJ/i.test(e.name));
    const parimal = employees.find((e) => /PARIMAL/i.test(e.name));
    expect(monaj?.presentDays).toBe(29);
    expect(parimal?.presentDays).toBe(29);
    expect(monaj?.doubleShiftDays).toBe(2);
    expect(parimal?.doubleShiftDays).toBe(2);
    expect(monaj?.extraDaysTotal).toBe(2);
    expect(parimal?.extraDaysTotal).toBe(2);
  });
});

describe("reconcile APTUS May 2026", () => {
  const manual = parseAttendanceExcel(aptusManual as any[][], []);
  const bio = parseAttendanceExcel(aptusBio as any[][], []);
  const roster = rosterFrom(
    manual.employees.map((e) => ({ name: e.name, isSecurity: e.isSecurity }))
  );
  const manualAligned = manual.employees.map((e) => {
    const r = roster.find((x) => normalizeKey(x.name) === normalizeKey(e.name));
    return r ? { ...e, id: r.id, isSecurity: r.isSecurity || e.isSecurity } : e;
  });
  const map = buildMap(bio.employees, roster);
  const { employees } = reconcile({
    manual: manualAligned,
    biometric: bio.employees,
    roster,
    meta: emptyMeta("APTUS", map),
    monthLabel: "May 2026",
  });

  it("Somnath Dw=31 Xd=0; employee counts", () => {
    const som = employees.find((e) => /somnath/i.test(e.name));
    expect(som?.presentDays).toBe(31);
    expect(som?.extraDaysTotal).toBe(0);
    expect(manual.employees.length).toBe(32);
    expect(bio.employees.length).toBe(32);
  });
});

describe("A7 exclusion", () => {
  it("excluded employees contribute no stats or conflicts", () => {
    const manual = parseAttendanceExcel(nkplManual as any[][], []);
    const bio = parseAttendanceExcel(nkplBio as any[][], []);
    const roster = rosterFrom(manual.employees.map((e) => ({ name: e.name })));
    const manualAligned = manual.employees.map((e) => {
      const r = roster.find((x) => normalizeKey(x.name) === normalizeKey(e.name));
      return r ? { ...e, id: r.id } : e;
    });
    const map = buildMap(bio.employees, roster, NKPL_BIO_TO_MANUAL);
    const { employees, conflicts } = reconcile({
      manual: manualAligned,
      biometric: bio.employees,
      roster,
      meta: {
        v: 1,
        c: "NKPL",
        u: "",
        map,
        excluded: ["goutammalik", "pintuporel", "panchamalik"],
      },
      monthLabel: "July 2026",
    });
    expect(employees.find((e) => /GOUTAM/i.test(e.name))).toBeUndefined();
    expect(conflicts.find((c) => /GOUTAM/i.test(c.name))).toBeUndefined();
  });
});
