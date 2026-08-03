import type { AttendanceEmployee, EmployeeInput } from "./types";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const normalizeKey = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]/g, "");

// Fuzzy name equality used to line roster names up with attendance-sheet
// names: punctuation/spacing/case-insensitive, and tolerant of one side
// carrying extra words (e.g. "Ajay Malik" vs "AJAY MALIK (SECURITY)").
// Kept for suggestions only — joins use findUniqueMatch (A12).
export function namesMatch(a: string, b: string): boolean {
  const keyA = normalizeKey(a);
  const keyB = normalizeKey(b);
  return keyA.includes(keyB) || keyB.includes(keyA);
}

/** Match only when exactly one roster candidate matches (A12). */
export function findUniqueMatch(
  employees: EmployeeInput[],
  rawName: string
): EmployeeInput | null {
  const matches = employees.filter((emp) => namesMatch(emp.name, rawName));
  return matches.length === 1 ? matches[0] : null;
}

/** True for "security" and common sheet misspellings (SEQURITY, SECQURITY). */
function looksLikeSecurityLabel(s: string): boolean {
  const k = s.toLowerCase().replace(/[^a-z]/g, "");
  return (
    k.includes("security") ||
    k.includes("sequrity") ||
    k.includes("secqurity") ||
    k.includes("secuirity") ||
    k.includes("guard")
  );
}

function detectSecurity(rawName: string, department: string, matchedEmp?: EmployeeInput): boolean {
  // Prefer the persisted employee flag when present (TICKET-02). Name/dept
  // heuristics remain as a bootstrap for first-time imports only.
  if (matchedEmp?.isSecurity !== undefined) {
    return matchedEmp.isSecurity === true;
  }
  return (
    looksLikeSecurityLabel(rawName) ||
    looksLikeSecurityLabel(department) ||
    (matchedEmp ? looksLikeSecurityLabel(matchedEmp.name) : false)
  );
}

export type AttendanceFormat =
  | "standard"
  | "aptus-daily"
  | "double-shift"
  | "repeating-logs";

export function detectFormat(rows: any[][]): AttendanceFormat {
  let format: AttendanceFormat = "standard";

  if (rows.length > 4) {
    const r0 = rows[0] || [];
    const r4 = rows[4] || [];
    if (String(r0[0] || "").trim() === "List of Logs" && String(r4[0] || "").trim() === "No :") {
      return "repeating-logs";
    }
  }

  if (rows.length > 2) {
    const r2 = rows[2] || [];
    const r0 = rows[0] || [];
    const isFormatC = r2[3] === "A" && r2[4] === "B" && Number(r0[3]) === 1;
    const isFormatB =
      String(r2[0] || "").trim() === "S. NO." &&
      String(r2[1] || "").trim() === "NAME OF EMPLOYEE" &&
      Number(r2[4]) === 1;
    if (isFormatC) return "double-shift";
    if (isFormatB) return "aptus-daily";
  }

  return format;
}

export function formatKind(format: AttendanceFormat): "biometric" | "manual" {
  if (format === "standard" || format === "repeating-logs") return "biometric";
  return "manual";
}

/**
 * Day resolution R1–R4 (SPEC-attendance §3). First rule that applies wins.
 * doubleShift requires presence (A3).
 */
export function resolveDay(args: {
  sheetMark: string;
  punches: string[];
  decisions?: string;
  hasManualSheet: boolean;
}): { present: boolean; doubleShift: boolean } {
  const dec = args.decisions ?? "";
  const mark = args.sheetMark;

  let present = false;
  if (dec.includes("P")) {
    present = true; // R1
  } else if (mark === "1" || mark === "2" || mark === "P") {
    present = true; // R2
  } else if (mark === "0" || mark === "A" || (mark === "-" && args.hasManualSheet)) {
    present = false; // R3 — "-" is absent when a manual sheet is loaded
  } else if (!args.hasManualSheet) {
    present = args.punches.length > 0; // R4 biometric-only fallback
  } else {
    present = false;
  }

  // SPEC §3: doubleShift = (sheet === "2" || dec has "D") && !(dec has "d"); requires present (A3).
  let doubleShift = (mark === "2" || dec.includes("D")) && !dec.includes("d");
  if (!present) doubleShift = false;
  return { present, doubleShift };
}

