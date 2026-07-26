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
    manualOverride?: "present";
    leaveType?: "approved" | "unapproved";
  }>;
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
  salaryPerDay?: number;
  bonusPerDay?: number;
  daysWorked: number;
  extraDays: number;
  basicPercent?: number;
  pfOptIn?: boolean;
  esiOptIn?: boolean;
  advance?: number | null;
  otherDeduction: number;
  officialAttendance?: number;
  officialBonus?: number;
  specialBonus?: number | null;
  performanceBonus?: number | null;
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
};
