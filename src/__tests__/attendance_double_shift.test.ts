import { describe, expect, it } from "vitest";
import {
  analyzePunches,
  calculateEmployeeAttendanceStats,
  extraDaysForEmployee,
  findUniqueMatch,
  parseAttendanceExcel,
  resolveDay,
} from "../attendance";
import type { EmployeeInput } from "../types";
import nkplManual from "./fixtures/nkpl-july-2026-manual.json";
import aptusManual from "./fixtures/aptus-may-2026-manual.json";

describe("resolveDay + analyzePunches (A1–A6)", () => {
  it("A1: isShortStay never forces absence — presence from resolveDay", () => {
    const analysis = analyzePunches(["08:30"]);
    expect(analysis.isShortStay).toBe(true);
    expect(analysis.punchedIn).toBe(true);
    // No isPresent on analysis
    expect((analysis as any).isPresent).toBeUndefined();

    const sheetPresent = resolveDay({
      sheetMark: "1",
      punches: ["08:30"],
      hasManualSheet: true,
    });
    expect(sheetPresent.present).toBe(true);
  });

  it("A3: doubleShift implies present", () => {
    const absentDouble = resolveDay({
      sheetMark: "0",
      punches: [],
      decisions: "D",
      hasManualSheet: true,
    });
    // D without presence → present stays false from R3, so double forced false
    expect(absentDouble.present).toBe(false);
    expect(absentDouble.doubleShift).toBe(false);

    const presentDouble = resolveDay({
      sheetMark: "2",
      punches: [],
      hasManualSheet: true,
    });
    expect(presentDouble.present).toBe(true);
    expect(presentDouble.doubleShift).toBe(true);

    const cleared = resolveDay({
      sheetMark: "2",
      punches: [],
      decisions: "d",
      hasManualSheet: true,
    });
    expect(cleared.present).toBe(true);
    expect(cleared.doubleShift).toBe(false);
  });

  it("A4/A5: Security gets doubles only; Special gets 0; else sundays+doubles", () => {
    const days = Array.from({ length: 31 }, (_, i) => ({
      dateString: `2026/07/${String(i + 1).padStart(2, "0")}`,
      dayOfWeek: new Date(2026, 6, i + 1).getDay(),
      isPresent: i < 25,
      duration: 8,
      punchTimes: ["08:00", "20:00"] as string[],
      // Doubles only on present days (indices 11 and 12)
      isDoubleShift: i === 11 || i === 12,
    }));
    const sec = calculateEmployeeAttendanceStats(days, true);
    expect(sec.sundaysEligible).toBe(0);
    expect(sec.doubleShiftDays).toBe(2);
    expect(extraDaysForEmployee(sec, { isSecurity: true, isSpecial: false })).toBe(2);
    expect(extraDaysForEmployee(sec, { isSecurity: false, isSpecial: true })).toBe(0);

    const nonSec = calculateEmployeeAttendanceStats(days, false);
    expect(
      extraDaysForEmployee(nonSec, { isSecurity: false, isSpecial: false })
    ).toBe(nonSec.sundaysEligible + nonSec.doubleShiftDays);
  });

  it("A6: double shift never increments Dw beyond present day count", () => {
    const days = Array.from({ length: 31 }, (_, i) => ({
      dateString: `2026/07/${String(i + 1).padStart(2, "0")}`,
      dayOfWeek: new Date(2026, 6, i + 1).getDay(),
      isPresent: true,
      duration: 8,
      punchTimes: ["08:00", "20:00"] as string[],
      isDoubleShift: i < 4,
    }));
    const stats = calculateEmployeeAttendanceStats(days, true);
    expect(stats.presentDays).toBeLessThanOrEqual(31);
    expect(stats.doubleShiftDays).toBe(4);
    // Dw is not presentDays + doubles
    expect(stats.presentDays).toBe(31); // security: no auto Sundays
  });

  it("ANUPAM-style ambiguous span on night wrap < 5h", () => {
    const a = analyzePunches(["00:21", "23:19"]);
    expect(a.shift).toBe("Night");
    expect(a.ambiguousSpan).toBe(true);
    expect(a.duration).toBeLessThan(5);
  });

  it("A12: findUniqueMatch returns null on 0 or 2+ matches", () => {
    const roster: EmployeeInput[] = [
      {
        id: "1",
        name: "Rajesh Kumar",
        category: "Unskilled",
        monthlySalary: 0,
        daysWorked: 0,
        extraDays: 0,
        otherDeduction: 0,
      },
      {
        id: "2",
        name: "Rajesh Singh",
        category: "Unskilled",
        monthlySalary: 0,
        daysWorked: 0,
        extraDays: 0,
        otherDeduction: 0,
      },
    ];
    expect(findUniqueMatch(roster, "Rajesh")).toBeNull();
    expect(findUniqueMatch(roster, "Nobody")).toBeNull();
    expect(findUniqueMatch(roster, "Rajesh Kumar")?.id).toBe("1");
  });
});