// Derive shift and duration from punch times. Presence is NOT derived here
// (SPEC-attendance §4 / ADR-0005) — use resolveDay.
export function analyzePunches(times: string[]) {
  const punchedIn = times.length > 0;

  let shift: "Day" | "Night" = "Day";
  if (punchedIn) {
    const firstHour = Number([...times].sort()[0].split(":")[0]);
    if (firstHour >= 16 || firstHour < 6) {
      shift = "Night";
    }
  }

  let duration = 0;
  let ambiguousSpan = false;
  if (times.length >= 2) {
    const minutes = times.map((t) => {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m;
    });
    const raw = (Math.max(...minutes) - Math.min(...minutes)) / 60;
    if (shift === "Night" && raw > 12) {
      duration = 24 - raw;
      ambiguousSpan = duration < 5;
    } else {
      duration = raw;
    }
  }
  const isShortStay = punchedIn && duration < 5;
  // Presence no longer depends on duration — SPEC-attendance §4 / ADR-0005.
  return { shift, duration, isShortStay, ambiguousSpan, punchedIn };
}

function getMonthIndex(name: string) {
  if (!name) return 0;
  const lower = name.toLowerCase();
  for (let i = 0; i < MONTH_NAMES.length; i++) {
    if (lower.startsWith(MONTH_NAMES[i].toLowerCase().substring(0, 3))) {
      return i;
    }
  }
  return 0;
}

/** Map a Manual Sheet cell to a single-character verdict. */
function sheetMarkFromCell(val: unknown): string {
  if (val === null || val === undefined || String(val).trim() === "") return "-";
  const s = String(val).trim();
  if (s === "2" || Number(val) === 2) return "2";
  if (s === "0" || Number(val) === 0) return "0";
  if (s.toUpperCase() === "A") return "A";
  if (s.toUpperCase() === "P") return "P";
  if (s === "1" || Number(val) === 1) return "1";
  // Non-empty non-A/0 → present (legacy NKPL marks)
  return "1";
}

