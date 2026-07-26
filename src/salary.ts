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

  let salaryPerDay = Math.max(0, numberValue(input.salaryPerDay));
  let monthlySalary = Math.max(0, numberValue(input.monthlySalary));
  let bonusPerDay = Math.max(0, numberValue(input.bonusPerDay));

  // Rate anchoring by Category — SPEC §2.2 / TICKET-01
  switch (category) {
    case "Special":
      salaryPerDay = 0;
      bonusPerDay = 0;
      // monthlySalary used exactly as stored — never rescaled by workingDays
      break;
    case "Unskilled":
      // Day rate is source of truth; monthly = D × r (TICKET-04 back-fill when day rate missing)
      if (salaryPerDay <= 0 && monthlySalary > 0) {
        salaryPerDay = roundMoney(monthlySalary / workingDays);
      }
      monthlySalary = roundMoney(workingDays * salaryPerDay);
      break;
    case "Semi-skilled":
    case "Skilled":
    default:
      if (monthlySalary > 0) {
        salaryPerDay = roundMoney(monthlySalary / workingDays);
      } else if (salaryPerDay > 0) {
        monthlySalary = roundMoney(workingDays * salaryPerDay);
      }
      break;
  }

  const dailyBonus = isSpecial ? 0 : roundMoney(workingDays * bonusPerDay);
  const totalSalary = roundMoney(monthlySalary + dailyBonus);

  const daysWorked = isSpecial ? workingDays : clampDays(numberValue(input.daysWorked), workingDays);
  const extraDays = isSpecial ? 0 : Math.max(0, numberValue(input.extraDays));
  const absentDays = isSpecial ? 0 : Math.max(0, workingDays - daysWorked);
  const standardBasic = monthlySalary * basicShare;
  const hasBasicAbove15k = standardBasic > 15000;
  const requestedPfOptIn = (isSpecial || hasBasicAbove15k) ? false : (input.pfOptIn !== false);
  const requestedEsiOptIn = isSpecial ? false : (input.esiOptIn !== false);
  // Stored positive = amount advanced and recovered this month. Engine always
  // subtracts. Negative input is clamped to 0 at the boundary (TICKET-06).
  const advance = Math.max(0, numberValue(input.advance));
  const otherDeduction = Math.max(0, numberValue(input.otherDeduction));
  const perDayWage = salaryPerDay;
  const absentDeduction = isSpecial ? 0 : perDayWage * absentDays;
  const performanceBonus = isSpecial ? 0 : (perDayWage + bonusPerDay) * extraDays;
  const specialBonus = Math.max(0, numberValue(input.specialBonus));

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
  
  const employeePf = pfOptIn ? roundMoney(Math.min(basicSalary, PF_BASIC_LIMIT) * PF_RATE) : 0;
  const employerPf = pfOptIn ? roundMoney(Math.min(basicSalary, PF_BASIC_LIMIT) * PF_RATE) : 0;
  
  const grossPayable = basicSalary + hra + travelAllowance + performanceBonus + specialBonus;
  const esiOptIn = requestedEsiOptIn && grossPayable <= ESI_GROSS_LIMIT;
  
  const esi = esiOptIn ? roundMoney(grossPayable * ESI_RATE) : 0;
  const employerEsi = esiOptIn ? roundMoney(grossPayable * ESI_EMPLOYER_RATE) : 0;
  
  const professionalTax = calculateProfessionalTax(grossPayable);
  const netPayable = grossPayable - employeePf - esi - professionalTax - advance - otherDeduction;

  return {
    ...input,
    category,
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
