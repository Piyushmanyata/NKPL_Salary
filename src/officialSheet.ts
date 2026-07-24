import {
  ESI_GROSS_LIMIT,
  ESI_RATE,
  HRA_SHARE_OF_BALANCE,
  PF_BASIC_LIMIT,
  PF_RATE,
  clampDays,
  numberValue,
  roundMoney,
} from "./salary";
import type { SalaryRow } from "./types";

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
  officialAttendance?: number;
  officialBonus?: number;
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

export function classifyWageCategory(row: SalaryRow): WageCategory {
  return normalizeWageCategory(row.category, row.monthlySalary);
}

export function normalizeWageCategory(value: string, monthlySalary?: number): WageCategory {
  const trimmed = value.trim();
  if (trimmed === "Skilled" || trimmed === "Semi-skilled" || trimmed === "Unskilled") {
    return trimmed;
  }
  const salary = Math.max(0, numberValue(monthlySalary));
  if (salary > 0) {
    if (salary < 12000) {
      return "Unskilled";
    }
    if (salary < 20000) {
      return "Semi-skilled";
    }
    return "Skilled";
  }
  const text = value.toLowerCase();
  if (
    text.includes("unskilled") ||
    text.includes("cooly") ||
    text.includes("helper") ||
    text.includes("peon")
  ) {
    return "Unskilled";
  }
  if (
    text.includes("semi") ||
    text.includes("assistant") ||
    text.includes("security") ||
    text.includes("durwan")
  ) {
    return "Semi-skilled";
  }
  return "Skilled";
}

function clampOfficialAttendance(value: unknown) {
  return Math.max(0, Math.min(OFFICIAL_WAGE_DAYS, Math.floor(numberValue(value))));
}

function getOptOutBasicRate(totalSalary: number, hasNoPf: boolean, hasNoEsi: boolean): number {
  if (hasNoEsi) {
    return Math.max(21100, Math.round(totalSalary * 0.51));
  }
  if (hasNoPf) {
    return Math.max(15100, Math.round(totalSalary * 0.51));
  }
  return 0;
}

interface StatutoryComponents {
  pf: number;
  esiValue: number;
  monthlyHra: number;
  monthlyTravelAllowance: number;
  bonus: number;
  grossPayable: number;
}

function calculateStatutoryComponents(
  row: SalaryRow,
  monthlyBasic: number,
  isOptOut: boolean,
  proratedTotalSalary: number,
  hasNoEsi: boolean
): StatutoryComponents {
  const pf = row.pfOptIn ? roundMoney(Math.min(monthlyBasic, PF_BASIC_LIMIT) * PF_RATE) : 0;
  const esiActive = !hasNoEsi && row.esiOptIn && monthlyBasic <= ESI_GROSS_LIMIT;
  const esiValue = esiActive ? roundMoney(monthlyBasic * ESI_RATE) : 0;
  const targetGross = Math.max(
    0,
    row.netPayable + pf + esiValue + row.professionalTax + (row.advance || 0) + row.otherDeduction
  );
  
  const remainingForHraTa = isOptOut ? Math.max(0, targetGross - monthlyBasic) : Math.max(0, proratedTotalSalary - monthlyBasic);
  const monthlyHra = roundMoney(remainingForHraTa * HRA_SHARE_OF_BALANCE);
  const monthlyTravelAllowance = roundMoney(remainingForHraTa - monthlyHra);
  const bonus = isOptOut ? 0 : Math.max(0, roundMoney(targetGross - (monthlyBasic + monthlyHra + monthlyTravelAllowance)));
  const grossPayable = roundMoney(monthlyBasic + monthlyHra + monthlyTravelAllowance + bonus);

  return { pf, esiValue, monthlyHra, monthlyTravelAllowance, bonus, grossPayable };
}

export function buildReferenceOfficialRow(row: SalaryRow, monthDays: number): OfficialRow {
  const wageCategory = classifyWageCategory(row);
  const rule = wageRules[wageCategory];
  const attendance = row.daysWorked;
  const proratedTotalSalary = roundMoney((row.totalSalary / monthDays) * attendance);
  const hasNoPf = !row.pfOptIn || row.pfOptedOut;
  const hasNoEsi = !row.esiOptIn || row.esiOptedOut;
  const isOptOut = (hasNoPf || hasNoEsi) && attendance > 0;
  const fullMonthBasicRate = getOptOutBasicRate(row.totalSalary, hasNoPf, hasNoEsi);
  
  const monthlyBasic = isOptOut ? roundMoney((fullMonthBasicRate / monthDays) * attendance) : row.basicSalary;
  const stats = calculateStatutoryComponents(row, monthlyBasic, isOptOut, proratedTotalSalary, hasNoEsi);

  return {
    id: row.id,
    name: row.name,
    sourceCategory: row.category,
    wageCategory,
    employeeTypes: rule.employeeTypes,
    allowedBasic: rule.basic,
    monthlyBasic,
    monthlyHra: stats.monthlyHra,
    monthlyTravelAllowance: stats.monthlyTravelAllowance,
    attendance,
    bonus: stats.bonus,
    officialAttendance: row.officialAttendance,
    officialBonus: row.officialBonus,
    grossPayable: stats.grossPayable,
    pf: stats.pf,
    esi: stats.esiValue,
    professionalTax: row.professionalTax,
    advance: row.advance,
    otherDeduction: row.otherDeduction,
    netPayable: row.netPayable,
    referenceNetPayable: row.netPayable,
  };
}