export function calculateEmployeeAttendanceStats(
  daysDetail: AttendanceEmployee["daysDetail"],
  isSecurity: boolean
) {
  const totalCalendarDays = daysDetail.length;
  const monthThreshold = totalCalendarDays === 31 ? 21 : (totalCalendarDays === 30 ? 20 : Math.round(totalCalendarDays * (20 / 30)));

  const isDayPresent = (day: AttendanceEmployee["daysDetail"][number]) =>
    Boolean(day.isPresent || day.manualOverride === "present");

  let rawPresentDays = 0;
  let totalHours = 0;
  let hoursSampleDays = 0;
  daysDetail.forEach((day) => {
    if (isDayPresent(day)) {
      rawPresentDays++;
      // Exclude ambiguousSpan from avgHours (SPEC §4.1)
      if (!day.ambiguousSpan) {
        totalHours += day.duration;
        hoursSampleDays++;
      }
    }
  });

  const unapprovedAbsences = daysDetail.filter(
    (d) => !isDayPresent(d) && d.leaveType === "unapproved"
  ).length;

  const effectivePresentDays = Math.max(0, rawPresentDays - unapprovedAbsences);
  const meetsMonthThreshold = effectivePresentDays >= monthThreshold;

  let sundaysWorked = 0;
  const sundayDetails: AttendanceEmployee["sundayDetails"] = [];

  daysDetail.forEach((day, index) => {
    if (day.dayOfWeek === 0) {
      const actuallyWorked = isDayPresent(day);
      if (actuallyWorked) {
        sundaysWorked++;
      }

      const sat = daysDetail[index - 1];
      const mon = daysDetail[index + 1];
      const isSatAbsent = (sat && sat.dayOfWeek === 6) ? !isDayPresent(sat) : false;
      const isMonAbsent = (mon && mon.dayOfWeek === 1) ? !isDayPresent(mon) : false;
      const isSandwichAbsent = isSatAbsent && isMonAbsent;

      let isEligible = false;
      const reasons: string[] = [];

      if (isSecurity) {
        reasons.push("Excluded: Employee is classified as Security Personnel.");
      } else if (!meetsMonthThreshold) {
        reasons.push(
          `Below Threshold: Worked only ${effectivePresentDays}/${totalCalendarDays} days (requires min ${monthThreshold} days for Sunday benefits).`
        );
      } else if (isSandwichAbsent) {
        isEligible = false;
        reasons.push(
          `Sandwich Rule Applied: Absent on both Saturday (${sat ? sat.dateString.split('/').slice(1).join('/') : 'Sat'}) and Monday (${mon ? mon.dateString.split('/').slice(1).join('/') : 'Mon'}). Sunday auto-presence is denied.`
        );
      } else {
        isEligible = true;
        if (actuallyWorked) {
          reasons.push("Double Pay Approved: Worked on Sunday (auto presence + bonus).");
        } else {
          reasons.push("Auto-Paid: Paid for Sunday (presence counted regardless of attendance).");
        }
      }

      sundayDetails.push({
        date: day.dateString,
        isEligible,
        reasons,
      });
    }
  });

  let finalPresentDays = effectivePresentDays;
  let sundayBonusDays = 0;

  if (meetsMonthThreshold && !isSecurity) {
    let autoPaidSundaysCount = 0;
    let eligibleWorkedSundaysCount = 0;

    sundayDetails.forEach((sun) => {
      const dayObj = daysDetail.find((d) => d.dateString === sun.date);
      if (dayObj) {
        const worked = isDayPresent(dayObj);
        if (!worked && sun.isEligible) {
          autoPaidSundaysCount++;
        } else if (worked && sun.isEligible) {
          eligibleWorkedSundaysCount++;
        }
      }
    });

    finalPresentDays = effectivePresentDays + autoPaidSundaysCount;
    sundayBonusDays = eligibleWorkedSundaysCount;
  } else {
    finalPresentDays = effectivePresentDays;
    sundayBonusDays = 0;
  }

  const avgHours = hoursSampleDays > 0 ? totalHours / hoursSampleDays : 0;

  // SPEC §8: Special handled by caller (category). Security → doubles only.
  // Non-security → sundaysEligible + doubleShiftDays. Never add doubles to Dw (A6).
  const doubleShiftDays = daysDetail.filter((d) => d.isDoubleShift && isDayPresent(d)).length;
  const extraDaysTotal = isSecurity ? doubleShiftDays : sundayBonusDays + doubleShiftDays;

  return {
    presentDays: finalPresentDays,
    avgHours,
    sundaysWorked,
    sundaysEligible: sundayBonusDays,
    meetsMonthThreshold,
    sundayDetails,
    doubleShiftDays,
    extraDaysTotal,
  };
}

/** Category-aware Extra Days (SPEC §8). Special always 0. */
export function extraDaysForEmployee(
  stats: { doubleShiftDays: number; sundaysEligible: number },
  opts: { isSecurity: boolean; isSpecial: boolean }
): number {
  if (opts.isSpecial) return 0;
  if (opts.isSecurity) return stats.doubleShiftDays;
  return stats.sundaysEligible + stats.doubleShiftDays;
}

// Month labels come back from storage in arbitrary (alphabetical) order;
// sort them chronologically so "latest month" defaults actually pick the
// most recent one. Unparseable labels sink to the front, preserving order.
export function sortMonthsChronologically(months: string[]): string[] {
  return [...months].sort((a, b) => {
    const pa = parseMonthYearString(a);
    const pb = parseMonthYearString(b);
    const ka = pa ? pa.year * 12 + pa.monthIndex : -1;
    const kb = pb ? pb.year * 12 + pb.monthIndex : -1;
    return ka - kb;
  });
}

