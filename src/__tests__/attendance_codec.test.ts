import { describe, expect, it } from "vitest";
import {
  decodeAttendance,
  decodePunches,
  encodeAttendance,
  encodePunches,
} from "../attendanceCodec";
import { parseAttendanceExcel } from "../attendance";
import type { AttendanceEmployee, AttendanceRecordV1 } from "../types";
import nkplManual from "./fixtures/nkpl-july-2026-manual.json";

function minimalEmployee(partial: Partial<AttendanceEmployee> = {}): AttendanceEmployee {
  const daysDetail: AttendanceEmployee["daysDetail"] = [];
  for (let i = 0; i < 31; i++) {
    daysDetail.push({
      dateString: `2026/07/${String(i + 1).padStart(2, "0")}`,
      dayOfWeek: new Date(2026, 6, i + 1).getDay(),
      isPresent: i < 20,
      duration: i < 20 ? 8 : 0,
      punchTimes: i < 20 ? ["08:05", "20:09"] : [],
      isDoubleShift: i === 11 || i === 25,
    });
  }
  return {
    id: "e1",
    name: "TEST EMP",
    department: "Company",
    isSecurity: false,
    presentDays: 20,
    avgHours: 8,
    sundaysWorked: 0,
    sundaysEligible: 0,
    meetsMonthThreshold: true,
    doubleShiftDays: 2,
    extraDaysTotal: 2,
    sundayDetails: [],
    daysDetail,
    sheetMarks: "1".repeat(20) + "0".repeat(9) + "2" + "0", // will be rebuilt
    ...partial,
  };
}

describe("attendance codec (A9, A11)", () => {
  it("encodePunches pads to D and never truncates short arrays", () => {
    const days = [
      { punchTimes: ["08:05", "20:09"] },
      { punchTimes: [] },
      { punchTimes: ["08:02", "20:04"] },
    ] as AttendanceEmployee["daysDetail"];
    const p = encodePunches(days, 5);
    expect(p.split(";")).toHaveLength(5);
    expect(decodePunches(p, 5)).toEqual([
      ["08:05", "20:09"],
      [],
      ["08:02", "20:04"],
      [],
      [],
    ]);
  });

  it("decodePunches pads short p to D (A11)", () => {
    const slots = decodePunches("0805-2009;;0802", 4);
    expect(slots).toHaveLength(4);
    expect(slots[0]).toEqual(["08:05", "20:09"]);
    expect(slots[3]).toEqual([]);
  });

  it("round-trips encode → decode → encode (A9)", () => {
    const emp = minimalEmployee({
      sheetMarks: "1".repeat(29) + "22",
      daysDetail: Array.from({ length: 31 }, (_, i) => ({
        dateString: `2026/07/${String(i + 1).padStart(2, "0")}`,
        dayOfWeek: new Date(2026, 6, i + 1).getDay(),
        isPresent: true,
        duration: 8,
        punchTimes: ["08:00", "20:00"],
        isDoubleShift: i === 29 || i === 30,
        manualOverride: i === 0 ? ("present" as const) : undefined,
      })),
    });
    const rec = encodeAttendance("NKPL", "July 2026", [emp]);
    expect(rec.v).toBe(1);
    expect(rec.e[0].s).toHaveLength(31);
    expect(rec.e[0].p.split(";")).toHaveLength(31);
    expect(rec.e[0].o?.["1"]).toContain("P");

    const decoded = decodeAttendance(rec, "July 2026");
    const rec2 = encodeAttendance("NKPL", "July 2026", decoded);
    // Stable structural equality on rows (ignore updatedAt)
    expect(rec2.e[0].i).toBe(rec.e[0].i);
    expect(rec2.e[0].n).toBe(rec.e[0].n);
    expect(rec2.e[0].s).toBe(rec.e[0].s);
    expect(rec2.e[0].p).toBe(rec.e[0].p);
    expect(rec2.e[0].o).toEqual(rec.e[0].o);
  });

  it("unknown v returns []", () => {
    expect(decodeAttendance({ v: 99 } as any, "July 2026")).toEqual([]);
    expect(decodeAttendance(null, "July 2026")).toEqual([]);
  });

  it("encoded NKPL July fixture under 20 KB", () => {
    const parsed = parseAttendanceExcel(nkplManual as any[][], []);
    // Ensure required fields exist for codec
    const emps = parsed.employees.map((e) => ({
      ...e,
      doubleShiftDays: e.doubleShiftDays ?? 0,
      extraDaysTotal: e.extraDaysTotal ?? e.sundaysEligible ?? 0,
    }));
    const rec = encodeAttendance("NKPL", "July 2026", emps);
    const size = JSON.stringify(rec).length;
    expect(size).toBeLessThan(20 * 1024);
  });
});
