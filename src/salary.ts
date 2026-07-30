import type { Category, EmployeeInput, SalaryRow } from "./types";

/** Fallback only when a month label cannot be parsed. Never 31. SPEC §3 / TICKET-03. */
export const DEFAULT_MONTH_DAYS = 30;
export const MIN_MONTH_DAYS = 28;
export const MAX_MONTH_DAYS = 31;
export const BASIC_SHARE = 0.5;
export const HRA_SHARE_OF_BALANCE = 0.7;
export const TA_SHARE_OF_BALANCE = 0.3;
export const PF_RATE = 0.12;
export const ESI_RATE = 0.0075;
export const ESI_EMPLOYER_RATE = 0.0325;
export const PF_BASIC_LIMIT = 15000;
export const ESI_GROSS_LIMIT = 21000;
export const MIN_BASIC_PERCENT = 50;
export const MAX_BASIC_PERCENT = 100;

export function currency(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

export function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

export function clampMonthDays(value: unknown) {
  const shouldUseDefault =
    value === undefined || value === null || (typeof value === "string" && value.trim() === "");
  const parsed = shouldUseDefault ? DEFAULT_MONTH_DAYS : numberValue(value);
  return Math.max(MIN_MONTH_DAYS, Math.min(MAX_MONTH_DAYS, Math.round(parsed)));
}

export function clampDays(value: number, maxDays: number) {
  return Math.max(0, Math.min(clampMonthDays(maxDays), value || 0));
}

export function clampBasicPercent(value: unknown) {
  return Math.max(MIN_BASIC_PERCENT, Math.min(MAX_BASIC_PERCENT, numberValue(value) || 70));
}

export function calculateProfessionalTax(monthlyWages: number) {
  const wages = Math.max(0, numberValue(monthlyWages));
  if (wages <= 10000) {
    return 0;
  }
  if (wages <= 15000) {
    return 110;
  }
  if (wages <= 25000) {
    return 130;
  }
  if (wages <= 40000) {
    return 150;
  }
  return 200;
}

export function isSpecialCategory(category: Category | string | undefined | null): boolean {
  return category === "Special";
}

/**
 * The two ways one salary can be typed: M = D × r. Used by the Per Day / Per
 * Month toggle in Settings so switching the input mode is lossless, and by
 * repairRates for the same conversion at load time.
 */
export function monthlyFromDaily(salaryPerDay: unknown, monthDays: unknown) {
  return roundMoney(clampMonthDays(monthDays) * Math.max(0, numberValue(salaryPerDay)));
}

export function dailyFromMonthly(monthlySalary: unknown, monthDays: unknown) {
  return roundMoney(Math.max(0, numberValue(monthlySalary)) / clampMonthDays(monthDays));
}

/**
 * SPEC §2.2.1 — one-time rate repair at load/migration.
 *
 * Must NOT run inside `calculateSalary`. Per-calculation Unskilled back-fill
 * re-derives r from M every month and silently turns Labour into fixed-monthly
 * (I10 failures). Call this once, persist the result, then assert.
 */
export function repairRates(
  category: Category,
  monthlySalary: number,
  salaryPerDay: number,
  bonusPerDay: number,
  monthDays: number,
): {
  salaryPerDay: number;
  monthlySalary: number;
  bonusPerDay: number;
  missingRate: boolean;
} {
  const D = clampMonthDays(monthDays);
  let r = Math.max(0, numberValue(salaryPerDay));
  let M = Math.max(0, numberValue(monthlySalary));
  let b = Math.max(0, numberValue(bonusPerDay));

  if (category === "Unskilled") {
    if (r <= 0 && M > 0) {
      r = dailyFromMonthly(M, D);
    }
  } else {
    if (M <= 0 && r > 0) {
      M = monthlyFromDaily(r, D);
    }
    if (category === "Special") {
      r = 0;
      b = 0;
    }
  }

  const missingRate = category === "Unskilled" ? r <= 0 : M <= 0;
  return { salaryPerDay: r, monthlySalary: M, bonusPerDay: b, missingRate };
}

export function calculateSalary(
  input: EmployeeInput,
  options?: {
    basicShare?: number;
    workingDays?: number;
  },
): SalaryRow {
  const workingDays = clampMonthDays(options?.workingDays ?? DEFAULT_MONTH_DAYS);
  const basicShare = Math.max(
    MIN_BASIC_PERCENT / 100,
    Math.min(MAX_BASIC_PERCENT / 100, options?.basicShare ?? BASIC_SHARE),
  );

  const category = input.category;
  const isSpecial = isSpecialCategory(category);
  const isSecurity = input.isSecurity === true;

  let salaryPerDay = Math.max(0, numberValue(input.salaryPerDay));
  let monthlySalary = Math.max(0, numberValue(input.monthlySalary));
  let bonusPerDay = Math.max(0, numberValue(input.bonusPerDay));

  // Assert anchors only — no back-fill here (SPEC §2.2.1 / I10 / TICKET-04).
  const missingRate =
    category === "Unskilled" ? salaryPerDay <= 0 : monthlySalary <= 0;

  const daysWorked = isSpecial ? workingDays : clampDays(numberValue(input.daysWorked), workingDays);
  // Special has no Extra Days at all. Security gets no *automatic* Sunday
  // package — the attendance layer never grants them one — but a typed Extra
  // Day is honoured, because approved extra work is a manual decision.
  const extraDays = isSpecial ? 0 : Math.max(0, numberValue(input.extraDays));
  // Stored positive = amount advanced and recovered this month. Engine always
  // subtracts. Negative input is clamped to 0 at the boundary (TICKET-06).
  const advance = Math.max(0, numberValue(input.advance));
  const otherDeduction = Math.max(0, numberValue(input.otherDeduction));
  const specialBonus = Math.max(0, numberValue(input.specialBonus));

  if (missingRate) {
    // Never invent a package. Surface in UI; leave money components at zero.
    return {
      ...input,
      category,
      isSecurity,
      missingRate: true,
      basicPercent: Math.round(basicShare * 100),
      monthlySalary,
      salaryPerDay: isSpecial ? 0 : salaryPerDay,
      bonusPerDay: isSpecial ? 0 : bonusPerDay,
      dailyBonus: 0,
      totalSalary: 0,
      daysWorked,
      extraDays,
      absentDays: isSpecial ? 0 : Math.max(0, workingDays - daysWorked),
      pfOptIn: false,
      esiOptIn: false,
      pfOptedOut: true,
      esiOptedOut: true,
      advance,
      otherDeduction,
      perDayWage: 0,
      absentDeduction: 0,
      earnedSalary: 0,
      basicSalary: 0,
      hra: 0,
      travelAllowance: 0,
      performanceBonus: 0,
      specialBonus: 0,
      grossPayable: 0,
      employeePf: 0,
      employerPf: 0,
      esi: 0,
      employerEsi: 0,
      professionalTax: 0,
      netPayable: 0,
      totalCost: 0,
    };
  }

  // Rate anchoring by Category — SPEC §2.2 (anchors already present)
  switch (category) {
    case "Special":
      salaryPerDay = 0;
      bonusPerDay = 0;
      // monthlySalary used exactly as stored — never rescaled by workingDays
      break;
    case "Unskilled":
      // Day rate is source of truth; monthly = D × r
      monthlySalary = roundMoney(workingDays * salaryPerDay);
      break;
    case "Semi-skilled":
    case "Skilled":
    default:
      // Monthly is source of truth; day rate floats with D
      salaryPerDay = roundMoney(monthlySalary / workingDays);
      break;
  }

  // Fixed-monthly categories anchor on M and T (both typed); b is derived, never
  // typed. Unskilled keeps r/b as the anchors and leaves T derived. Absent a
  // stored T this is a no-op, so legacy rosters compute exactly as before.
  const storedTotal = Math.max(0, numberValue(input.totalSalary));
  const usesStoredTotal = category !== "Unskilled" && storedTotal > monthlySalary;
  if (usesStoredTotal && !isSpecial) {
    bonusPerDay = roundMoney((storedTotal - monthlySalary) / workingDays);
  }

  const dailyBonus = isSpecial ? 0 : roundMoney(workingDays * bonusPerDay);
  const totalSalary = usesStoredTotal ? storedTotal : roundMoney(monthlySalary + dailyBonus);

  const absentDays = isSpecial ? 0 : Math.max(0, workingDays - daysWorked);
  const standardBasic = monthlySalary * basicShare;
  const hasBasicAbove15k = standardBasic > 15000;
  const requestedPfOptIn = (isSpecial || hasBasicAbove15k) ? false : (input.pfOptIn !== false);
  const requestedEsiOptIn = isSpecial ? false : (input.esiOptIn !== false);
  const perDayWage = salaryPerDay;
  const absentDeduction = isSpecial ? 0 : perDayWage * absentDays;
  const performanceBonus = isSpecial ? 0 : (perDayWage + bonusPerDay) * extraDays;

  const earnedSalary = isSpecial ? monthlySalary : Math.max(0, monthlySalary - absentDeduction);

  // Prorate daily bonus according to present days
  const earnedBonus = isSpecial ? 0 : roundMoney(daysWorked * bonusPerDay);
  const proratedTotalSalary = earnedSalary + earnedBonus;

  const grossBeforeDeduction = earnedSalary;
  const baseBasicSalary = grossBeforeDeduction * basicShare;

  const pfOptIn = requestedPfOptIn;
  const basicSalary = Math.min(grossBeforeDeduction, Math.max(0, baseBasicSalary));

  const remainingSalary = Math.max(0, proratedTotalSalary - basicSalary);
  const hra = remainingSalary * HRA_SHARE_OF_BALANCE;
  const travelAllowance = remainingSalary * TA_SHARE_OF_BALANCE;

  // Source workbook `=ROUND(IF(V<=15000, V*12%, 0), 0)` — whole rupee (ADR-0004).
  const employeePf = pfOptIn ? Math.round(Math.min(basicSalary, PF_BASIC_LIMIT) * PF_RATE) : 0;
  const employerPf = employeePf;

  const grossPayable = basicSalary + hra + travelAllowance + performanceBonus + specialBonus;

  // Source workbook `=IF(J<=21000, ROUNDUP(O*0.75%, 0), 0)` — eligibility on Total
  // Salary (the package), base on Earned Salary, rounded up to the rupee (ADR-0004).
  const esiOptIn = requestedEsiOptIn && totalSalary <= ESI_GROSS_LIMIT;
  const esi = esiOptIn ? Math.ceil(earnedSalary * ESI_RATE) : 0;
  const employerEsi = esiOptIn ? Math.ceil(earnedSalary * ESI_EMPLOYER_RATE) : 0;

  // TDS payers are exempt from Professional Tax (TICKET-15, resolved 2026-07-29).
  // Official copies this figure, so the exemption reaches both sheets from here.
  const professionalTax = otherDeduction > 0 ? 0 : calculateProfessionalTax(grossPayable);
  const netPayable = grossPayable - employeePf - esi - professionalTax - advance - otherDeduction;

  return {
    ...input,
    category,
    isSecurity,
    missingRate: false,
    basicPercent: Math.round(basicShare * 100),
    monthlySalary,
    salaryPerDay,
    bonusPerDay,
    dailyBonus: earnedBonus,
    totalSalary,
    daysWorked,
    extraDays,
    absentDays,
    pfOptIn,
    esiOptIn,
    pfOptedOut: input.pfOptIn === false,
    esiOptedOut: input.esiOptIn === false,
    advance,
    otherDeduction,
    perDayWage,
    absentDeduction,
    earnedSalary,
    basicSalary,
    hra,
    travelAllowance,
    performanceBonus,
    specialBonus,
    grossPayable,
    employeePf,
    employerPf,
    esi,
    employerEsi,
    professionalTax,
    netPayable,
    totalCost: grossPayable + employerPf + employerEsi,
  };
}


export function roundMoney(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

export function uid() {
  return `emp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