/**
 * Which month a brand-new month should inherit its roster and rates from:
 * the nearest month before it, or failing that the nearest after it (so
 * back-filling an older month still starts from the real roster). Returns ""
 * when there is nothing to carry — the genuine first-month case.
 */
export function pickCarrySource(months: string[], target: string): string {
  const key = (label: string) => {
    const parsed = parseMonthYearString(label);
    return parsed ? parsed.year * 12 + parsed.monthIndex : Number.NaN;
  };
  const targetKey = key(target);
  if (!Number.isFinite(targetKey)) return "";

  const candidates = months.filter((m) => m !== target && Number.isFinite(key(m)));
  const sorted = [...candidates].sort((a, b) => key(a) - key(b));
  const before = sorted.filter((m) => key(m) < targetKey);
  return before.length ? before[before.length - 1] : (sorted[0] ?? "");
}

export function parseMonthYearString(str: string) {
  if (!str) return null;
  const yearMatch = str.match(/\b\d{4}\b/);
  const year = yearMatch ? Number(yearMatch[0]) : null;

  const lower = str.toLowerCase();
  let monthIndex = -1;
  for (let i = 0; i < MONTH_NAMES.length; i++) {
    const mName = MONTH_NAMES[i].toLowerCase();
    const abbrev = mName.substring(0, 3);
    if (lower.includes(mName) || lower.includes(abbrev)) {
      monthIndex = i;
      break;
    }
  }

  if (monthIndex !== -1 && year !== null) {
    return { monthIndex, year };
  }
  return null;
}

/**
 * Calendar days D for a pay month — pure function of the month label.
 * Parse failure returns 30 (neutral default; never 31). SPEC §3 / TICKET-03.
 */
export function calendarDaysForMonth(label: string): number {
  const p = parseMonthYearString(label);
  if (!p) return 30;
  return new Date(p.year, p.monthIndex + 1, 0).getDate();
}

/**
 * Pick worksheet by month label, then Logs/Attendance by name.
 * Never falls back to SheetNames[0] (SPEC §10.1).
 */
export function getBestWorksheet(
  workbook: any,
  targetMonthLabel: string
): { sheet: any; sheetName: string } {
  const sheetNames: string[] = workbook.SheetNames;
  if (sheetNames.length === 0) {
    throw new Error("Workbook has no sheets.");
  }
  if (sheetNames.length === 1) {
    return { sheet: workbook.Sheets[sheetNames[0]], sheetName: sheetNames[0] };
  }

  const targetParsed = parseMonthYearString(targetMonthLabel);
  if (targetParsed) {
    for (const name of sheetNames) {
      const sheetParsed = parseMonthYearString(name);
      if (
        sheetParsed &&
        sheetParsed.monthIndex === targetParsed.monthIndex &&
        sheetParsed.year === targetParsed.year
      ) {
        return { sheet: workbook.Sheets[name], sheetName: name };
      }
    }
  }

  const logsSheet = sheetNames.find(
    (name: string) =>
      name.toLowerCase() === "logs" ||
      name.toLowerCase() === "attendance" ||
      name.toLowerCase() === "attendancerecord"
  );
  if (logsSheet) {
    return { sheet: workbook.Sheets[logsSheet], sheetName: logsSheet };
  }

  throw new Error(
    `No matching worksheet for "${targetMonthLabel}". Available: ${sheetNames.join(", ")}`
  );
}

