import type { EmployeeInput, SalaryRow } from "./types";

export const WORKING_DAYS = 31;
export const MIN_MONTH_DAYS = 1;
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
export const MAX_BASIC_PERCENT = 90;

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
  const parsed = shouldUseDefault ? WORKING_DAYS : numberValue(value);
  return Math.max(MIN_MONTH_DAYS, Math.min(MAX_MONTH_DAYS, Math.round(parsed)));
}

export function clampDays(value: number, maxDays = WORKING_DAYS) {
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

export function isSpecialEmployee(name: string): boolean {
  const specialNames = [
    "anjali sodhani",
    "bindu chirania",
    "punit sodhani",
    "rahul somani",
    "rishi jhajharia",
    "sonal goenka"
  ];
  return specialNames.includes(name.trim().toLowerCase());
}

export function calculateSalary(
  input: EmployeeInput,
  options?: {
    basicShare?: number;
    workingDays?: number;
  },
): SalaryRow {
  const workingDays = clampMonthDays(options?.workingDays ?? WORKING_DAYS);
  const basicShare = Math.max(
    MIN_BASIC_PERCENT / 100,
    Math.min(MAX_BASIC_PERCENT / 100, options?.basicShare ?? BASIC_SHARE),
  );
  const monthlySalary = Math.max(0, numberValue(input.monthlySalary));
  const salaryPerMonth = Math.max(0, numberValue(input.salaryPerMonth ?? monthlySalary * basicShare));
  
  const isSpecial = isSpecialEmployee(input.name);
  const daysWorked = isSpecial ? workingDays : clampDays(numberValue(input.daysWorked), workingDays);
  const extraDays = Math.max(0, numberValue(input.extraDays));
  const absentDays = isSpecial ? 0 : Math.max(0, workingDays - daysWorked);
  const requestedPfOptIn = isSpecial ? false : (input.pfOptIn !== false);
  const requestedEsiOptIn = isSpecial ? false : (input.esiOptIn !== false);
  const advance = numberValue(input.advance);
  const otherDeduction = Math.max(0, numberValue(input.otherDeduction));
  const perDayWage = monthlySalary / workingDays;
  const perDaySalaryPerMonth = salaryPerMonth / workingDays;
  const absentDeduction = isSpecial ? 0 : perDayWage * absentDays;
  const salaryPerMonthBase = isSpecial ? salaryPerMonth : Math.max(0, salaryPerMonth - perDaySalaryPerMonth * absentDays);
  const performanceBonus = perDayWage * extraDays;
  const specialBonus = Math.max(0, numberValue(input.specialBonus));
  const earnedSalary = salaryPerMonthBase;
  const grossBeforeDeduction = earnedSalary;
  const baseBasicSalary = grossBeforeDeduction * basicShare;
  
  // PF: Voluntary above 15,000, but if enabled it is capped at PF_BASIC_LIMIT (15,000) basic salary.
  const pfOptIn = requestedPfOptIn;
  
  // ESI: Applicable if Gross Salary (grossBeforeDeduction) is at or below ESI_GROSS_LIMIT (21,000).
  const esiOptIn = requestedEsiOptIn && grossBeforeDeduction <= ESI_GROSS_LIMIT;
  
  const basicSalary = Math.min(grossBeforeDeduction, Math.max(0, baseBasicSalary));
  const remainingSalary = Math.max(0, monthlySalary - absentDeduction - basicSalary);
  const hra = remainingSalary * HRA_SHARE_OF_BALANCE;
  const travelAllowance = remainingSalary * TA_SHARE_OF_BALANCE;
  
  const employeePf = pfOptIn ? roundMoney(Math.min(basicSalary, PF_BASIC_LIMIT) * PF_RATE) : 0;
  const employerPf = pfOptIn ? roundMoney(Math.min(basicSalary, PF_BASIC_LIMIT) * PF_RATE) : 0;
  
  // ESI is calculated on Salary/Month, adjusted for attendance.
  const esi = esiOptIn ? roundMoney(salaryPerMonthBase * ESI_RATE) : 0;
  const employerEsi = esiOptIn ? roundMoney(salaryPerMonthBase * ESI_EMPLOYER_RATE) : 0;
  
  const grossPayable = basicSalary + hra + travelAllowance + performanceBonus + specialBonus;
  const professionalTax = otherDeduction > 0 ? 0 : calculateProfessionalTax(grossPayable);
  const netPayable = grossPayable - employeePf - esi - professionalTax + advance - otherDeduction;

  return {
    ...input,
    basicPercent: Math.round(basicShare * 100),
    monthlySalary,
    salaryPerMonth,
    daysWorked,
    extraDays,
    absentDays,
    pfOptIn,
    esiOptIn,
    advance: input.advance,
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
