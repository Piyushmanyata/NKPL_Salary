import {
  ESI_EMPLOYER_RATE,
  ESI_GROSS_LIMIT,
  ESI_RATE,
  HRA_SHARE_OF_BALANCE,
  PF_BASIC_LIMIT,
  PF_RATE,
  roundMoney,
} from "./salary";
import type { Category, SalaryRow } from "./types";

/** Official wage-board band with a daily rate (three rows). Special has none. */
export type WageCategory = "Unskilled" | "Semi-skilled" | "Skilled";

export type OfficialRow = {
  id: string;
  name: string;
  sourceCategory: string;
  /** Display wage-board band; Special borrows Skilled (SPEC A1). */
  wageCategory: WageCategory;
  employeeTypes: string;
  allowedBasic: number;
  monthlyBasic: number;
  monthlyHra: number;
  monthlyTravelAllowance: number;
  attendance: number;
  bonus: number;
  grossPayable: number;
  pf: number;
  esi: number;
  employerEsi: number;
  professionalTax: number;
  advance?: number | null;
  otherDeduction: number;
  netPayable: number;
  referenceNetPayable: number;
  /** True when no attendance A packs targetGross ≥ basic. SPEC §6.5 / TICKET-09. */
  unpackable: boolean;
};
export const OFFICIAL_WAGE_DAYS = 26;

/** Wage-board daily basic rates. Special is intentionally absent. SPEC §6.1 / TICKET-12. */
export const WAGE_BOARD_DAILY: Record<WageCategory, number> = {
  Unskilled: 400,
  "Semi-skilled": 440,
  Skilled: 484,
};

const SKILLED_DISPLAY = {
  employeeTypes: "Moulder, Fitter, Machineman, Punchingman, Cuttingman, Mistry, Clerk, Typist",
  allowedBasic: 12584,
} as const;

/**
 * Display-only Official columns. Special borrows the Skilled row (SPEC A1 / TICKET-12).
 * Basic money never comes from this table for Special — opt-out formula only.
 */
const DISPLAY_ROW: Record<Category, { employeeTypes: string; allowedBasic: number }> = {
  Unskilled: {
    employeeTypes: "Cooly, Helper, Peon",
    allowedBasic: 10400,
  },
  "Semi-skilled": {
    employeeTypes:
      "Assistant Moulder, Assistant Fitter, Assistant Machineman, Assistant Punchingman, Assistant Cuttingman, Assistant Mistry, Durwan",
    allowedBasic: 11440,
  },
  Skilled: { ...SKILLED_DISPLAY },
  Special: { ...SKILLED_DISPLAY },
};

/**
 * Normalize category formatting only — never infer grade from salary.
 * Returns null when unrecognizable. TICKET-11 / SPEC §6.1.
 */
const CANONICAL: Record<string, Category> = {
  unskilled: "Unskilled",
  labour: "Unskilled",
  cooly: "Unskilled",
  helper: "Unskilled",
  peon: "Unskilled",
  semiskilled: "Semi-skilled",
  "semi skilled": "Semi-skilled",
  "semi-skilled": "Semi-skilled",
  skilled: "Skilled",
  special: "Special",
};

export function normalizeCategory(value: unknown): Category | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  // Keep spaces for "semi skilled"; also try stripped key.
  const spaced = raw.replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
  const compact = spaced.replace(/\s+/g, "");
  return CANONICAL[spaced] ?? CANONICAL[compact] ?? CANONICAL[raw] ?? null;
}

/** Map roster Category → Official wage-board band for daily rates (Special → Skilled display). */
export function wageBoardCategory(category: Category | string): WageCategory {
  if (category === "Unskilled" || category === "Semi-skilled" || category === "Skilled") {
    return category;
  }
  if (category === "Special") return "Skilled";
  const n = normalizeCategory(category);
  if (n === "Unskilled" || n === "Semi-skilled" || n === "Skilled") return n;
  return "Skilled";
}

function displayFor(category: Category | string): { employeeTypes: string; allowedBasic: number } {
  if (category === "Unskilled" || category === "Semi-skilled" || category === "Skilled" || category === "Special") {
    return DISPLAY_ROW[category];
  }
  const n = normalizeCategory(category);
  if (n) return DISPLAY_ROW[n];
  return DISPLAY_ROW.Skilled;
}

/**
 * Official monthly basic for attendance A. SPEC §6.3 / TICKET-08 / TICKET-12.
 *
 * - PF on  → wage board daily × A (Special cannot have PF — throws).
 * - PF off + ESI off → elevated floor max(21100, 0.51 × totalSalary) prorated on 26.
 * - PF off + ESI on  → elevated floor max(15100, 0.51 × totalSalary) prorated on 26.
 */
export function officialBasic(row: SalaryRow, wageCategory: WageCategory, A: number): number {
  if (A <= 0) return 0;

  if (row.pfOptIn) {
    if (row.category === "Special") {
      throw new Error("Invariant: Special employees cannot have PF on");
    }
    return roundMoney(A * WAGE_BOARD_DAILY[wageCategory]);
  }

  const fullMonthRate = !row.esiOptIn
    ? Math.max(21100, Math.round(row.totalSalary * 0.51))
    : Math.max(15100, Math.round(row.totalSalary * 0.51));
  return roundMoney((fullMonthRate / OFFICIAL_WAGE_DAYS) * A);
}

