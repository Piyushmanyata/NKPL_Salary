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
   * Free-text log kept per employee, not per month — increments ("Apr-26 +500"),
   * ID numbers, anything worth remembering about this person. Never read by any
   * calculation; it travels with the shared rate record so every month shows it.
   */
  notes?: string;
  /**
   * Standing Official Monthly Basic for this employee, expressed as the figure
   * that prints at full attendance (A = 26) and prorated below that. Overrides
   * BOTH §6.3 branches — the wage board when PF is on, and the opt-out floor
   * when it is off. Absent or 0 means no pin and the formula applies unchanged.
   * Never touches Reference: net equality packing absorbs it. Issue #29.
   */
  fullAttendanceBasic?: number;
  daysWorked: number;
  extraDays: number;
  basicPercent?: number;
  pfOptIn?: boolean;
  esiOptIn?: boolean;
  /**
   * Consent for the one band ADR-0011 newly made eligible: package above
   * ₹21,000 with Basic at or below it. Those rows were exempt under the old
   * package test, so they stay off until this is explicitly set true — an
   * absent flag is not consent, and `esiOptIn` cannot say this because it
   * defaults to true for every row that was never touched. Ignored outside
   * the band. ADR-0011.
   */
  esiOverLimitOptIn?: boolean;
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
