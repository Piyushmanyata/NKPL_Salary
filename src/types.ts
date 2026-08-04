/** Closed set — mutually exclusive. Special is a category, not a flag. SPEC §2.1 */
export type Category = "Unskilled" | "Semi-skilled" | "Skilled" | "Special";

export type EmployeeInput = {
  id: string;
  name: string;
  category: Category;
  monthlySalary: number;
  /**
   * Stored package anchor (M + D×b) for Semi-skilled / Skilled / Special, where
   * the user types M and T and `b` is derived. Absent for Unskilled, whose
   * anchor is `r` and whose total stays derived. SPEC §2.2.
   */
  totalSalary?: number;
  salaryPerDay?: number;
  bonusPerDay?: number;
  /**
   * How the monthly allowance was typed — "400+500+600" — kept verbatim so the
   * row shows the raises that built it. Its sum is the allowance; T = M + sum.
   * Absent means the allowance was entered as a plain number.
   */
  allowanceExpr?: string;
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
