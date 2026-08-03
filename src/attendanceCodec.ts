import type {
  AttendanceEmployee,
  AttendanceRecordV1,
  AttendanceRowV1,
} from "./types";
import { calendarDaysForMonth, calculateEmployeeAttendanceStats } from "./attendance";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function hhmm(t: string): string {
  const m = t.match(/(\d{1,2}):(\d{2})/);
  if (!m) return "";
  return `${m[1].padStart(2, "0")}${m[2]}`;
}

function fromHhmm(s: string): string {
  if (s.length < 4) return s;
  return `${s.slice(0, 2)}:${s.slice(2, 4)}`;
}

/** Encode D punch slots: "0805-2009;;0802-2004" */
export function encodePunches(
  daysDetail: AttendanceEmployee["daysDetail"],
  D: number
): string {
  const slots: string[] = [];
  for (let i = 0; i < D; i++) {
    const day = daysDetail[i];
    if (!day || !day.punchTimes?.length) {
      slots.push("");
    } else {
      slots.push(day.punchTimes.map(hhmm).filter(Boolean).join("-"));
    }
  }
  return slots.join(";");
}

export function decodePunches(p: string, D: number): string[][] {
  const raw = p.split(";");
  const out: string[][] = [];
  for (let i = 0; i < D; i++) {
    const slot = raw[i] ?? "";
    if (!slot) {
      out.push([]);
    } else {
      out.push(slot.split("-").filter(Boolean).map(fromHhmm));
    }
  }
  return out;
}

function sheetCharForDay(day: AttendanceEmployee["daysDetail"][number] | undefined): string {
  if (!day) return "-";
  if (day.isDoubleShift) return "2";
  if (day.isPresent) return "1";
  // Distinguish blank/no-sheet from explicit absent when sheetMarks unavailable
  if (day.punchTimes?.length === 0 && day.duration === 0 && !day.leaveType) {
    // Could be either; prefer "0" if we know it's sheet-absent, else "-"
    // Callers set sheetMarks when available; for encode we use isPresent.
  }
  return "0";
}

function decisionsForDay(day: AttendanceEmployee["daysDetail"][number]): string {
  if (day.decisions) return day.decisions;
  let s = "";
  if (day.manualOverride === "present") s += "P";
  if (day.leaveType === "approved") s += "a";
  if (day.leaveType === "unapproved") s += "u";
  return s;
}

export function encodeAttendance(
  company: string,
  monthLabel: string,
  employees: AttendanceEmployee[]
): AttendanceRecordV1 {
  const D = calendarDaysForMonth(monthLabel);
  const e: AttendanceRowV1[] = employees.map((emp) => {
    const sFromMarks =
      emp.sheetMarks && emp.sheetMarks.length === D
        ? emp.sheetMarks
        : null;
    let s = sFromMarks ?? "";
    if (!sFromMarks) {
      const chars: string[] = [];
      for (let i = 0; i < D; i++) {
        chars.push(sheetCharForDay(emp.daysDetail[i]));
      }
      s = chars.join("");
    }
    // Pad/truncate to D
    if (s.length < D) s = s.padEnd(D, "-");
    if (s.length > D) s = s.slice(0, D);

    const p = encodePunches(emp.daysDetail, D);
    const o: Record<string, string> = {};
    emp.daysDetail.forEach((day, idx) => {
      const flags = decisionsForDay(day);
      if (flags) o[String(idx + 1)] = flags;
    });

    const row: AttendanceRowV1 = {
      i: emp.id,
      n: emp.name,
      p,
      s,
    };
    if (emp.biometricId) row.b = emp.biometricId;
    if (emp.department) row.d = emp.department;
    if (emp.isSecurity) row.sec = 1;
    if (Object.keys(o).length > 0) row.o = o;
    return row;
  });

  return {
    v: 1,
    c: company,
    m: monthLabel,
    u: new Date().toISOString(),
    e,
  };
}