/** Official employee PF: 12% of min(basic, 15,000) when PF is on. SPEC §6.4 */
export function officialPf(row: SalaryRow, basic: number): number {
  if (!row.pfOptIn) return 0;
  return roundMoney(Math.min(basic, PF_BASIC_LIMIT) * PF_RATE);
}

/**
 * Official employee ESI: 0.75% of Official basic when eligible.
 * Base is BASIC. Never forced on merely because PF is on.
 */
export function officialEsi(row: SalaryRow, basic: number): number {
  if (row.category === "Special") return 0;
  if (!row.esiOptIn) return 0;
  if (basic > ESI_GROSS_LIMIT) return 0;
  return roundMoney(basic * ESI_RATE);
}

/** Official employer ESI follows the same Official-basic eligibility as employee ESI. */
export function officialEmployerEsi(row: SalaryRow, basic: number): number {
  if (officialEsi(row, basic) <= 0) return 0;
  return roundMoney(basic * ESI_EMPLOYER_RATE);
}

function advanceAmount(row: SalaryRow): number {
  return Math.max(0, Number(row.advance) || 0);
}

/**
 * The ESI amount is aligned to Official after attendance is selected, so the
 * packing target starts from the Reference net before ESI. This keeps the
 * target stable while moving the ESI rupee from Reference to Official.
 */
function targetGrossFor(row: SalaryRow, pf: number): number {
  return roundMoney(
    row.netPayable + row.esi + pf + row.professionalTax + advanceAmount(row) + row.otherDeduction,
  );
}

/**
 * Walk A from aMax down to aMin; first A with targetGross ≥ officialBasic packs.
 * If none pack, return aMin with unpackable=true. SPEC §6.5 / TICKET-09.
 */
export function pickPackableAttendance(
  row: SalaryRow,
  wageCategory: WageCategory,
  aMax: number,
  aMin: number,
): { attendance: number; unpackable: boolean } {
  for (let A = aMax; A >= aMin; A -= 1) {
    const basic = officialBasic(row, wageCategory, A);
    const pf = officialPf(row, basic);
    const target = targetGrossFor(row, pf);
    if (target >= basic) {
      return { attendance: A, unpackable: false };
    }
  }
  return { attendance: aMin, unpackable: true };
}

/**
 * Assemble Official components for a chosen attendance. Net is always computed
 * from components — never copied from Reference. SPEC §6.6 / TICKET-09.
 */
export function assembleOfficialRow(
  row: SalaryRow,
  wageCategory: WageCategory,
  attendance: number,
  unpackable: boolean,
): OfficialRow {
  const display = displayFor(row.category);
  const monthlyBasic = officialBasic(row, wageCategory, attendance);
  const pf = officialPf(row, monthlyBasic);
  const esiValue = officialEsi(row, monthlyBasic);
  const employerEsi = officialEmployerEsi(row, monthlyBasic);
  const adv = advanceAmount(row);
  const targetGross = targetGrossFor(row, pf);
  const proratedTotal26 = roundMoney((row.totalSalary / OFFICIAL_WAGE_DAYS) * attendance);
  const base = Math.min(proratedTotal26, targetGross);

  const remainder = Math.max(0, base - monthlyBasic);
  const monthlyHra = roundMoney(remainder * HRA_SHARE_OF_BALANCE);
  const monthlyTravelAllowance = roundMoney(remainder - monthlyHra);
  const bonus = unpackable
    ? 0
    : roundMoney(targetGross - (monthlyBasic + monthlyHra + monthlyTravelAllowance));
  const grossPayable = roundMoney(monthlyBasic + monthlyHra + monthlyTravelAllowance + bonus);
  const netPayable = roundMoney(
    grossPayable - pf - esiValue - row.professionalTax - adv - row.otherDeduction,
  );

  return {
    id: row.id,
    name: row.name,
    sourceCategory: row.category,
    wageCategory,
    employeeTypes: display.employeeTypes,
    allowedBasic: display.allowedBasic,
    monthlyBasic,
    monthlyHra,
    monthlyTravelAllowance,
    attendance,
    bonus,
    grossPayable,
    pf,
    esi: esiValue,
    employerEsi,
    professionalTax: row.professionalTax,
    advance: row.advance,
    otherDeduction: row.otherDeduction,
    netPayable,
    referenceNetPayable: roundMoney(row.netPayable + row.esi - esiValue),
    unpackable,
  };
}

/**
 * Single Official path for every employee. Attendance uses the 26-day wage-board
 * frame regardless of PF. SPEC §6.2 / TICKET-07 + packing/net from TICKET-09.
 */
export function buildOfficialRow(row: SalaryRow, monthDays: number): OfficialRow {
  const wageCategory = wageBoardCategory(row.category);

  const absentDays = Math.max(0, monthDays - row.daysWorked);
  const aMax = Math.max(0, Math.min(OFFICIAL_WAGE_DAYS, OFFICIAL_WAGE_DAYS - absentDays));
  const aMin = row.daysWorked > 0 ? 1 : 0;

  const { attendance, unpackable } = pickPackableAttendance(row, wageCategory, aMax, aMin);
  return assembleOfficialRow(row, wageCategory, attendance, unpackable);
}
