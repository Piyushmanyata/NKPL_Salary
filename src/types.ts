export type AttendanceEmployee = {
  id: string;
  name: string;
  department: string;
  isSecurity: boolean;
  presentDays: number;
  avgHours: number;
  sundaysWorked: number;
  sundaysEligible: number;
  meetsMonthThreshold: boolean;
  /** Count of double-shift days in the month. SPEC-attendance §3. */
  doubleShiftDays: number;
  /** Extra Days total at sync boundary. SPEC-attendance §8. */
  extraDaysTotal: number;
  /** D-character Manual Sheet verdict string for the diff view. */
  sheetMarks?: string;
  /** Biometric device id when known. */
  biometricId?: string;
  sundayDetails: Array<{
    date: string;
    isEligible: boolean;
    reasons: string[];
  }>;
  daysDetail: Array<{
    dateString: string;
    dayOfWeek: number;
    isPresent: boolean;
    duration: number;
    punchTimes: string[];
    isShortStay?: boolean;
    shift?: "Day" | "Night";
    isDoubleShift?: boolean;
    ambiguousSpan?: boolean;
    manualOverride?: "present";
    leaveType?: "approved" | "unapproved";
    /** Decision flags string (P/a/u/D/d/R) when loaded from codec. */
    decisions?: string;
  }>;
};

/** attendance/<COMPANY>/<Month Label> — SPEC-attendance §9.3 */
export type AttendanceRecordV1 = {
  v: 1;
  c: string; // company, e.g. "NKPL"
  m: string; // month label, e.g. "July 2026"
  u: string; // updatedAt, ISO
  e: AttendanceRowV1[];
};

export type AttendanceRowV1 = {
  i: string; // roster employee id when mapped, else a stable synthetic key
  b?: string; // biometric device id, when mapped
  n: string; // name as it appeared in the source, for display
  d?: string; // department as it appeared
  sec?: 1; // isSecurity at parse time
  /**
   * Punches. D slots joined by ";". Each slot is "HHMM" values joined by "-",
   * empty string for a day with no punches.
   *   "0805-2009;;0802-2004"  = d1 two punches, d2 none, d3 two punches
   */
  p: string;
  /**
   * Manual Sheet verdicts. Exactly D characters, one per day:
   *   "-" no manual sheet / blank cell   "0" absent   "1" present   "2" double shift
   */
  s: string;
  /**
   * Human decisions, sparse. Key is the day number as a string. Value is a
   * concatenation of flag characters:
   *   "P" manual present override   "a" leave approved   "u" leave unapproved
   *   "D" double shift set by hand  "d" double shift cleared by hand
   *   "R" conflict reviewed and accepted
   */
  o?: Record<string, string>;
};

/** attendance_meta/<COMPANY> — SPEC-attendance §9.3 */
export type AttendanceMetaV1 = {
  v: 1;
  c: string;
  u: string; // updatedAt, ISO
  map: Record<string, string>; // biometric device id -> roster employee id
  excluded: string[]; // normalizeKey(name) values
};

/** Closed set — mutually exclusive. Special is a category, not a flag. SPEC §2.1 */
export type Category = "Unskilled" | "Semi-skilled" | "Skilled" | "Special";

export type EmployeeInput = {
  id: string;
  name: string;
  category: Category;
  /** When true: no Sunday package (no auto-paid Sunday, no double pay). SPEC §2.3 / TICKET-02. */
  isSecurity?: boolean;
  monthlySalary: number;
  /**
   * Stored package anchor (M + D×b) for Semi-skilled / Skilled / Special, where
   * the user types M and T and `b` is derived. Absent for Unskilled, whose
   * anchor is `r` and whose total stays derived. SPEC §2.2.
   */
  totalSalary?: number;
  salaryPerDay?: number;
  bonusPerDay?: number;
  daysWorked: number;
  extraDays: number;
  basicPercent?: number;
  pfOptIn?: boolean;
  esiOptIn?: boolean;
  advance?: number | null;
  otherDeduction: number;
  specialBonus?: number | null;
};

export type SalaryRow = EmployeeInput & {
  perDayWage: number;
  salaryPerDay: number;
  bonusPerDay: number;
  dailyBonus: number;
  totalSalary: number;
  absentDays: number;
  absentDeduction: number;
  basicPercent: number;
  earnedSalary: number;
  basicSalary: number;
  hra: number;
  travelAllowance: number;
  /** Computed: (r + b) × extraDays. Not an input. TICKET-10. */
  performanceBonus: number;
  specialBonus: number;
  grossPayable: number;
  pfOptIn: boolean;
  esiOptIn: boolean;
  pfOptedOut: boolean;
  esiOptedOut: boolean;
  employeePf: number;
  employerPf: number;
  esi: number;
  employerEsi: number;
  professionalTax: number;
  netPayable: number;
  totalCost: number;
  /**
   * Category anchor missing after load-time repair (SPEC §2.2.1 / I7).
   * Unskilled needs r > 0; all other categories need M > 0.
   * When true, pay components are zeroed — never silently invent a package.
   */
  missingRate?: boolean;
};