export function parseAttendanceExcel(rows: any[][], employees: EmployeeInput[]) {
  const format = detectFormat(rows);

  if (format === "repeating-logs") {
    // Row 2: ["Period : ", null, "2026/06/01 ~ 06/31\t( APTUS )"]
    const r2 = rows[2] || [];
    const periodStr = String(r2[2] || "");
    const dateMatch = periodStr.match(/(\d{4})\/(\d{2})\/(\d{2})/);
    let yearNum = 2026;
    let monthIdx = 5; // default June
    if (dateMatch) {
      yearNum = Number(dateMatch[1]);
      monthIdx = Number(dateMatch[2]) - 1;
    }
    const fileMonthLabel = `${MONTH_NAMES[monthIdx]} ${yearNum}`;

    const parsedEmployees: AttendanceEmployee[] = [];
    for (let r = 3; r + 2 < rows.length; r += 3) {
      const rDayNumbers = rows[r];
      const rEmployeeInfo = rows[r + 1];
      const rPunches = rows[r + 2];

      if (!rDayNumbers || !rEmployeeInfo || !rPunches) continue;
      if (String(rEmployeeInfo[0] || "").trim() !== "No :") {
        continue;
      }

      const rawName = String(rEmployeeInfo[10] || "").trim();
      const department = String(rEmployeeInfo[20] || "Company").trim();
      if (!rawName) continue;

      const matchedEmp = findUniqueMatch(employees, rawName) ?? undefined;

      const id = matchedEmp ? matchedEmp.id : String(rEmployeeInfo[2] || `att-emp-${r}`);

      const isSecurity = detectSecurity(rawName, department, matchedEmp);

      const daysDetail: AttendanceEmployee["daysDetail"] = [];
      for (let c = 0; c < rDayNumbers.length; c++) {
        const dayVal = rDayNumbers[c];
        if (dayVal === null || dayVal === undefined || isNaN(Number(dayVal))) continue;
        const dayNum = Number(dayVal);
        if (dayNum < 1 || dayNum > 31) continue;

        const punchStr = String(rPunches[c] || "");
        const times = punchStr.match(/\d{2}:\d{2}/g) || [];
        const { shift, duration, isShortStay, ambiguousSpan } = analyzePunches(times);
        const { present, doubleShift } = resolveDay({
          sheetMark: "-",
          punches: times,
          hasManualSheet: false,
        });

        const dateString = `${yearNum}/${String(monthIdx + 1).padStart(2, '0')}/${String(dayNum).padStart(2, '0')}`;
        const dateObj = new Date(yearNum, monthIdx, dayNum);

        daysDetail.push({
          dateString,
          dayOfWeek: dateObj.getDay(),
          isPresent: present,
          duration,
          punchTimes: times,
          isShortStay,
          ambiguousSpan,
          isDoubleShift: doubleShift,
          shift,
        });
      }

      const stats = calculateEmployeeAttendanceStats(daysDetail, isSecurity);
      parsedEmployees.push({
        id,
        name: rawName,
        department,
        isSecurity,
        biometricId: String(rEmployeeInfo[2] || "").trim() || undefined,
        daysDetail,
        ...stats,
      });
    }

    return {
      employees: parsedEmployees,
      monthLabel: fileMonthLabel,
    };
  }

  if (format === "double-shift") {
    const r0 = rows[0] || [];
    const monthStr = String(r0[1] || "").trim();
    const yearNum = Number(r0[2]) || 2026;
    const monthIdx = getMonthIndex(monthStr);
    const fileMonthLabel = `${MONTH_NAMES[monthIdx]} ${yearNum}`;

    const dateCols: Array<{
      day: number;
      colIndexA: number;
      colIndexB: number;
      dateString: string;
      dayOfWeek: number;
    }> = [];

    for (let i = 3; i < r0.length; i += 2) {
      const dayVal = r0[i];
      if (dayVal !== null && dayVal !== undefined && !isNaN(Number(dayVal))) {
        const dayNum = Number(dayVal);
        if (dayNum >= 1 && dayNum <= 31) {
          const dateObj = new Date(yearNum, monthIdx, dayNum);
          dateCols.push({
            day: dayNum,
            colIndexA: i,
            colIndexB: i + 1,
            dateString: `${yearNum}/${String(monthIdx + 1).padStart(2, '0')}/${String(dayNum).padStart(2, '0')}`,
            dayOfWeek: dateObj.getDay(),
          });
        }
      }
    }

    const parsedEmployees: AttendanceEmployee[] = [];
    for (let r = 3; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row[1] || row[1] === "NAME OF EMPLOYEE" || String(row[1]).trim() === "") continue;

      const rawName = String(row[1]).trim();
      const department = String(row[2] || "Company").trim();

      const matchedEmp = findUniqueMatch(employees, rawName) ?? undefined;

      const id = matchedEmp ? matchedEmp.id : String(row[0] || `att-emp-${r}`);

      const isSecurity = detectSecurity(rawName, department, matchedEmp);

      const daysDetail: AttendanceEmployee["daysDetail"] = [];
      const markChars: string[] = [];
      dateCols.forEach((d) => {
        const valA = row[d.colIndexA];
        const valB = row[d.colIndexB];

        const markA = sheetMarkFromCell(valA);
        const markB = sheetMarkFromCell(valB);
        // Prefer "2" if either slot is double; else present if either present; else absent
        let mark = "-";
        if (markA === "2" || markB === "2") mark = "2";
        else if (markA === "1" || markB === "1") mark = "1";
        else if (markA === "0" || markB === "0") mark = "0";
        markChars.push(mark);

        const { present, doubleShift } = resolveDay({
          sheetMark: mark,
          punches: [],
          hasManualSheet: true,
        });
        const isPresentA = markA === "1" || markA === "2";
        const isPresentB = markB === "1" || markB === "2";
        const shift = isPresentB && !isPresentA ? "Night" : "Day";
        const duration = present ? 8 : 0;

        daysDetail.push({
          dateString: d.dateString,
          dayOfWeek: d.dayOfWeek,
          isPresent: present,
          duration,
          punchTimes: present
            ? isPresentA && isPresentB
              ? ["08:30", "17:30", "20:00", "04:00"]
              : isPresentB
                ? ["20:00", "04:00"]
                : ["08:30", "17:30"]
            : [],
          isDoubleShift: doubleShift,
          shift,
        });
      });

      const stats = calculateEmployeeAttendanceStats(daysDetail, isSecurity);
      parsedEmployees.push({
        id,
        name: rawName,
        department,
        isSecurity,
        sheetMarks: markChars.join(""),
        daysDetail,
        ...stats,
      });
    }

    return {
      employees: parsedEmployees,
      monthLabel: fileMonthLabel,
    };
  }

  if (format === "aptus-daily") {
    const r0 = rows[0] || [];
    const titleStr = String(r0[0] || "");
    const match = titleStr.match(/\(([^)]+)\)/);
    let monthStr = "June";
    let yearNum = 2026;
    if (match) {
      const parts = match[1].trim().split(/\s+/);
      if (parts.length >= 2) {
        monthStr = parts[0];
        yearNum = Number(parts[1]) || 2026;
      }
    }
    const monthIdx = getMonthIndex(monthStr);
    const fileMonthLabel = `${MONTH_NAMES[monthIdx]} ${yearNum}`;

    const r2 = rows[2] || [];
    const dateCols: Array<{
      day: number;
      colIndex: number;
      dateString: string;
      dayOfWeek: number;
    }> = [];

    for (let i = 4; i < r2.length; i++) {
      const cellVal = r2[i];
      if (cellVal !== null && cellVal !== undefined && !isNaN(Number(cellVal))) {
        const dayNum = Number(cellVal);
        if (dayNum >= 1 && dayNum <= 31) {
          const dateObj = new Date(yearNum, monthIdx, dayNum);
          dateCols.push({
            day: dayNum,
            colIndex: i,
            dateString: `${yearNum}/${String(monthIdx + 1).padStart(2, '0')}/${String(dayNum).padStart(2, '0')}`,
            dayOfWeek: dateObj.getDay(),
          });
        }
      }
    }

    const parsedEmployees: AttendanceEmployee[] = [];
    for (let r = 3; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row[1] || String(row[1]).trim() === "" || String(row[1]).trim() === "NAME OF EMPLOYEE") continue;

      const rawName = String(row[1]).trim();
      const department = String(row[2] || "Company").trim();

      const matchedEmp = findUniqueMatch(employees, rawName) ?? undefined;

      const id = matchedEmp ? matchedEmp.id : String(row[0] || `att-emp-${r}`);

      const isSecurity = detectSecurity(rawName, department, matchedEmp);

      const daysDetail: AttendanceEmployee["daysDetail"] = [];
      const markChars: string[] = [];
      dateCols.forEach((d) => {
        const val = row[d.colIndex];
        let mark = "-";
        if (val !== null && val !== undefined && String(val).trim() !== "") {
          const s = String(val).trim().toUpperCase();
          if (s === "2" || Number(val) === 2) mark = "2";
          else if (s === "P") mark = "P";
          else if (s === "A") mark = "A";
          else mark = "0";
        }
        markChars.push(mark === "P" ? "1" : mark === "A" ? "0" : mark);

        const { present, doubleShift } = resolveDay({
          sheetMark: mark === "P" ? "P" : mark === "A" ? "A" : mark,
          punches: [],
          hasManualSheet: true,
        });
        const duration = present ? 8 : 0;

        daysDetail.push({
          dateString: d.dateString,
          dayOfWeek: d.dayOfWeek,
          isPresent: present,
          duration,
          punchTimes: present ? ["08:30", "17:30"] : [],
          isDoubleShift: doubleShift,
          shift: "Day",
        });
      });

      const stats = calculateEmployeeAttendanceStats(daysDetail, isSecurity);
      parsedEmployees.push({
        id,
        name: rawName,
        department,
        isSecurity,
        sheetMarks: markChars.join(""),
        daysDetail,
        ...stats,
      });
    }

    return {
      employees: parsedEmployees,
      monthLabel: fileMonthLabel,
    };
  }

  // Fallback / standard format
  const headerRowIndex = 3;
  const dateHeaders = rows[headerRowIndex] || [];
  const dateCols: Array<{
    colIndex: number;
    dateString: string;
    date: Date;
    dayOfWeek: number;
  }> = [];

  for (let i = 4; i < dateHeaders.length; i++) {
    const cell = dateHeaders[i];
    if (cell && /\d{4}[\/\.-]\d{2}[\/\.-]\d{2}/.test(String(cell))) {
      const parts = String(cell).split(/[\/\.-]/);
      const dateObj = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      dateCols.push({
        colIndex: i,
        dateString: String(cell),
        date: dateObj,
        dayOfWeek: dateObj.getDay(),
      });
    }
  }

  if (dateCols.length === 0) {
    throw new Error("Could not find date columns in standard YYYY/MM/DD format in the Excel sheet.");
  }

  let fileMonthLabel = "";
  if (dateCols.length > 0) {
    const firstDate = dateCols[0].date;
    fileMonthLabel = `${MONTH_NAMES[firstDate.getMonth()]} ${firstDate.getFullYear()}`;
  }

  const parsedEmployees: AttendanceEmployee[] = [];

  for (let r = 5; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row[2]) continue;

    const id = String(row[0] || `att-emp-${r}`);
    const name = String(row[2]).trim();
    const department = String(row[3] || "Company").trim();

    const matchedEmp = findUniqueMatch(employees, name) ?? undefined;
    const isSecurity = detectSecurity(name, department, matchedEmp);

    const daysDetail: AttendanceEmployee["daysDetail"] = [];

    dateCols.forEach((d) => {
      const val = String(row[d.colIndex] || "");
      const times = val.match(/\d{2}:\d{2}/g) || [];
      const { shift, duration, isShortStay, ambiguousSpan } = analyzePunches(times);
      const { present, doubleShift } = resolveDay({
        sheetMark: "-",
        punches: times,
        hasManualSheet: false,
      });

      daysDetail.push({
        dateString: d.dateString,
        dayOfWeek: d.dayOfWeek,
        isPresent: present,
        duration,
        punchTimes: times,
        isShortStay,
        ambiguousSpan,
        isDoubleShift: doubleShift,
        shift,
      });
    });

    const stats = calculateEmployeeAttendanceStats(daysDetail, isSecurity);

    parsedEmployees.push({
      id,
      name,
      department,
      isSecurity,
      biometricId: id,
      daysDetail,
      ...stats,
    });
  }

  return {
    employees: parsedEmployees,
    monthLabel: fileMonthLabel,
  };
}