export function buildOfficialRow(row: SalaryRow, monthDays: number): OfficialRow {
  const pfActive = row.pfOptIn;

  if (!pfActive) {
    return buildReferenceOfficialRow(row, monthDays);
  }

  const wageCategory = classifyWageCategory(row);
  const rule = wageRules[wageCategory];
  const presentDays = clampDays(row.daysWorked, monthDays);
  const absentDays = Math.max(0, monthDays - presentDays);

  const minCandidate = row.daysWorked > 0 ? 1 : 0;
  const formulaAttendance = Math.max(
    minCandidate,
    clampOfficialAttendance(OFFICIAL_WAGE_DAYS - absentDays),
  );

  let attendance = minCandidate;
  for (let candidate = formulaAttendance; candidate >= minCandidate; candidate -= 1) {
    const candidateProratedTotalSalary = roundMoney((row.totalSalary / OFFICIAL_WAGE_DAYS) * candidate);
    let candidateBasic = roundMoney(candidate * rule.daily);
    const hasNoPf = !row.pfOptIn || row.pfOptedOut;
    const hasNoEsi = !row.esiOptIn || row.esiOptedOut;
    if ((hasNoPf || hasNoEsi) && candidate > 0) {
      const fullMonthBasicRate = getOptOutBasicRate(row.totalSalary, hasNoPf, hasNoEsi);
      candidateBasic = roundMoney((fullMonthBasicRate / OFFICIAL_WAGE_DAYS) * candidate);
    }
    if (pfActive) {
      candidateBasic = Math.min(candidateBasic, PF_BASIC_LIMIT);
    }
    const candidatePf = roundMoney(Math.min(candidateBasic, PF_BASIC_LIMIT) * PF_RATE);
    const candidateEsiActive = !hasNoEsi && row.esiOptIn && candidateBasic <= ESI_GROSS_LIMIT;
    const candidateEsi = candidateEsiActive ? roundMoney(candidateBasic * ESI_RATE) : 0;
    const candidateGross = Math.max(
      0,
      row.netPayable +
        candidatePf +
        candidateEsi +
        row.professionalTax +
        (row.advance || 0) +
        row.otherDeduction,
    );

    if ((candidateGross >= candidateProratedTotalSalary && candidateGross >= candidateBasic) || candidate === minCandidate) {
      attendance = candidate;
      break;
    }
  }

  const proratedTotalSalary = roundMoney((row.totalSalary / OFFICIAL_WAGE_DAYS) * attendance);
  const hasNoPf = !row.pfOptIn || row.pfOptedOut;
  const hasNoEsi = !row.esiOptIn || row.esiOptedOut;
  const isOptOut = (hasNoPf || hasNoEsi) && attendance > 0;
  const fullMonthBasicRate = getOptOutBasicRate(row.totalSalary, hasNoPf, hasNoEsi);
  
  let statutoryBasic = isOptOut 
    ? roundMoney((fullMonthBasicRate / OFFICIAL_WAGE_DAYS) * attendance) 
    : roundMoney(attendance * rule.daily);
  if (pfActive) {
    statutoryBasic = Math.min(statutoryBasic, PF_BASIC_LIMIT);
  }
  const monthlyBasic = statutoryBasic;
  const stats = calculateStatutoryComponents(row, monthlyBasic, isOptOut, proratedTotalSalary, hasNoEsi);
  const finalGross = stats.grossPayable;
  const netPayable = roundMoney(
    finalGross - stats.pf - stats.esiValue - row.professionalTax - (row.advance || 0) - row.otherDeduction,
  );

  return {
    id: row.id,
    name: row.name,
    sourceCategory: row.category,
    wageCategory,
    employeeTypes: rule.employeeTypes,
    allowedBasic: rule.basic,
    monthlyBasic,
    monthlyHra: stats.monthlyHra,
    monthlyTravelAllowance: stats.monthlyTravelAllowance,
    attendance,
    bonus: stats.bonus,
    officialAttendance: undefined,
    officialBonus: undefined,
    grossPayable: finalGross,
    pf: stats.pf,
    esi: stats.esiValue,
    professionalTax: row.professionalTax,
    advance: row.advance,
    otherDeduction: row.otherDeduction,
    netPayable,
    referenceNetPayable: row.netPayable,
  };
}