function parseMonthParts(monthLabel: string): { year: number; monthIndex: number } {
  const yearMatch = monthLabel.match(/\b\d{4}\b/);
  const year = yearMatch ? Number(yearMatch[0]) : 2026;
  const lower = monthLabel.toLowerCase();
  let monthIndex = 0;
  for (let i = 0; i < MONTH_NAMES.length; i++) {
    const mName = MONTH_NAMES[i].toLowerCase();
    if (lower.includes(mName) || lower.includes(mName.substring(0, 3))) {
      monthIndex = i;
      break;
    }
  }
  return { year, monthIndex };
}

/**
 * Decode a stored record into lightweight AttendanceEmployee shells.
 * Full stats recomputation is caller's job after merge with live parse.
 * Unknown v or null → [].
 */
export function decodeAttendance(
  record: AttendanceRecordV1 | null | { v?: number },
  monthLabel: string
): AttendanceEmployee[] {
  if (!record || (record as AttendanceRecordV1).v !== 1) return [];
  const rec = record as AttendanceRecordV1;
  const D = calendarDaysForMonth(monthLabel || rec.m);
  const { year, monthIndex } = parseMonthParts(monthLabel || rec.m);

  return rec.e.map((row) => {
    let s = row.s ?? "";
    if (s.length < D) s = s.padEnd(D, "-");
    if (s.length > D) s = s.slice(0, D);
    const punches = decodePunches(row.p ?? "", D);

    const daysDetail: AttendanceEmployee["daysDetail"] = [];
    for (let i = 0; i < D; i++) {
      const dayNum = i + 1;
      const dateObj = new Date(year, monthIndex, dayNum);
      const mark = s[i] ?? "-";
      const times = punches[i] ?? [];
      const flags = row.o?.[String(dayNum)] ?? "";
      const isDouble = mark === "2" || (flags.includes("D") && !flags.includes("d"));
      const presentFromSheet = mark === "1" || mark === "2" || mark === "P";
      const presentFromOverride = flags.includes("P");
      const presentFromPunch = mark === "-" && times.length > 0; // R4-ish when no sheet mark
      const isPresent =
        presentFromOverride ||
        presentFromSheet ||
        (mark === "-" && presentFromPunch && !flags.includes("u"));

      daysDetail.push({
        dateString: `${year}/${String(monthIndex + 1).padStart(2, "0")}/${String(dayNum).padStart(2, "0")}`,
        dayOfWeek: dateObj.getDay(),
        isPresent: Boolean(isPresent && !(mark === "0" || mark === "A") || presentFromOverride || presentFromSheet),
        duration: times.length >= 2 ? 8 : 0,
        punchTimes: times,
        isDoubleShift: isDouble && (presentFromSheet || presentFromOverride || isPresent),
        manualOverride: flags.includes("P") ? "present" : undefined,
        leaveType: flags.includes("a")
          ? "approved"
          : flags.includes("u")
            ? "unapproved"
            : undefined,
        decisions: flags || undefined,
        shift: "Day",
      });
    }

    // Fix isPresent properly per R1-R4 lightly for decode
    for (let i = 0; i < D; i++) {
      const mark = s[i] ?? "-";
      const flags = row.o?.[String(i + 1)] ?? "";
      const times = punches[i] ?? [];
      let present = false;
      if (flags.includes("P")) present = true;
      else if (mark === "1" || mark === "2" || mark === "P") present = true;
      else if (mark === "0" || mark === "A") present = false;
      else present = times.length > 0;
      const doubleShift =
        (mark === "2" || (flags.includes("D") && !flags.includes("d"))) && present;
      daysDetail[i].isPresent = present;
      daysDetail[i].isDoubleShift = doubleShift;
    }

    const isSecurity = row.sec === 1;
    const stats = calculateEmployeeAttendanceStats(daysDetail, isSecurity);

    return {
      id: row.i,
      name: row.n,
      department: row.d ?? "",
      isSecurity,
      biometricId: row.b,
      sheetMarks: s,
      daysDetail,
      ...stats,
    };
  });
}
