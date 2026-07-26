import {
  ESI_GROSS_LIMIT,
  ESI_RATE,
  HRA_SHARE_OF_BALANCE,
  PF_BASIC_LIMIT,
  PF_RATE,
  roundMoney,
} from "./salary";
import type { Category, SalaryRow } from "./types";

/** Official wage-board band (three rows). Special borrows Skilled until TICKET-12. */
export type WageCategory = "Unskilled" | "Semi-skilled" | "Skilled";

export type OfficialRow = {
  id: string;
  name: string;
  sourceCategory: string;
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
  professionalTax: number;
  advance?: number | null;
  otherDeduction: number;
  netPayable: number;
  referenceNetPayable: number;
  /** True when no attendance A packs targetGross ≥ basic. SPEC §6.5 / TICKET-09. */
  unpackable: boolean;
};
export const OFFICIAL_WAGE_DAYS = 26;

const wageRules: Record<WageCategory, { employeeTypes: string; basic: number; daily: number }> = {
  Unskilled: {
    employeeTypes: "Cooly, Helper, Peon",
    basic: 10400,
    daily: 400,
  },
  "Semi-skilled": {
    employeeTypes:
      "Assistant Moulder, Assistant Fitter, Assistant Machineman, Assistant Punchingman, Assistant Cuttingman, Assistant Mistry, Durwan",
    basic: 11440,
    daily: 440,
  },
  Skilled: {
    employeeTypes: "Moulder, Fitter, Machineman, Punchingman, Cuttingman, Mistry, Clerk, Typist",
    basic: 12584,
    daily: 484,
  },
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

/** Map roster Category → Official wage-board row (Special → Skilled display band until TICKET-12). */
export function wageBoardCategory(category: Category | string): WageCategory {
  if (category === "Unskilled" || category === "Semi-skilled" || category === "Skilled") {
    return category;
  }
  if (category === "Special") return "Skilled";
  const n = normalizeCategory(category);
  if (n === "Unskilled" || n === "Semi-skilled" || n === "Skilled") return n;
  return "Skilled";
}

/**
 * Official monthly basic for attendance A. SPEC §6.3 / TICKET-08.
 *
 * - PF on  → wage board daily × A (no ₹15,000 display cap; that ceiling is PF-only).
 * - PF off + ESI off → elevated floor max(21100, 0.51 × totalSalary) prorated on 26.
 * - PF off + ESI on  → elevated floor max(15100, 0.51 × totalSalary) prorated on 26.
 *
 * Uses effective `pfOptIn` / `esiOptIn` only (post-eligibility from salary.ts).
 */
export function officialBasic(row: SalaryRow, wageCategory: WageCategory, A: number): number {
  if (A <= 0) return 0;

  // Wage board wins whenever PF is on — ESI opt-out must not elevate the printed basic.
  if (row.pfOptIn) {
    return roundMoney(A * wageRules[wageCategory].daily);
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
 * Base is BASIC (ADR-0002). Never forced on merely because PF is on.
 */
export function officialEsi(row: SalaryRow, basic: number): number {
  if (row.category === "Special") return 0;
  if (!row.esiOptIn) return 0;
  if (basic > ESI_GROSS_LIMIT) return 0;
  return roundMoney(basic * ESI_RATE);
}

function advanceAmount(row: SalaryRow): number {
  return Math.max(0, Number(row.advance) || 0);
}

function targetGrossFor(
  row: SalaryRow,
  pf: number,
  esi: number,
): number {
  return roundMoney(
    row.netPayable + pf + esi + row.professionalTax + advanceAmount(row) + row.otherDeduction,
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
    const esi = officialEsi(row, basic);
    const target = targetGrossFor(row, pf, esi);
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
  const rule = wageRules[wageCategory];
  const monthlyBasic = officialBasic(row, wageCategory, attendance);
  const pf = officialPf(row, monthlyBasic);
  const esiValue = officialEsi(row, monthlyBasic);
  const adv = advanceAmount(row);
  const targetGross = targetGrossFor(row, pf, esiValue);
  const proratedTotal26 = roundMoney((row.totalSalary / OFFICIAL_WAGE_DAYS) * attendance);
  const base = Math.min(proratedTotal26, targetGross);

  const remainder = Math.max(0, base - monthlyBasic);
  const monthlyHra = roundMoney(remainder * HRA_SHARE_OF_BALANCE);
  const monthlyTravelAllowance = roundMoney(remainder - monthlyHra);
  // unpackable → force bonus 0 so no component goes negative when target < basic
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
    employeeTypes: rule.employeeTypes,
    allowedBasic: rule.basic,
    monthlyBasic,
    monthlyHra,
    monthlyTravelAllowance,
    attendance,
    bonus,
    grossPayable,
    pf,
    esi: esiValue,
    professionalTax: row.professionalTax,
    advance: row.advance,
    otherDeduction: row.otherDeduction,
    netPayable,
    referenceNetPayable: row.netPayable,
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
