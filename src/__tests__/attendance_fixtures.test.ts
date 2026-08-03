import { describe, expect, it } from "vitest";
import { namesMatch, parseAttendanceExcel } from "../attendance";
import type { EmployeeInput } from "../types";
import nkplManual from "./fixtures/nkpl-july-2026-manual.json";
import nkplBio from "./fixtures/nkpl-july-2026-biometric.json";
import aptusManual from "./fixtures/aptus-may-2026-manual.json";
import aptusBio from "./fixtures/aptus-may-2026-biometric.json";

const emptyRoster: EmployeeInput[] = [];

/** Count double-shift cells (value 2) in NKPL double-shift format. */
function countNkplTwos(rows: any[][]): { count: number; cells: string[] } {
  const r0 = rows[0] || [];
  const dateCols: Array<{ day: number; colA: number; colB: number }> = [];
  for (let i = 3; i < r0.length; i += 2) {
    const dayVal = r0[i];
    if (dayVal !== null && dayVal !== undefined && !isNaN(Number(dayVal))) {
      const dayNum = Number(dayVal);
      if (dayNum >= 1 && dayNum <= 31) {
        dateCols.push({ day: dayNum, colA: i, colB: i + 1 });
      }
    }
  }
  const cells: string[] = [];
  for (let r = 3; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row[1]) continue;
    const name = String(row[1]).trim();
    if (!name || name === "NAME OF EMPLOYEE") continue;
    for (const d of dateCols) {
      for (const col of [d.colA, d.colB]) {
        if (Number(row[col]) === 2 || String(row[col]).trim() === "2") {
          cells.push(`${name} d${d.day}`);
        }
      }
    }
  }
  return { count: cells.length, cells };
}

/** Days where both A and B columns are marked present. */
function countBothAB(rows: any[][]): number {
  const r0 = rows[0] || [];
  const dateCols: Array<{ colA: number; colB: number }> = [];
  for (let i = 3; i < r0.length; i += 2) {
    const dayVal = r0[i];
    if (dayVal !== null && dayVal !== undefined && !isNaN(Number(dayVal))) {
      const dayNum = Number(dayVal);
      if (dayNum >= 1 && dayNum <= 31) {
        dateCols.push({ colA: i, colB: i + 1 });
      }
    }
  }
  let both = 0;
  const isMarked = (v: unknown) =>
    v !== null &&
    v !== undefined &&
    v !== "" &&
    v !== 0 &&
    String(v).trim() !== "0" &&
    String(v).trim().toUpperCase() !== "A";
  for (let r = 3; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row[1]) continue;
    for (const d of dateCols) {
      if (isMarked(row[d.colA]) && isMarked(row[d.colB])) both++;
    }
  }
  return both;
}

function aptusHistogram(rows: any[][]): Record<string, number> {
  const r2 = rows[2] || [];
  const dayCols: number[] = [];
  for (let i = 4; i < r2.length; i++) {
    if (r2[i] !== null && r2[i] !== undefined && !isNaN(Number(r2[i]))) {
      const n = Number(r2[i]);
      if (n >= 1 && n <= 31) dayCols.push(i);
    }
  }
  const hist: Record<string, number> = { P: 0, A: 0, blank: 0, "2": 0, other: 0 };
  for (let r = 3; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row[1] || String(row[1]).trim() === "" || String(row[1]).trim() === "NAME OF EMPLOYEE")
      continue;
    for (const c of dayCols) {
      const v = row[c];
      if (v === null || v === undefined || String(v).trim() === "") hist.blank++;
      else if (String(v).trim().toUpperCase() === "P") hist.P++;
      else if (String(v).trim().toUpperCase() === "A") hist.A++;
      else if (String(v).trim() === "2" || Number(v) === 2) hist["2"]++;
      else hist.other++;
    }
  }
  return hist;
}

function namesMatchRate(
  sheetNames: string[],
  rosterNames: string[]
): { clean: number; total: number } {
  // clean 1:1 = each sheet name uniquely matches exactly one roster name via namesMatch
  let clean = 0;
  for (const sn of sheetNames) {
    const matches = rosterNames.filter((rn) => namesMatch(sn, rn));
    if (matches.length === 1) {
      // also require reverse uniqueness for clean 1:1
      const reverse = sheetNames.filter((s) => namesMatch(s, matches[0]));
      if (reverse.length === 1) clean++;
    }
  }
  return { clean, total: sheetNames.length };
}

describe("attendance characterization fixtures (HANDOFF §5)", () => {
  it("NKPL July 2026: employee counts and double-shift cells", () => {
    const manual = parseAttendanceExcel(nkplManual as any[][], emptyRoster);
    const bio = parseAttendanceExcel(nkplBio as any[][], emptyRoster);

    expect(manual.employees.length).toBe(44);
    expect(bio.employees.length).toBe(38);

    const twos = countNkplTwos(nkplManual as any[][]);
    expect(twos.count).toBe(4);
    expect(twos.cells.sort()).toEqual(
      [
        "MONAJ CHATTERJEE d12",
        "MONAJ CHATTERJEE d26",
        "PARIMAL GHOSH d5",
        "PARIMAL GHOSH d19",
      ].sort()
    );

    expect(countBothAB(nkplManual as any[][])).toBe(0);
  });

  it("APTUS May 2026: employee counts and value histogram", () => {
    const manual = parseAttendanceExcel(aptusManual as any[][], emptyRoster);
    const bio = parseAttendanceExcel(aptusBio as any[][], emptyRoster);

    expect(manual.employees.length).toBe(32);
    expect(bio.employees.length).toBe(32);

    const hist = aptusHistogram(aptusManual as any[][]);
    expect(hist.P).toBe(719);
    expect(hist.A).toBe(138);
    expect(hist.blank).toBe(135);
    expect(hist["2"]).toBe(0);
  });

  it("namesMatch clean 1:1 rates: NKPL 23/44, APTUS 24/32", () => {
    const nkplSheet = (nkplManual as any[][])
      .slice(3)
      .map((r) => (r?.[1] ? String(r[1]).trim() : ""))
      .filter((n) => n && n !== "NAME OF EMPLOYEE");
    const nkplBioNames = parseAttendanceExcel(nkplBio as any[][], emptyRoster).employees.map(
      (e) => e.name
    );
    // Ground-truth rates are sheet vs biometric names (as measured in grill)
    const nkpl = namesMatchRate(nkplSheet, nkplBioNames);
    expect(nkpl.total).toBe(44);
    expect(nkpl.clean).toBe(23);

    const aptusSheet = (aptusManual as any[][])
      .slice(3)
      .map((r) => (r?.[1] ? String(r[1]).trim() : ""))
      .filter((n) => n && n !== "NAME OF EMPLOYEE");
    const aptusBioNames = parseAttendanceExcel(aptusBio as any[][], emptyRoster).employees.map(
      (e) => e.name
    );
    const aptus = namesMatchRate(aptusSheet, aptusBioNames);
    expect(aptus.total).toBe(32);
    expect(aptus.clean).toBe(24);
  });
});