describe("NKPL July 2026 doubles and guards (A8)", () => {
  it("finds four double-shift days and guards Dw=29 Xd=2", () => {
    const parsed = parseAttendanceExcel(nkplManual as any[][], []);
    const doubles: string[] = [];
    for (const emp of parsed.employees) {
      emp.daysDetail.forEach((d, idx) => {
        if (d.isDoubleShift) doubles.push(`${emp.name} d${idx + 1}`);
      });
    }
    expect(doubles.sort()).toEqual(
      [
        "MONAJ CHATTERJEE d12",
        "MONAJ CHATTERJEE d26",
        "PARIMAL GHOSH d5",
        "PARIMAL GHOSH d19",
      ].sort()
    );

    const monaj = parsed.employees.find((e) => e.name.includes("MONAJ"));
    const parimal = parsed.employees.find((e) => e.name.includes("PARIMAL"));
    expect(monaj).toBeTruthy();
    expect(parimal).toBeTruthy();
    expect(monaj!.isSecurity).toBe(true);
    expect(parimal!.isSecurity).toBe(true);
    expect(monaj!.presentDays).toBe(29);
    expect(parimal!.presentDays).toBe(29);
    expect(monaj!.doubleShiftDays).toBe(2);
    expect(parimal!.doubleShiftDays).toBe(2);
    expect(monaj!.extraDaysTotal).toBe(2);
    expect(parimal!.extraDaysTotal).toBe(2);
  });
});

describe("APTUS May Security Sunday package denied (A4)", () => {
  it("Somnath Parui Dw=31 Xd=0 (sheet claims 36)", () => {
    const parsed = parseAttendanceExcel(aptusManual as any[][], []);
    const som = parsed.employees.find((e) => /somnath/i.test(e.name));
    expect(som).toBeTruthy();
    expect(som!.isSecurity).toBe(true);
    expect(som!.presentDays).toBe(31);
    expect(som!.extraDaysTotal).toBe(0);
    expect(som!.doubleShiftDays).toBe(0);
  });

  it("Rajesh Kr Singh: sheet TOT=30 equals Dw+Xd; Debnath pal Dw=17", () => {
    const parsed = parseAttendanceExcel(aptusManual as any[][], []);
    const rajesh = parsed.employees.find((e) => /rajesh/i.test(e.name) && /singh/i.test(e.name));
    const debnath = parsed.employees.find((e) => /debnath/i.test(e.name));
    // P=25 includes 1 worked Sunday; 4 auto-paid Sundays → Dw=29; Xd=1 → 30 (sheet TOT).
    expect(rajesh?.presentDays).toBe(29);
    expect(rajesh?.sundaysEligible).toBe(1);
    expect((rajesh?.presentDays ?? 0) + (rajesh?.extraDaysTotal ?? 0)).toBe(30);
    expect(debnath?.presentDays).toBe(17);
  });
});
