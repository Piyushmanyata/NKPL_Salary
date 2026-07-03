import {
  BarChart3,
  Calculator,
  CheckCircle2,
  FileDown,
  FileSpreadsheet,
  IndianRupee,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  Upload,
  Users,
  AlertTriangle,
  Calendar,
  Clock,
  X,
  Check,
  Info,
  Database,
  Cloud,
  Wifi,
  Building2,
} from "lucide-react";
import { ChangeEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";
import { sampleEmployees } from "./sampleEmployees";
import { juneEmployees } from "./juneEmployees";
import {
  saveMonthData,
  getMonthData,
  getAllMonthLabels,
  getCloudConfig,
  getEmployeeRates,
  saveEmployeeRates,
  CloudConfig,
  EmployeeRateMap
} from "./db";
import {
  ESI_EMPLOYER_RATE,
  ESI_GROSS_LIMIT,
  ESI_RATE,
  HRA_SHARE_OF_BALANCE,
  MAX_BASIC_PERCENT,
  MIN_BASIC_PERCENT,
  PF_BASIC_LIMIT,
  PF_RATE,
  TA_SHARE_OF_BALANCE,
  WORKING_DAYS,
  calculateSalary,
  clampBasicPercent,
  clampDays,
  clampMonthDays,
  currency,
  isSpecialEmployee,
  numberValue,
  roundMoney,
  uid,
} from "./salary";
import type { AttendanceEmployee, EmployeeInput, SalaryRow } from "./types";

type SheetMode = "reference" | "main";

const COMPANIES = [
  { code: "NKPL", label: "NKPL" },
  { code: "APTUS", label: "APTUS" },
] as const;

type CompanyCode = (typeof COMPANIES)[number]["code"];

type WageCategory = "Unskilled" | "Semi-skilled" | "Skilled";

type OfficialRow = {
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

const blankEmployee = (monthDays = WORKING_DAYS): EmployeeInput => ({
  id: uid(),
  name: "New Employee",
  category: "Skilled",
  monthlySalary: 0,
  salaryPerDay: 0,
  bonusPerDay: 0,
  daysWorked: monthDays,
  extraDays: 0,
  basicPercent: 70,
  pfOptIn: true,
  esiOptIn: true,
  advance: undefined,
  otherDeduction: 0,
  performanceBonus: undefined,
  specialBonus: undefined,
});

const sum = (rows: SalaryRow[], key: keyof SalaryRow) =>
  rows.reduce((total, row) => total + numberValue(row[key]), 0);

const DEFAULT_COMPANY: CompanyCode = "NKPL";
const legacyEmployeesStorageKey = "salary-sheet-employees-may-2026-v2";
const legacyMonthConfigStorageKey = "salary-sheet-month-config";
const activeCompanyStorageKey = "salary-sheet-active-company";
const employeesStorageKey = (company: string) => `salary-sheet-employees-${company}-v2`;
const monthConfigStorageKey = (company: string) => `salary-sheet-month-config-${company}`;
const companyLabelStorageKey = (company: string) => `salary-sheet-company-label-${company}`;
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const csvEscape = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
const htmlEscape = (value: string | number) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const booleanValue = (value: unknown) =>
  value === true || value === "true" || value === "yes" || value === "on" || value === 1;
// Neutralize spreadsheet formula injection: a free-text name starting with
// =, +, -, or @ would otherwise execute as a formula when the exported
// CSV/Excel file is opened. Prefixing with an apostrophe forces text.
const sanitizeSpreadsheetCell = (value: string) => (/^[=+\-@]/.test(value) ? `'${value}` : value);

const monthNames = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function inferMonthDays(label: string) {
  const text = label.toLowerCase();
  const monthIndex = monthNames.findIndex((month) => text.includes(month.slice(0, 3)));
  const year = Number(text.match(/\b(20\d{2}|19\d{2})\b/)?.[1] ?? new Date().getFullYear());

  if (monthIndex < 0 || !Number.isFinite(year)) {
    return null;
  }

  return new Date(year, monthIndex + 1, 0).getDate();
}

function loadActiveCompany(): CompanyCode {
  try {
    const stored = localStorage.getItem(activeCompanyStorageKey);
    if (stored && COMPANIES.some((company) => company.code === stored)) {
      return stored as CompanyCode;
    }
  } catch {
    // ignore
  }
  return DEFAULT_COMPANY;
}

function loadCompanyLabel(company: CompanyCode): string {
  try {
    return localStorage.getItem(companyLabelStorageKey(company)) || company;
  } catch {
    return company;
  }
}

function loadMonthConfig(company: CompanyCode) {
  try {
    const raw =
      localStorage.getItem(monthConfigStorageKey(company)) ??
      (company === DEFAULT_COMPANY ? localStorage.getItem(legacyMonthConfigStorageKey) : null) ??
      "{}";
    const parsed = JSON.parse(raw) as {
      label?: unknown;
      days?: unknown;
    };
    const label = String(parsed.label || "May 2026");
    return {
      label,
      days: clampMonthDays(parsed.days ?? inferMonthDays(label) ?? WORKING_DAYS),
    };
  } catch {
    return { label: "May 2026", days: WORKING_DAYS };
  }
}

function normalizeMonthLabel(value: string) {
  const trimmed = value.trim();
  const text = trimmed.toLowerCase();
  const monthIndex = monthNames.findIndex((month) => text.includes(month.slice(0, 3)));
  const year = Number(text.match(/\b(20\d{2}|19\d{2})\b/)?.[1] ?? new Date().getFullYear());

  if (monthIndex < 0 || !Number.isFinite(year)) {
    return trimmed;
  }

  return `${monthNames[monthIndex][0].toUpperCase()}${monthNames[monthIndex].slice(1)} ${year}`;
}

const sanitizeEmployee = (value: unknown, index: number, monthDays = WORKING_DAYS): EmployeeInput | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const row = value as Partial<EmployeeInput>;
  const name = String(row.name ?? "").trim();
  const rawMonthlySalary = Math.max(0, numberValue(row.monthlySalary));
  const hasSalaryPerDay =
    row.salaryPerDay !== undefined && row.salaryPerDay !== null && String(row.salaryPerDay).trim() !== "";
  // Legacy records (and the bundled sample data) only ever stored a monthly
  // salary; derive a per-day rate from it once so old data keeps working
  // after the switch to per-day-rate-driven calculations.
  const salaryPerDay = hasSalaryPerDay
    ? Math.max(0, numberValue(row.salaryPerDay))
    : Math.max(0, roundMoney(rawMonthlySalary / (monthDays || WORKING_DAYS)));
  const bonusPerDay = Math.max(0, numberValue(row.bonusPerDay));
  const monthlySalary = roundMoney((monthDays || WORKING_DAYS) * salaryPerDay);

  if (!name && monthlySalary <= 0) {
    return null;
  }

  return {
    id: String(row.id || `emp-${Date.now()}-${index}`),
    name,
    category: normalizeWageCategory(String(row.category || "Skilled"), monthlySalary),
    monthlySalary,
    salaryPerDay,
    bonusPerDay,
    daysWorked: clampDays(numberValue(row.daysWorked), monthDays),
    extraDays: Math.max(0, numberValue(row.extraDays)),
    basicPercent: clampBasicPercent(row.basicPercent),
    pfOptIn: row.pfOptIn !== false,
    esiOptIn: row.esiOptIn !== false,
    advance: row.advance !== undefined && row.advance !== null && String(row.advance).trim() !== "" && numberValue(row.advance) !== 0 ? numberValue(row.advance) : undefined,
    otherDeduction: Math.max(0, numberValue(row.otherDeduction)),
    officialAttendance: row.officialAttendance !== undefined ? numberValue(row.officialAttendance) : undefined,
    officialBonus: row.officialBonus !== undefined ? numberValue(row.officialBonus) : undefined,
    performanceBonus: row.performanceBonus !== undefined && row.performanceBonus !== null && String(row.performanceBonus).trim() !== "" ? numberValue(row.performanceBonus) : undefined,
    specialBonus: row.specialBonus !== undefined && row.specialBonus !== null && String(row.specialBonus).trim() !== "" ? numberValue(row.specialBonus) : undefined,
  };
};

// NKPL is the only company with bundled sample/demo data; a newly added
// company like APTUS starts blank until real employees are entered.
const defaultEmployeesForCompany = (company: CompanyCode, monthLabel?: string) => {
  if (company !== "NKPL") {
    return [];
  }
  // NKPL's real June 2026 payroll sheet is the bundled default for that
  // specific month; every other month falls back to the general sample
  // roster (originally sourced from May 2026).
  if (monthLabel && normalizeMonthLabel(monthLabel) === "June 2026") {
    return juneEmployees;
  }
  return sampleEmployees;
};

// Salary/day and bonus/day are shared across every month for a given
// employee (see api/rates.ts) -- overlay the shared rate on top of whatever
// per-month snapshot was loaded so every month always reflects the latest
// rate, and every employee not yet in the shared store keeps its own value.
const applyEmployeeRates = (list: EmployeeInput[], rates: EmployeeRateMap): EmployeeInput[] =>
  list.map((employee) => {
    const rate = rates[employee.id];
    if (!rate) {
      return employee;
    }
    return {
      ...employee,
      salaryPerDay: Math.max(0, numberValue(rate.salaryPerDay)),
      bonusPerDay: Math.max(0, numberValue(rate.bonusPerDay)),
    };
  });

const buildRateMap = (list: EmployeeInput[]): EmployeeRateMap => {
  const map: EmployeeRateMap = {};
  list.forEach((employee) => {
    if (!employee.name.trim()) {
      return;
    }
    map[employee.id] = {
      id: employee.id,
      name: employee.name,
      salaryPerDay: Math.max(0, numberValue(employee.salaryPerDay)),
      bonusPerDay: Math.max(0, numberValue(employee.bonusPerDay)),
    };
  });
  return map;
};

const loadEmployees = (company: CompanyCode, monthDays = WORKING_DAYS, monthLabel?: string) => {
  const fallback = defaultEmployeesForCompany(company, monthLabel);
  const stored =
    localStorage.getItem(employeesStorageKey(company)) ??
    (company === DEFAULT_COMPANY ? localStorage.getItem(legacyEmployeesStorageKey) : null);
  if (!stored) {
    return fallback.map((employee, index) => sanitizeEmployee(employee, index, monthDays)!);
  }

  try {
    const parsed = JSON.parse(stored);
    const rows = Array.isArray(parsed)
      ? parsed
          .map((employee, index) => sanitizeEmployee(employee, index, monthDays))
          .filter((employee): employee is EmployeeInput => Boolean(employee))
      : [];
    return rows.length ? rows : fallback.map((employee, index) => sanitizeEmployee(employee, index, monthDays)!);
  } catch {
    return fallback.map((employee, index) => sanitizeEmployee(employee, index, monthDays)!);
  }
};

// Removed parseCsvLine as CSV import is removed

const OFFICIAL_WAGE_DAYS = 26;

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

function classifyWageCategory(row: SalaryRow): WageCategory {
  return normalizeWageCategory(row.category, row.monthlySalary);
}

function normalizeWageCategory(value: string, monthlySalary?: number): WageCategory {
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

function buildReferenceOfficialRow(row: SalaryRow, monthDays: number): OfficialRow {
  const wageCategory = classifyWageCategory(row);
  const rule = wageRules[wageCategory];
  const attendance = row.daysWorked;
  const proratedTotalSalary = roundMoney((row.totalSalary / monthDays) * attendance);
  const esiActive = row.esiOptIn && row.earnedSalary <= ESI_GROSS_LIMIT;
  const esi = esiActive ? roundMoney(row.basicSalary * ESI_RATE) : 0;
  const targetGross = Math.max(
    0,
    row.netPayable +
      row.employeePf +
      esi +
      row.professionalTax +
      - (row.advance || 0) +
      row.otherDeduction,
  );
  
  const monthlyBasic = (row.esiOptIn === false && attendance > 0) ? 21100 : row.basicSalary;
  const monthlyHra = (row.esiOptIn === false && attendance > 0) ? 0 : row.hra;
  const monthlyTravelAllowance = (row.esiOptIn === false && attendance > 0) ? 0 : row.travelAllowance;
  
  const bonus = Math.max(0, roundMoney(targetGross - (monthlyBasic + monthlyHra + monthlyTravelAllowance)));
  const grossPayable = roundMoney(monthlyBasic + monthlyHra + monthlyTravelAllowance + bonus);

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
    officialAttendance: row.officialAttendance,
    officialBonus: row.officialBonus,
    grossPayable,
    pf: row.employeePf,
    esi,
    professionalTax: row.professionalTax,
    advance: row.advance,
    otherDeduction: row.otherDeduction,
    netPayable: row.netPayable,
    referenceNetPayable: row.netPayable,
  };
}

function buildOfficialRow(row: SalaryRow, monthDays: number): OfficialRow {
  const pfActive = row.pfOptIn;
  const esiActive = row.esiOptIn && row.earnedSalary <= ESI_GROSS_LIMIT;

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
    const candidateBasic = (row.esiOptIn === false && candidate > 0) ? 21100 : roundMoney(candidate * rule.daily);
    const candidatePf = roundMoney(Math.min(candidateBasic, PF_BASIC_LIMIT) * PF_RATE);
    const candidateEsi = esiActive ? roundMoney(candidateBasic * ESI_RATE) : 0;
    const candidateGross = Math.max(
      0,
      row.netPayable +
        candidatePf +
        candidateEsi +
        row.professionalTax +
        - (row.advance || 0) +
        row.otherDeduction,
    );
    const candidateProratedTotalSalary = roundMoney((row.totalSalary / OFFICIAL_WAGE_DAYS) * candidate);

    if (candidateGross >= candidateProratedTotalSalary || candidate === minCandidate) {
      attendance = candidate;
      break;
    }
  }

  const statutoryBasic = (row.esiOptIn === false && attendance > 0) ? 21100 : roundMoney(attendance * rule.daily);
  const monthlyBasic = statutoryBasic;
  const pf = roundMoney(Math.min(monthlyBasic, PF_BASIC_LIMIT) * PF_RATE);
  const esi = esiActive ? roundMoney(monthlyBasic * ESI_RATE) : 0;
  const targetGross = Math.max(
    0,
    row.netPayable + pf + esi + row.professionalTax - (row.advance || 0) + row.otherDeduction,
  );
  
  const proratedTotalSalary = roundMoney((row.totalSalary / OFFICIAL_WAGE_DAYS) * attendance);
  const remainingForHraTa = row.esiOptIn === false ? 0 : Math.max(0, proratedTotalSalary - monthlyBasic);
  const monthlyHra = roundMoney(remainingForHraTa * HRA_SHARE_OF_BALANCE);
  const monthlyTravelAllowance = roundMoney(remainingForHraTa - monthlyHra);
  const bonus = Math.max(0, roundMoney(targetGross - (monthlyBasic + monthlyHra + monthlyTravelAllowance)));
  const finalGross = roundMoney(monthlyBasic + monthlyHra + monthlyTravelAllowance + bonus);
  const netPayable = roundMoney(
    finalGross - pf - esi - row.professionalTax + (row.advance || 0) - row.otherDeduction,
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
    officialAttendance: undefined,
    officialBonus: undefined,
    grossPayable: finalGross,
    pf,
    esi,
    professionalTax: row.professionalTax,
    advance: row.advance,
    otherDeduction: row.otherDeduction,
    netPayable,
    referenceNetPayable: row.netPayable,
  };
}

function calculateEmployeeAttendanceStats(
  daysDetail: AttendanceEmployee["daysDetail"],
  isSecurity: boolean
) {
  const totalCalendarDays = daysDetail.length;
  const monthThreshold = totalCalendarDays === 31 ? 21 : (totalCalendarDays === 30 ? 20 : Math.round(totalCalendarDays * (20 / 30)));

  let rawPresentDays = 0;
  let totalHours = 0;
  daysDetail.forEach((day) => {
    if (day.isPresent) {
      rawPresentDays++;
      totalHours += day.duration;
    }
  });

  const unapprovedAbsences = daysDetail.filter(
    (d) => !d.isPresent && d.leaveType === "unapproved"
  ).length;

  const effectivePresentDays = Math.max(0, rawPresentDays - unapprovedAbsences);
  const meetsMonthThreshold = effectivePresentDays >= monthThreshold;

  let sundaysWorked = 0;
  const sundayDetails: AttendanceEmployee["sundayDetails"] = [];
  const totalSundaysInMonth = daysDetail.filter((d) => d.dayOfWeek === 0).length;

  daysDetail.forEach((day, index) => {
    if (day.dayOfWeek === 0) {
      const actuallyWorked = day.isPresent;
      if (actuallyWorked) {
        sundaysWorked++;
      }

      let isEligible = false;
      const reasons: string[] = [];

      if (isSecurity) {
        reasons.push("Excluded: Employee is classified as Security Personnel.");
      } else if (!meetsMonthThreshold) {
        reasons.push(
          `Below Threshold: Worked only ${effectivePresentDays}/${totalCalendarDays} days (requires min ${monthThreshold} days for Sunday benefits).`
        );
      } else {
        isEligible = true;
        if (actuallyWorked) {
          reasons.push("Double Pay Approved: Worked on Sunday (auto presence + bonus).");
        } else {
          reasons.push("Auto-Paid: Paid for Sunday (presence counted regardless of attendance).");
        }
      }

      sundayDetails.push({
        date: day.dateString,
        isEligible,
        reasons,
      });
    }
  });

  let finalPresentDays = effectivePresentDays;
  let sundayBonusDays = 0;

  if (meetsMonthThreshold && !isSecurity) {
    const sundaysNotWorked = totalSundaysInMonth - sundaysWorked;
    finalPresentDays = effectivePresentDays + sundaysNotWorked;
    sundayBonusDays = sundaysWorked;
  } else {
    finalPresentDays = effectivePresentDays;
    sundayBonusDays = 0;
  }

  const avgHours = rawPresentDays > 0 ? totalHours / rawPresentDays : 0;

  return {
    presentDays: finalPresentDays,
    avgHours,
    sundaysWorked,
    sundaysEligible: sundayBonusDays,
    meetsMonthThreshold,
    sundayDetails,
  };
}

function parseAttendanceExcel(rows: any[][], employees: EmployeeInput[]) {
  const headerRowIndex = 3;
  const dateHeaders = rows[headerRowIndex] || [];
  const dateCols: Array<{
    colIndex: number;
    dateString: string;
    date: Date;
    dayOfWeek: number;
  }> = [];

  for (let i = 4; i < dateHeaders.length; i++) {
    const cell = dateHeaders[i];
    if (cell && /\d{4}[\/\.-]\d{2}[\/\.-]\d{2}/.test(String(cell))) {
      const parts = String(cell).split(/[\/\.-]/);
      const dateObj = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      dateCols.push({
        colIndex: i,
        dateString: String(cell),
        date: dateObj,
        dayOfWeek: dateObj.getDay(),
      });
    }
  }

  if (dateCols.length === 0) {
    throw new Error("Could not find date columns in standard YYYY/MM/DD format in the Excel sheet.");
  }

  let fileMonthLabel = "";
  if (dateCols.length > 0) {
    const firstDate = dateCols[0].date;
    const monthNamesList = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];
    fileMonthLabel = `${monthNamesList[firstDate.getMonth()]} ${firstDate.getFullYear()}`;
  }

  const parsedEmployees: AttendanceEmployee[] = [];

  for (let r = 5; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row[2]) continue;

    const id = String(row[0] || `att-emp-${r}`);
    const name = String(row[2]).trim();
    const department = String(row[3] || "Company").trim();

    const matchedEmp = employees.find((emp) => {
      const name1 = emp.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      const name2 = name.toLowerCase().replace(/[^a-z0-9]/g, "");
      return name1.includes(name2) || name2.includes(name1);
    });

    const isSecurity =
      name.toLowerCase().includes("security") ||
      department.toLowerCase().includes("security") ||
      (matchedEmp && matchedEmp.name.toLowerCase().includes("security")) ||
      (matchedEmp && matchedEmp.category.toLowerCase().includes("security")) ||
      false;

    const daysDetail: AttendanceEmployee["daysDetail"] = [];

    dateCols.forEach((d) => {
      const val = String(row[d.colIndex] || "");
      const times = val.match(/\d{2}:\d{2}/g) || [];
      const initialIsPresent = times.length > 0;

      let duration = 0;
      if (initialIsPresent) {
        if (times.length >= 2) {
          const minutes = times.map((t) => {
            const [h, m] = t.split(":").map(Number);
            return h * 60 + m;
          });
          const minM = Math.min(...minutes);
          const maxM = Math.max(...minutes);
          duration = (maxM - minM) / 60;
        }
      }

      const isShortStay = initialIsPresent && duration < 5;
      const isPresent = initialIsPresent && !isShortStay;

      let shift: "Day" | "Night" = "Day";
      if (initialIsPresent && times.length > 0) {
        const sortedTimes = [...times].sort();
        const firstPunch = sortedTimes[0];
        const firstHour = Number(firstPunch.split(":")[0]);
        if (firstHour >= 16 || firstHour < 6) {
          shift = "Night";
        } else {
          shift = "Day";
        }
      }

      daysDetail.push({
        dateString: d.dateString,
        dayOfWeek: d.dayOfWeek,
        isPresent,
        duration,
        punchTimes: times,
        isShortStay,
        shift,
      });
    });

    const stats = calculateEmployeeAttendanceStats(daysDetail, isSecurity);

    parsedEmployees.push({
      id,
      name,
      department,
      isSecurity,
      daysDetail,
      ...stats,
    });
  }

  return {
    employees: parsedEmployees,
    monthLabel: fileMonthLabel,
  };
}

function App() {
  const [activeCompany, setActiveCompany] = useState<CompanyCode>(loadActiveCompany);
  const initialMonthConfig = useMemo(() => loadMonthConfig(activeCompany), []);
  const [monthLabel, setMonthLabel] = useState(initialMonthConfig.label);
  const [monthDays, setMonthDays] = useState(initialMonthConfig.days);
  const [employees, setEmployees] = useState<EmployeeInput[]>(() =>
    loadEmployees(activeCompany, initialMonthConfig.days, initialMonthConfig.label),
  );
  const [query, setQuery] = useState("");
  const [newlyAddedId, setNewlyAddedId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState(() => loadCompanyLabel(activeCompany));
  const [openSettingsId, setOpenSettingsId] = useState<string | null>(null);
  const [sheetMode, setSheetMode] = useState<SheetMode>("reference");
  const [attendanceData, setAttendanceData] = useState<AttendanceEmployee[] | null>(null);
  const [attendanceMonth, setAttendanceMonth] = useState<string>("");
  const [isAttendanceModalOpen, setIsAttendanceModalOpen] = useState(false);
  const attendanceFileRef = useRef<HTMLInputElement>(null);
  const effectiveMonthDays = clampMonthDays(monthDays);
  const employeesRef = useRef(employees);

  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);

  // Database and Month tracking states
  const [dbLoading, setDbLoading] = useState(true);
  const [allMonths, setAllMonths] = useState<string[]>([]);
  const [showNoDataModal, setShowNoDataModal] = useState(false);
  const [noDataMonth, setNoDataMonth] = useState("");
  const [copySourceMonth, setCopySourceMonth] = useState("");
  const prevMonthRef = useRef(monthLabel);
  const prevCompanyRef = useRef(activeCompany);
  const justLoadedRef = useRef(false);

  // Shared salary/day + bonus/day rates for the active company, kept in sync
  // with the cloud store (see api/rates.ts) independently of month records.
  const [employeeRates, setEmployeeRates] = useState<EmployeeRateMap>({});
  const ratesSignatureRef = useRef<string>("");

  // Cloud Database Sync settings
  const [isDbModalOpen, setIsDbModalOpen] = useState(false);
  const [cloudConfig, setCloudConfigState] = useState<CloudConfig>(getCloudConfig);

  const showToast = (message: string, type: "success" | "error" = "success") => {
    if (toastTimeoutRef.current) {
      window.clearTimeout(toastTimeoutRef.current);
    }
    setToast({ message, type });
    toastTimeoutRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimeoutRef.current = null;
    }, 4000);
  };

  // Keep a ref to the latest employees so the default-attendance loader below can
  // match names without needing `employees` in its dependency array (adding it
  // there caused a full re-fetch + re-parse of MAY.xls on every keystroke, which
  // also silently wiped out any manual attendance overrides the user had made).
  useEffect(() => {
    employeesRef.current = employees;
  }, [employees]);

  // The Attendance Checker is a local audit/import tool: it parses an
  // uploaded punch-in/out Excel file into a detailed day-by-day breakdown
  // purely to help review and correct present days before syncing. That
  // detailed breakdown itself is never persisted -- only its end result
  // (each employee's present day count) matters, and that already lives in
  // `daysWorked` on the employee record, which is saved and shared via the
  // existing per-company-per-month payroll database (see the auto-save
  // effect below). So this effect only resets/re-derives the local audit
  // view when the month or company changes; NKPL's bundled May 2026 demo
  // file is the sole legacy exception used as a starting point.
  useEffect(() => {
    const normalized = normalizeMonthLabel(monthLabel);
    if (normalized !== monthLabel) {
      return; // wait until committed/normalized
    }
    if (!(activeCompany === "NKPL" && normalized === "May 2026")) {
      setAttendanceData(null);
      setAttendanceMonth("");
      return;
    }
    let cancelled = false;
    async function loadDefaultAttendance() {
      try {
        const response = await fetch("/MAY.xls");
        if (response.ok) {
          const buffer = await response.arrayBuffer();
          const XLSX = await import("xlsx");
          const workbook = XLSX.read(buffer, { type: "array" });
          const worksheet = workbook.Sheets[workbook.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
          const parsed = parseAttendanceExcel(rows, employeesRef.current);
          if (!cancelled) {
            setAttendanceData(parsed.employees);
            setAttendanceMonth(parsed.monthLabel);
          }
        }
      } catch (err) {
        console.error("Error loading default MAY.xls file:", err);
      }
    }
    loadDefaultAttendance();
    return () => {
      cancelled = true;
    };
  }, [monthLabel, activeCompany]);

  const salaryRows = useMemo(
    () =>
      employees
        .filter((employee) => employee.name.trim())
        .map((employee) =>
          calculateSalary(
            {
              ...employee,
              category: normalizeWageCategory(employee.category, employee.monthlySalary),
            },
            {
              basicShare: clampBasicPercent(employee.basicPercent) / 100,
              workingDays: effectiveMonthDays,
            },
          ),
        ),
    [employees, effectiveMonthDays],
  );

  const filteredRows = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) {
      return salaryRows;
    }

    return salaryRows.filter((row) =>
      `${row.name} ${row.category}`.toLowerCase().includes(search),
    );
  }, [query, salaryRows]);

  const officialRows = useMemo(
    () => salaryRows.map((row) => buildOfficialRow(row, effectiveMonthDays)),
    [effectiveMonthDays, salaryRows],
  );

  const filteredOfficialRows = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) {
      return officialRows;
    }

    return officialRows.filter((row) =>
      `${row.name} ${row.sourceCategory} ${row.wageCategory}`.toLowerCase().includes(search),
    );
  }, [officialRows, query]);

  const [refSortField, setRefSortField] = useState<string>("name");
  const [refSortDirection, setRefSortDirection] = useState<"asc" | "desc">("asc");

  const [officialSortField, setOfficialSortField] = useState<string>("name");
  const [officialSortDirection, setOfficialSortDirection] = useState<"asc" | "desc">("asc");

  const handleRefSort = (field: string) => {
    if (refSortField === field) {
      setRefSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setRefSortField(field);
      setRefSortDirection("asc");
    }
  };

  const handleOfficialSort = (field: string) => {
    if (officialSortField === field) {
      setOfficialSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setOfficialSortField(field);
      setOfficialSortDirection("asc");
    }
  };

  const sortedFilteredRows = useMemo(() => {
    const sorted = [...filteredRows];
    sorted.sort((a, b) => {
      if (a.id === newlyAddedId) return -1;
      if (b.id === newlyAddedId) return 1;
      let valA = a[refSortField as keyof typeof a];
      let valB = b[refSortField as keyof typeof b];

      if (valA === undefined || valA === null) valA = 0 as any;
      if (valB === undefined || valB === null) valB = 0 as any;

      if (typeof valA === "string") {
        return refSortDirection === "asc"
          ? valA.localeCompare(valB as string)
          : (valB as string).localeCompare(valA);
      } else {
        return refSortDirection === "asc"
          ? (valA as number) - (valB as number)
          : (valB as number) - (valA as number);
      }
    });
    return sorted;
  }, [filteredRows, refSortField, refSortDirection]);

  const sortedFilteredOfficialRows = useMemo(() => {
    const sorted = [...filteredOfficialRows];
    sorted.sort((a, b) => {
      if (a.id === newlyAddedId) return -1;
      if (b.id === newlyAddedId) return 1;
      let valA = a[officialSortField as keyof typeof a];
      let valB = b[officialSortField as keyof typeof b];

      if (valA === undefined || valA === null) valA = 0 as any;
      if (valB === undefined || valB === null) valB = 0 as any;

      if (typeof valA === "string") {
        return officialSortDirection === "asc"
          ? valA.localeCompare(valB as string)
          : (valB as string).localeCompare(valA);
      } else {
        return officialSortDirection === "asc"
          ? (valA as number) - (valB as number)
          : (valB as number) - (valA as number);
      }
    });
    return sorted;
  }, [filteredOfficialRows, officialSortField, officialSortDirection]);

  const totals = useMemo(() => {
    if (sheetMode === "main") {
      const gross = officialRows.reduce((total, row) => total + row.grossPayable, 0);
      const net = officialRows.reduce((total, row) => total + row.netPayable, 0);
      const pf = officialRows.reduce((total, row) => total + row.pf, 0);
      // Employer PF mirrors employee PF in this model (both 12% of basic, capped
      // at PF_BASIC_LIMIT) -- see calculateSalary. Reusing `pf` here (instead of
      // recomputing from monthlyBasic without the cap) keeps this in sync with
      // that formula and avoids overstating employer cost for high-basic rows.
      const employerPf = pf;
      const esi = officialRows.reduce((total, row) => total + row.esi, 0);
      const professionalTax = officialRows.reduce((total, row) => total + row.professionalTax, 0);
      const employerEsi = officialRows.reduce((total, row) => total + (row.esi > 0 ? roundMoney(row.monthlyBasic * ESI_EMPLOYER_RATE) : 0), 0);
      const deductions =
        pf +
        esi +
        professionalTax +
        officialRows.reduce((total, row) => total - (row.advance || 0) + row.otherDeduction, 0);
      const cost = gross + employerPf + employerEsi;
      return {
        employees: officialRows.length,
        gross,
        net,
        pf,
        employerPf,
        employerEsi,
        esi,
        professionalTax,
        deductions,
        cost,
      };
    } else {
      const gross = sum(salaryRows, "grossPayable");
      const net = sum(salaryRows, "netPayable");
      const pf = sum(salaryRows, "employeePf");
      const employerPf = sum(salaryRows, "employerPf");
      const employerEsi = sum(salaryRows, "employerEsi");
      const esi = sum(salaryRows, "esi");
      const professionalTax = sum(salaryRows, "professionalTax");
      const deductions =
        pf +
        esi +
        professionalTax +
        -sum(salaryRows, "advance") +
        sum(salaryRows, "otherDeduction");
      const cost = sum(salaryRows, "totalCost");
      return {
        employees: salaryRows.length,
        gross,
        net,
        pf,
        employerPf,
        employerEsi,
        esi,
        professionalTax,
        deductions,
        cost,
      };
    }
  }, [sheetMode, salaryRows, officialRows]);

  const categoryTotals = useMemo(() => {
    const grouped = salaryRows.reduce<Record<string, number>>((acc, row) => {
      const category = row.category.trim() || "Staff";
      acc[category] = (acc[category] || 0) + row.netPayable;
      return acc;
    }, {});

    return Object.entries(grouped)
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);
  }, [salaryRows]);

  const updateEmployees = (next: EmployeeInput[]) => {
    setEmployees(next);
  };

  const updateMonthLabel = (value: string) => {
    setMonthLabel(value);
    const inferredDays = inferMonthDays(value);
    if (inferredDays) {
      setMonthDays(inferredDays);
    }
  };

  const commitMonthLabel = () => {
    setMonthLabel((current) => normalizeMonthLabel(current));
  };

  const updateEmployee = (
    id: string,
    field: keyof EmployeeInput,
    value: string | number | boolean | undefined,
  ) => {
    if (id === newlyAddedId && field === "name") {
      setNewlyAddedId(null);
    }
    setEmployees((current) => {
      const next = current.map((employee) => {
        if (employee.id !== id) {
          return employee;
        }

        if (field === "name") {
          const nameStr = String(value);
          const isSpecial = isSpecialEmployee(nameStr);
          if (isSpecial) {
            return {
              ...employee,
              name: nameStr,
              daysWorked: effectiveMonthDays,
              pfOptIn: false,
              esiOptIn: false,
            };
          }
          return { ...employee, name: nameStr };
        }

        if (field === "category") {
          return { ...employee, category: String(value) };
        }

        if (field === "pfOptIn" || field === "esiOptIn") {
          return { ...employee, [field]: booleanValue(value) };
        }

        if (field === "basicPercent") {
          const basicPercent = clampBasicPercent(value);
          return {
            ...employee,
            basicPercent,
          };
        }

        if (field === "advance") {
          const val = value === undefined || value === "" ? undefined : Number(value);
          return {
            ...employee,
            advance: val === 0 ? undefined : val,
          };
        }

        if (field === "performanceBonus") {
          const val = value === undefined || value === "" ? undefined : Number(value);
          return {
            ...employee,
            performanceBonus: val,
          };
        }

        if (field === "specialBonus") {
          const val = value === undefined || value === "" ? undefined : Number(value);
          return {
            ...employee,
            specialBonus: val,
          };
        }

        const numericValue = numberValue(value);
        const updated = { ...employee, [field]: numericValue };

        return updated;
      });
      return next;
    });
  };

  const addEmployee = () => {
    setQuery("");
    const newEmp = blankEmployee(effectiveMonthDays);
    setNewlyAddedId(newEmp.id);
    setEmployees((current) => [newEmp, ...current]);
    showToast("Added new employee successfully!");
  };

  const removeEmployee = (id: string) => {
    const emp = employees.find((e) => e.id === id);
    setEmployees((current) => current.filter((employee) => employee.id !== id));
    setOpenSettingsId((current) => (current === id ? null : current));
    if (emp) {
      showToast(`Removed employee "${emp.name}"`);
    }
  };


  const handleSwitchCompany = (next: CompanyCode) => {
    if (next === activeCompany) return;
    const cfg = loadMonthConfig(next);
    setQuery("");
    setOpenSettingsId(null);
    setActiveCompany(next);
    setCompanyName(loadCompanyLabel(next));
    setMonthLabel(cfg.label);
    setMonthDays(cfg.days);
    // Attendance data belongs to the company it was loaded/uploaded for; clear it
    // so switching companies never shows one company's attendance audit against
    // another company's employee list.
    setAttendanceData(null);
    setAttendanceMonth("");
    setIsAttendanceModalOpen(false);
  };

  // Persist the active company selection and its display label
  useEffect(() => {
    try {
      localStorage.setItem(activeCompanyStorageKey, activeCompany);
    } catch {
      // ignore storage failures (e.g. private browsing)
    }
  }, [activeCompany]);

  useEffect(() => {
    try {
      localStorage.setItem(companyLabelStorageKey(activeCompany), companyName);
    } catch {
      // ignore storage failures
    }
  }, [companyName, activeCompany]);

  // Initialize / fetch month labels for the active company on mount and on company switch
  useEffect(() => {
    getAllMonthLabels(activeCompany).then((months) => {
      setAllMonths(months);
    }).catch(console.error);
  }, [activeCompany]);

  // Update previous active month/company tracker when data is loaded successfully
  useEffect(() => {
    const normalized = normalizeMonthLabel(monthLabel);
    if (normalized === monthLabel && !showNoDataModal && !dbLoading) {
      prevMonthRef.current = monthLabel;
      prevCompanyRef.current = activeCompany;
    }
  }, [monthLabel, activeCompany, showNoDataModal, dbLoading]);

  // Remember the last-viewed month per company so switching companies restores it
  useEffect(() => {
    if (dbLoading || showNoDataModal) return;
    const normalized = normalizeMonthLabel(monthLabel);
    if (normalized !== monthLabel) return;
    try {
      localStorage.setItem(
        monthConfigStorageKey(activeCompany),
        JSON.stringify({ label: normalized, days: effectiveMonthDays }),
      );
    } catch {
      // ignore storage failures
    }
  }, [activeCompany, monthLabel, effectiveMonthDays, dbLoading, showNoDataModal]);

  // Load selected company + month payroll data from DB
  useEffect(() => {
    let active = true;
    async function loadData() {
      const normalized = normalizeMonthLabel(monthLabel);
      if (normalized !== monthLabel) {
        return; // wait until committed/normalized
      }

      setDbLoading(true);
      try {
        const [data, rates] = await Promise.all([
          getMonthData(activeCompany, normalized),
          getEmployeeRates(activeCompany),
        ]);
        if (!active) return;
        setEmployeeRates(rates);
        ratesSignatureRef.current = JSON.stringify(rates);
        if (data) {
          justLoadedRef.current = true;
          setEmployees(applyEmployeeRates(data.employees, rates));
          setMonthDays(data.days);
        } else {
          // No data saved for this company + month yet
          setNoDataMonth(normalized);
          const months = await getAllMonthLabels(activeCompany);
          if (active) {
            setAllMonths(months);
            if (months.length > 0) {
              setCopySourceMonth(months[months.length - 1]);
            } else {
              setCopySourceMonth("");
            }
            setShowNoDataModal(true);
          }
        }
      } catch (err) {
        console.error("Failed to load month data from database:", err);
      } finally {
        if (active) setDbLoading(false);
      }
    }
    loadData();
    return () => {
      active = false;
    };
  }, [monthLabel, activeCompany]);

  // Auto-save changes to the database (with 500ms debounce to optimize writes)
  useEffect(() => {
    if (dbLoading || showNoDataModal) return;
    // Skip the save that would otherwise immediately follow a fresh load --
    // there's nothing new to persist, and it just costs a redundant write.
    if (justLoadedRef.current) {
      justLoadedRef.current = false;
      return;
    }
    const normalized = normalizeMonthLabel(monthLabel);
    if (normalized !== monthLabel) return;

    const delayDebounce = setTimeout(async () => {
      try {
        await saveMonthData(activeCompany, normalized, effectiveMonthDays, employees);
        const months = await getAllMonthLabels(activeCompany);
        setAllMonths(months);
      } catch (err) {
        console.error("Failed to save month data:", err);
      }
    }, 500);

    return () => clearTimeout(delayDebounce);
  }, [employees, effectiveMonthDays, monthLabel, activeCompany, dbLoading, showNoDataModal]);

  // Auto-save salary/day + bonus/day rates to the shared cloud store whenever
  // they change, so every month and every visitor picks up the new rate.
  // Debounced and skipped when unchanged so unrelated edits (attendance,
  // deductions, etc.) don't trigger redundant writes.
  useEffect(() => {
    if (dbLoading || showNoDataModal) return;
    const nextRates = buildRateMap(employees);
    const signature = JSON.stringify(nextRates);
    if (signature === ratesSignatureRef.current) return;

    const delayDebounce = setTimeout(async () => {
      try {
        ratesSignatureRef.current = signature;
        setEmployeeRates(nextRates);
        await saveEmployeeRates(activeCompany, nextRates);
      } catch (err) {
        console.error("Failed to save employee rates:", err);
      }
    }, 500);

    return () => clearTimeout(delayDebounce);
  }, [employees, activeCompany, dbLoading, showNoDataModal]);

  // Month initialization methods
  const handleCreateBlankMonth = async () => {
    setShowNoDataModal(false);
    setEmployees([]);
    try {
      await saveMonthData(activeCompany, noDataMonth, effectiveMonthDays, []);
      const months = await getAllMonthLabels(activeCompany);
      setAllMonths(months);
      showToast(`Created blank payroll sheet for ${noDataMonth}`);
    } catch (err) {
      console.error(err);
      showToast("Error creating month", "error");
    }
  };

  const handleCreateSampleMonth = async () => {
    setShowNoDataModal(false);
    const sanitized = applyEmployeeRates(
      defaultEmployeesForCompany(activeCompany, noDataMonth).map(
        (emp, index) => sanitizeEmployee(emp, index, effectiveMonthDays)!,
      ),
      employeeRates,
    );
    setEmployees(sanitized);
    try {
      await saveMonthData(activeCompany, noDataMonth, effectiveMonthDays, sanitized);
      const months = await getAllMonthLabels(activeCompany);
      setAllMonths(months);
      showToast(`Initialized ${noDataMonth} with sample employees`);
    } catch (err) {
      console.error(err);
      showToast("Error initializing month", "error");
    }
  };

  const handleCopyMonth = async (source: string) => {
    if (!source) return;
    setDbLoading(true);
    setShowNoDataModal(false);
    try {
      const sourceData = await getMonthData(activeCompany, source);
      if (sourceData) {
        const targetDays = inferMonthDays(noDataMonth) ?? sourceData.days;
        const sanitizedEmployees = applyEmployeeRates(
          sourceData.employees.map((emp, index) => sanitizeEmployee(emp, index, targetDays)!).filter(Boolean),
          employeeRates,
        );
        setEmployees(sanitizedEmployees);
        setMonthDays(targetDays);
        await saveMonthData(activeCompany, noDataMonth, targetDays, sanitizedEmployees);
        showToast(`Copied employee list from ${source} to ${noDataMonth} (${targetDays} days)`);
      } else {
        showToast(`Failed to copy: source month ${source} has no data`, "error");
      }
      const months = await getAllMonthLabels(activeCompany);
      setAllMonths(months);
    } catch (err) {
      console.error(err);
      showToast("Error copying month data", "error");
    } finally {
      setDbLoading(false);
    }
  };

  const handleCancelNoData = () => {
    setShowNoDataModal(false);
    setActiveCompany(prevCompanyRef.current);
    setMonthLabel(prevMonthRef.current);
    const inferred = inferMonthDays(prevMonthRef.current);
    if (inferred) setMonthDays(inferred);
  };

  // Close whichever modal is open on Escape, matching the explicit close/cancel
  // action each modal already exposes via its own button.
  useEffect(() => {
    if (!isAttendanceModalOpen && !isDbModalOpen && !showNoDataModal) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (isDbModalOpen) {
        setIsDbModalOpen(false);
      } else if (isAttendanceModalOpen) {
        setIsAttendanceModalOpen(false);
      } else if (showNoDataModal) {
        handleCancelNoData();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isAttendanceModalOpen, isDbModalOpen, showNoDataModal]);

  const exportRows =
    sheetMode === "main"
      ? officialRows.map((row, index) => ({
          "Sl No": index + 1,
          "Employee Name": sanitizeSpreadsheetCell(row.name),
          "Source Category": row.sourceCategory,
          "Wage Category": row.wageCategory,
          "Employee Types": row.employeeTypes,
          "Allowed Basic": roundMoney(row.allowedBasic),
          "Official Basic": roundMoney(row.monthlyBasic),
          HRA: roundMoney(row.monthlyHra),
          "Travel Allowance": roundMoney(row.monthlyTravelAllowance),
          Attendance: row.attendance,
          Bonus: roundMoney(row.bonus),
          PF: roundMoney(row.pf),
          ESI: roundMoney(row.esi),
          "P-Tax": roundMoney(row.professionalTax),
          Advance: row.advance !== undefined && row.advance !== null ? roundMoney(row.advance) : "",
          "Other Deduction": roundMoney(row.otherDeduction),
          "Net Payable": roundMoney(row.netPayable),
          "Reference Net Payable": roundMoney(row.referenceNetPayable),
        }))
      : salaryRows.map((row, index) => ({
          "Sl No": index + 1,
          "Employee Name": sanitizeSpreadsheetCell(row.name),
          Category: normalizeWageCategory(row.category, row.monthlySalary),
          "Basic Percent": row.basicPercent,
          "Salary Per Day": roundMoney(row.salaryPerDay),
          "Bonus Per Day": roundMoney(row.bonusPerDay),
          "Salary Per Month": roundMoney(row.monthlySalary),
          "Total Salary": roundMoney(row.totalSalary),
          "Days Worked": row.daysWorked,
          "Extra Days": row.extraDays,
          "Absent Days": row.absentDays,
          "PF Opt In": row.pfOptIn ? "Yes" : "No",
          "ESI Opt In": row.esiOptIn ? "Yes" : "No",
          "Absent Deduction": roundMoney(row.absentDeduction),
          "Earned Salary": roundMoney(row.earnedSalary),
          "Basic Salary": roundMoney(row.basicSalary),
           HRA: roundMoney(row.hra),
          "Travel Allowance": roundMoney(row.travelAllowance),
          "Performance Bonus": roundMoney(row.performanceBonus),
          "Special Bonus": roundMoney(row.specialBonus),
          "Daily Bonus Amount": roundMoney(row.dailyBonus),
          "Employee PF Deduction": roundMoney(row.employeePf),
          "Employer PF Contribution": roundMoney(row.employerPf),
          "ESI Deduction": roundMoney(row.esi),
          "Employer ESI Contribution": roundMoney(row.employerEsi),
          "P-Tax": roundMoney(row.professionalTax),
          Advance: row.advance !== undefined && row.advance !== null ? roundMoney(row.advance) : "",
          "Other Deduction": roundMoney(row.otherDeduction),
          "Net Payable": roundMoney(row.netPayable),
          "Employer Total Cost": roundMoney(row.totalCost),
        }));

  const exportWorkbook = () => {
    const headers = Object.keys(exportRows[0] ?? { "Employee Name": "" });
    const body = exportRows
      .map(
        (row) =>
          `<tr>${headers
            .map((header) => `<td>${htmlEscape(row[header as keyof typeof row] ?? "")}</td>`)
            .join("")}</tr>`,
      )
      .join("");
    const html = `<!doctype html><html><head><meta charset="utf-8" /></head><body><table><thead><tr>${headers
      .map((header) => `<th>${htmlEscape(header)}</th>`)
      .join("")}</tr></thead><tbody>${body}</tbody></table></body></html>`;
    downloadBlob(
      html,
      `${companyName || "Company"} ${sheetMode === "main" ? "Official Main Sheet" : "Reference Salary Sheet"} ${monthLabel}.xls`,
      "application/vnd.ms-excel;charset=utf-8;",
    );
  };

  const exportCsv = () => {
    const headers = Object.keys(exportRows[0] ?? { "Employee Name": "" });
    const csv = [
      headers.map(csvEscape).join(","),
      ...exportRows.map((row) =>
        headers.map((header) => csvEscape(row[header as keyof typeof row] ?? "")).join(","),
      ),
    ].join("\n");
    downloadBlob(csv, `${companyName || "Company"} ${sheetMode === "main" ? "Official Main Sheet" : "Reference Salary Sheet"} ${monthLabel}.csv`, "text/csv;charset=utf-8;");
  };

  const downloadBlob = (content: string, fileName: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const handleAttendanceUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(buffer, { type: "array" });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
      const parsed = parseAttendanceExcel(rows, employees);
      setAttendanceData(parsed.employees);
      setAttendanceMonth(parsed.monthLabel);
      setIsAttendanceModalOpen(true);
      showToast("Attendance file loaded successfully.");
    } catch (err) {
      console.error(err);
      showToast("Error parsing the Excel file. Please check format.", "error");
    } finally {
      event.target.value = "";
    }
  };

  return (
    <>
      <main className="app-shell">
        <section className="topbar">
          <div>
            <div className="company-switch" role="tablist" aria-label="Select company">
              {COMPANIES.map((company) => (
                <button
                  key={company.code}
                  type="button"
                  role="tab"
                  aria-selected={activeCompany === company.code}
                  className={`company-tab ${activeCompany === company.code ? "active" : ""}`}
                  onClick={() => handleSwitchCompany(company.code)}
                >
                  <Building2 size={14} />
                  {company.code}
                </button>
              ))}
            </div>
            <p className="eyebrow">Salary Sheet Dashboard</p>
            <h1>{companyName || "Company"} Payroll</h1>
            <p className="hero-copy">
              Build the reference payroll, review the official main sheet, and export clean salary files
              for {monthLabel}.
            </p>
          </div>
          <div className="topbar-actions">
            <button
              className="quiet-button"
              type="button"
              onClick={() => setSheetMode((current) => (current === "reference" ? "main" : "reference"))}
            >
              <Calculator size={17} />
              {sheetMode === "reference" ? "Show Main Sheet" : "Show Reference Sheet"}
            </button>
            <button
              className="ghost-button"
              type="button"
              onClick={() => {
                if (attendanceData && attendanceData.length > 0) {
                  setIsAttendanceModalOpen(true);
                } else {
                  attendanceFileRef.current?.click();
                }
              }}
            >
              <FileSpreadsheet size={17} />
              Attendance Checker
            </button>
            <button className="ghost-button" type="button" onClick={exportCsv}>
              <FileDown size={17} />
              CSV
            </button>
            <button
              className="ghost-button"
              type="button"
              onClick={() => setIsDbModalOpen(true)}
              title={
                dbLoading
                  ? "Syncing with cloud database..."
                  : cloudConfig.enabled
                    ? "Cloud database connected"
                    : "Local database active"
              }
            >
              {dbLoading ? (
                <RefreshCw size={17} className="spin-icon" style={{ color: "#2563eb" }} />
              ) : cloudConfig.enabled ? (
                <Cloud size={17} style={{ color: "#2563eb" }} />
              ) : (
                <Database size={17} />
              )}
              Database {dbLoading ? "Syncing..." : cloudConfig.enabled ? "Cloud" : "Local"}
            </button>
            <button className="primary-button" type="button" onClick={exportWorkbook}>
              <FileSpreadsheet size={17} />
              Excel
            </button>
            <input
              ref={attendanceFileRef}
              className="hidden-input"
              type="file"
              accept=".xls,.xlsx"
              onChange={handleAttendanceUpload}
            />
          </div>
        </section>

        <section className="control-strip" aria-label="Salary sheet setup">
          <label>
            Company
            <input value={companyName} onChange={(event) => setCompanyName(event.target.value)} />
          </label>
          <label>
            Month
            <input
              value={monthLabel}
              onBlur={commitMonthLabel}
              onChange={(event) => updateMonthLabel(event.target.value)}
            />
          </label>
          <label>
            Calendar Days
            <input
              type="number"
              min={1}
              max={31}
              value={effectiveMonthDays}
              onChange={(event) => {
                const val = parseInt(event.target.value, 10);
                if (!isNaN(val)) {
                  setMonthDays(Math.max(1, Math.min(31, val)));
                }
              }}
              onBlur={() => {
                // Clamp all employees' days worked ONLY when the user finishes editing (focus leaves the input field)
                setEmployees((current) =>
                  current.map((emp) => ({
                    ...emp,
                    daysWorked: Math.min(effectiveMonthDays, emp.daysWorked),
                  }))
                );
              }}
            />
          </label>
          <label>
            Search employee
            <span className="search-box">
              <Search size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Name or category"
              />
            </span>
          </label>
          <button className="quiet-button" type="button" onClick={addEmployee}>
            <Plus size={17} />
            Add Employee
          </button>
        </section>

        <section className="summary-grid">
          <MetricCard
            icon={<IndianRupee />}
            label="Net Payable"
            value={currency(totals.net)}
            caption={`${totals.employees} active employees`}
            tone="green"
          />
          <MetricCard
            icon={<Calculator />}
            label="Gross Earnings"
            value={currency(totals.gross)}
            caption={`${currency(totals.deductions)} total deductions`}
            tone="blue"
          />
          <MetricCard
            icon={<FileSpreadsheet />}
            label="PF + ESI + P-Tax"
            value={currency(totals.pf + totals.esi + totals.professionalTax)}
            caption={`${currency(totals.employerPf)} PF + ${currency(totals.employerEsi)} ESI (Employer)`}
            tone="amber"
          />
          <MetricCard
            icon={<Users />}
            label="Employer Cost"
            value={currency(totals.cost)}
            caption={`${filteredRows.length || filteredOfficialRows.length} rows in view`}
            tone="rose"
          />
        </section>

        <section className="workspace-grid">
          <article className="panel table-panel">
            <div className="panel-heading">
              <div>
                <h2>{sheetMode === "reference" ? "Reference Salary Sheet" : "Official Main Sheet"}</h2>
                <p>
                  {sheetMode === "reference"
                    ? `${filteredRows.length} employees shown, ${salaryRows.length} total`
                    : `${filteredOfficialRows.length} calculated rows, net pay preserved from reference`}
                </p>
              </div>
              <div className="panel-actions">
                <button className="icon-button" title="Print salary sheet" type="button" onClick={() => window.print()}>
                  <Printer size={17} />
                </button>
              </div>
            </div>

            <div className={`table-wrap ${sheetMode === "main" ? "table-wrap--official" : ""}`}>
              {sheetMode === "reference" ? (
                <table>
                  <thead>
                    <tr>
                      <th onClick={() => handleRefSort("name")} className="sortable-th">
                        Name {refSortField === "name" && (refSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleRefSort("category")} className="sortable-th">
                        Category {refSortField === "category" && (refSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleRefSort("daysWorked")} className="sortable-th">
                        Days {refSortField === "daysWorked" && (refSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleRefSort("extraDays")} className="sortable-th">
                        Extra {refSortField === "extraDays" && (refSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleRefSort("earnedSalary")} className="sortable-th">
                        Earned {refSortField === "earnedSalary" && (refSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleRefSort("basicSalary")} className="sortable-th">
                        Basic {refSortField === "basicSalary" && (refSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleRefSort("hra")} className="sortable-th">
                        HRA {refSortField === "hra" && (refSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleRefSort("travelAllowance")} className="sortable-th">
                        TA {refSortField === "travelAllowance" && (refSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleRefSort("performanceBonus")} className="sortable-th">
                        Bonus {refSortField === "performanceBonus" && (refSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleRefSort("specialBonus")} className="sortable-th">
                        Sp Bonus {refSortField === "specialBonus" && (refSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleRefSort("employeePf")} className="sortable-th">
                        PF {refSortField === "employeePf" && (refSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleRefSort("esi")} className="sortable-th">
                        ESI {refSortField === "esi" && (refSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleRefSort("professionalTax")} className="sortable-th">
                        P-Tax {refSortField === "professionalTax" && (refSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleRefSort("advance")} className="sortable-th">
                        Advance {refSortField === "advance" && (refSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleRefSort("netPayable")} className="sortable-th">
                        Net Pay {refSortField === "netPayable" && (refSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th>Settings</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedFilteredRows.length === 0 && (
                      <tr>
                        <td colSpan={18} style={{ textAlign: "center", padding: "48px 16px", color: "#667085", fontSize: "14px" }}>
                          No matching employees found for "{query}" in this company.
                        </td>
                      </tr>
                    )}
                    {sortedFilteredRows.map((row) => {
                      const isSpecial = isSpecialEmployee(row.name);
                      return (
                        <Fragment key={row.id}>
                          <tr>
                            <td className="name-cell">
                              <input
                                value={row.name}
                                onChange={(event) => updateEmployee(row.id, "name", event.target.value)}
                              />
                            </td>
                            <td>
                              <select
                                className="select-input"
                                value={normalizeWageCategory(row.category, row.monthlySalary)}
                                onChange={(event) => updateEmployee(row.id, "category", event.target.value)}
                              >
                                <option value="Skilled">Skilled</option>
                                <option value="Semi-skilled">Semi-skilled</option>
                                <option value="Unskilled">Unskilled</option>
                              </select>
                            </td>
                            <td>
                              <NumberInput
                                value={row.daysWorked}
                                min={0}
                                max={effectiveMonthDays}
                                disabled={isSpecial}
                                onChange={(value) => updateEmployee(row.id, "daysWorked", value)}
                              />
                            </td>
                            <td>
                              <NumberInput
                                className="number-input number-input--compact"
                                value={row.extraDays}
                                min={0}
                                onChange={(value) => updateEmployee(row.id, "extraDays", value)}
                              />
                            </td>
                            <td>{currency(row.earnedSalary)}</td>
                            <td>{currency(row.basicSalary)}</td>
                            <td>{currency(row.hra)}</td>
                            <td>{currency(row.travelAllowance)}</td>
                            <td>{currency(row.performanceBonus)}</td>
                            <td>
                              <NumberInput
                                className="number-input number-input--compact"
                                value={row.specialBonus ?? undefined}
                                allowBlank={true}
                                min={0}
                                onChange={(value) => updateEmployee(row.id, "specialBonus", value)}
                              />
                            </td>
                            <td>{currency(row.employeePf)}</td>
                            <td>{currency(row.esi)}</td>
                            <td>{currency(row.professionalTax)}</td>
                            <td>
                              <NumberInput
                                value={row.advance ?? undefined}
                                allowBlank={true}
                                onChange={(value) => updateEmployee(row.id, "advance", value)}
                              />
                            </td>
                            <td className="net-cell">{currency(row.netPayable)}</td>
                            <td>
                              <button
                                className="icon-button"
                                title="Employee settings"
                                type="button"
                                onClick={() =>
                                  setOpenSettingsId((current) => (current === row.id ? null : row.id))
                                }
                              >
                                <Settings2 size={16} />
                              </button>
                            </td>
                            <td>
                              <button
                                className="delete-button"
                                title="Remove employee"
                                type="button"
                                onClick={() => removeEmployee(row.id)}
                              >
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </tr>
                          {openSettingsId === row.id ? (
                            <tr className="settings-row">
                              <td colSpan={18}>
                                <div className="settings-panel">
                                  <div className="settings-column">
                                    <span>Salary per Day</span>
                                    <NumberInput
                                      value={row.salaryPerDay}
                                      min={0}
                                      onChange={(value) => updateEmployee(row.id, "salaryPerDay", value)}
                                    />
                                    <small>Applies to every month for this employee</small>
                                  </div>
                                  <div className="settings-column">
                                    <span>Bonus per Day</span>
                                    <NumberInput
                                      value={row.bonusPerDay}
                                      min={0}
                                      onChange={(value) => updateEmployee(row.id, "bonusPerDay", value)}
                                    />
                                    <small>Applies to every month for this employee</small>
                                  </div>
                                  <div className="settings-column">
                                    <span>Salary per Month</span>
                                    <strong>{currency(row.monthlySalary)}</strong>
                                    <small>{effectiveMonthDays} days &times; {currency(row.salaryPerDay)}</small>
                                  </div>
                                  <div className="settings-column">
                                    <span>Total Salary</span>
                                    <strong>{currency(row.totalSalary)}</strong>
                                    <small>{effectiveMonthDays} days &times; ({currency(row.salaryPerDay)} + {currency(row.bonusPerDay)})</small>
                                  </div>
                                  <div className="settings-column">
                                    <span>TDS</span>
                                    <NumberInput
                                      value={row.otherDeduction}
                                      min={0}
                                      onChange={(value) => updateEmployee(row.id, "otherDeduction", value)}
                                    />
                                  </div>
                                  <div className="settings-column">
                                    <span>Basic %</span>
                                    <strong>{row.basicPercent}%</strong>
                                    <input
                                      className="basic-slider"
                                      type="range"
                                      min={MIN_BASIC_PERCENT}
                                      max={MAX_BASIC_PERCENT}
                                      step="1"
                                      value={clampBasicPercent(row.basicPercent)}
                                      onChange={(event) =>
                                        updateEmployee(row.id, "basicPercent", Number(event.target.value))
                                      }
                                    />
                                  </div>
                                  <div className="settings-column">
                                    <span>PF</span>
                                    <strong>{row.pfOptIn ? "On" : "Off"}</strong>
                                    <small>{row.basicSalary > PF_BASIC_LIMIT ? `PF caps at ${currency(PF_BASIC_LIMIT * PF_RATE)} (12% of ${currency(PF_BASIC_LIMIT)} Basic)` : "Toggle controls employee PF choice"}</small>
                                    <button
                                      type="button"
                                      className={row.pfOptIn ? "toggle-on" : "toggle-off"}
                                      disabled={isSpecial}
                                      onClick={() => updateEmployee(row.id, "pfOptIn", !row.pfOptIn)}
                                    >
                                      {row.pfOptIn ? "Turn Off" : "Turn On"}
                                    </button>
                                  </div>
                                  <div className="settings-column">
                                    <span>ESI</span>
                                    <strong>{row.esiOptIn ? "On" : "Off"}</strong>
                                    <small>{row.earnedSalary > ESI_GROSS_LIMIT ? `ESI is disabled above ${currency(ESI_GROSS_LIMIT)} Gross salary` : "Toggle controls employee ESI choice"}</small>
                                    <button
                                      type="button"
                                      className={row.esiOptIn ? "toggle-on" : "toggle-off"}
                                      disabled={isSpecial}
                                      onClick={() => updateEmployee(row.id, "esiOptIn", !row.esiOptIn)}
                                    >
                                      {row.esiOptIn ? "Turn Off" : "Turn On"}
                                    </button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                    {!filteredRows.length ? (
                      <tr className="empty-row">
                        <td colSpan={18}>
                          <div>
                            <Search size={18} />
                            <strong>No employees match this search.</strong>
                            <span>Clear the search or add a new employee to continue.</span>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              ) : (
                <table className="official-table">
                  <thead>
                    <tr>
                      <th onClick={() => handleOfficialSort("name")} className="sortable-th">
                        Name {officialSortField === "name" && (officialSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleOfficialSort("wageCategory")} className="sortable-th">
                        Category {officialSortField === "wageCategory" && (officialSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleOfficialSort("attendance")} className="sortable-th">
                        Attendance {officialSortField === "attendance" && (officialSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleOfficialSort("monthlyBasic")} className="sortable-th">
                        Official Basic {officialSortField === "monthlyBasic" && (officialSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleOfficialSort("monthlyHra")} className="sortable-th">
                        HRA {officialSortField === "monthlyHra" && (officialSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleOfficialSort("monthlyTravelAllowance")} className="sortable-th">
                        TA {officialSortField === "monthlyTravelAllowance" && (officialSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleOfficialSort("bonus")} className="sortable-th">
                        Bonus {officialSortField === "bonus" && (officialSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleOfficialSort("pf")} className="sortable-th">
                        PF {officialSortField === "pf" && (officialSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleOfficialSort("esi")} className="sortable-th">
                        ESI {officialSortField === "esi" && (officialSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleOfficialSort("professionalTax")} className="sortable-th">
                        P-Tax {officialSortField === "professionalTax" && (officialSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleOfficialSort("netPayable")} className="sortable-th">
                        Net Pay {officialSortField === "netPayable" && (officialSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleOfficialSort("referenceNetPayable")} className="sortable-th">
                        Reference Net {officialSortField === "referenceNetPayable" && (officialSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedFilteredOfficialRows.length === 0 && (
                      <tr>
                        <td colSpan={12} style={{ textAlign: "center", padding: "48px 16px", color: "#667085", fontSize: "14px" }}>
                          No matching employees found for "{query}" in this company.
                        </td>
                      </tr>
                    )}
                    {sortedFilteredOfficialRows.map((row) => (
                      <tr key={row.id}>
                        <td className="name-cell">{row.name}</td>
                        <td>
                          <span style={{ fontWeight: 600 }}>{row.wageCategory}</span>
                          {row.sourceCategory !== row.wageCategory && (
                            <div style={{ fontSize: "10px", color: "#667085", marginTop: "2px" }}>
                              (from {row.sourceCategory})
                            </div>
                          )}
                        </td>
                        <td>{row.attendance}</td>
                        <td>{currency(row.monthlyBasic)}</td>
                        <td>{currency(row.monthlyHra)}</td>
                        <td>{currency(row.monthlyTravelAllowance)}</td>
                        <td>{currency(row.bonus)}</td>
                        <td>{currency(row.pf)}</td>
                        <td>{currency(row.esi)}</td>
                        <td>{currency(row.professionalTax)}</td>
                        <td className="net-cell">{currency(row.netPayable)}</td>
                        <td>{currency(row.referenceNetPayable)}</td>
                      </tr>
                    ))}
                    {!filteredOfficialRows.length ? (
                      <tr className="empty-row">
                        <td colSpan={12}>
                          <div>
                            <Search size={18} />
                            <strong>No official rows match this search.</strong>
                            <span>Clear the search to restore the main sheet.</span>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              )}
            </div>
            <div className="table-note">
              {sheetMode === "reference"
                ? "Categories are assigned automatically from total salary bands. Earned is Salary/Month prorated by present days. Basic is Earned x Basic %. HRA and TA split prorated Total Salary minus Basic in a 70% / 30% ratio."
                : `For PF-on rows, main-sheet attendance starts at 26 - (${effectiveMonthDays} calendar days - present days), then reduces when needed so Basic always equals attendance x category daily wage. HRA/travel allowance are attendance-prorated, and any excess target gross is shown as Bonus so net pay matches the reference sheet. PF-off rows stay aligned with the reference sheet.`}
            </div>
          </article>

          <aside className="side-stack">
            <article className="panel">
              <div className="panel-heading compact">
                <div>
                  <h2>Rules</h2>
                  <p>Applied automatically</p>
                </div>
              </div>
              <div className="rule-list">
                <Rule label="Category" value="Below 12k Unskilled, 12k to below 20k Semi-skilled, 20k and above Skilled" />
                <Rule label="Calendar Days" value={`${effectiveMonthDays} days for ${monthLabel || "selected month"}`} />
                <Rule label="Earned Salary" value="Salary/Month / calendar days x present days" />
                <Rule label="Reference Basic" value="Earned Salary x Basic %" />
                <Rule label="Main PF Attendance" value={`Starts at 26 - (${effectiveMonthDays} - present days), then reduces if Basic plus Bonus is too high`} />
                <Rule label="Official Basic" value="Attendance x category daily wage" />
                <Rule label="Zone A Day Rate" value="Unskilled 400, Semi-skilled 440, Skilled 484" />
                <Rule label="Sunday Attendance" value="Paid automatically for all Sundays if present >= 21 days (31-day month) or >= 20 days (30-day month)" />
                <Rule label="Sunday Double Pay" value="Sundays actually worked count again as a bonus day (double pay) if threshold is met" />
                <Rule
                  label="HRA"
                  value={`${HRA_SHARE_OF_BALANCE * 100}% of prorated Total Salary minus Basic`}
                />
                <Rule
                  label="Travel Allowance"
                  value={`${TA_SHARE_OF_BALANCE * 100}% of prorated Total Salary minus Basic`}
                />
                <Rule
                  label="PF"
                  value={`${PF_RATE * 100}% on Basic (capped at ${currency(PF_BASIC_LIMIT)} Basic) when PF is enabled`}
                />
                <Rule label="ESI" value={`${ESI_RATE * 100}% on Salary/Month when ESI is enabled (auto-off above ${currency(ESI_GROSS_LIMIT)} Gross)`} />
                <Rule label="P-Tax" value="Based on Gross Payable (before PF/ESI) slab" />
                <Rule label="Advance" value="Positive adds to net pay, negative subtracts from net pay" />
                <Rule label="Performance Bonus" value="Carried from reference sheet, or Sunday bonus if attendance synced" />
              </div>
            </article>

            <article className="panel">
              <div className="panel-heading compact">
                <div>
                  <h2><BarChart3 size={18} /> Category Net Pay</h2>
                  <p>Largest groups</p>
                </div>
              </div>
              <div className="bar-list">
                {categoryTotals.map((item) => {
                  const width = totals.net ? Math.max(8, (item.total / totals.net) * 100) : 0;
                  return (
                    <div className="bar-row" key={item.category}>
                      <div className="bar-label">
                        <span>{item.category}</span>
                        <strong>{currency(item.total)}</strong>
                      </div>
                      <div className="bar-track">
                        <span style={{ width: `${width}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>

            <article className="panel status-panel">
              <div className="status-row">
                <CheckCircle2 size={22} />
                <div>
                  <h2>Ready to Pay</h2>
                  <strong>{currency(totals.net)}</strong>
                </div>
              </div>
              <div className="status-list">
                <Rule label="Employees" value={`${totals.employees} active`} />
                <Rule label="Employer PF" value={currency(totals.employerPf)} />
                <Rule label="Deductions" value={currency(totals.deductions)} />
              </div>
            </article>
          </aside>
        </section>
      </main>

      {isAttendanceModalOpen && attendanceData && (
        <AttendanceCheckerModal
          data={attendanceData}
          month={attendanceMonth}
          onClose={() => setIsAttendanceModalOpen(false)}
          employees={employees}
          onUploadNewFile={(newData, newMonth) => {
            setAttendanceData(newData);
            setAttendanceMonth(newMonth);
          }}
          onSyncAttendance={(auditedEmps) => {
            setEmployees((current) => {
              let syncCount = 0;
              const next = current.map((emp) => {
                const matched = auditedEmps.find((d) => {
                  const name1 = emp.name.toLowerCase().replace(/[^a-z0-9]/g, "");
                  const name2 = d.name.toLowerCase().replace(/[^a-z0-9]/g, "");
                  return name1.includes(name2) || name2.includes(name1);
                });
                if (matched) {
                  syncCount++;
                  return {
                    ...emp,
                    daysWorked: matched.presentDays,
                    extraDays: matched.sundaysEligible,
                    performanceBonus: matched.sundaysEligible > 0 ? undefined : emp.performanceBonus,
                  };
                }
                // Sync employees without matching attendance in the sheet to 0 days worked & 0 extra days
                return {
                  ...emp,
                  daysWorked: 0,
                  extraDays: 0,
                };
              });
              showToast(
                `Synced attendance: ${syncCount} employees matched, ${
                  current.length - syncCount
                } set to 0 due to no attendance.`,
                "success"
              );
              return next;
            });
            setIsAttendanceModalOpen(false);
          }}
          showToast={showToast}
        />
      )}

      {showNoDataModal && (
        <div className="attendance-overlay">
          <div className="attendance-modal" style={{ maxWidth: "500px", height: "auto", padding: "28px" }}>
            <div style={{ marginBottom: "20px" }}>
              <span className="modal-eyebrow">Database Notice</span>
              <h2 style={{ fontSize: "20px", fontWeight: 700, margin: "8px 0" }}>
                Initialize {activeCompany} &middot; {noDataMonth}
              </h2>
              <p style={{ color: "#667085", fontSize: "14px", lineHeight: "1.5" }}>
                No records exist for <strong>{companyName || activeCompany}</strong> in <strong>{noDataMonth}</strong> yet. How would you like to initialize this month?
              </p>
            </div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "24px" }}>
              {allMonths.filter(m => m !== noDataMonth).length > 0 && (
                <div style={{ padding: "14px", border: "1px solid #e2e8f0", borderRadius: "8px", background: "#f8fafc" }}>
                  <label style={{ fontSize: "11px", fontWeight: "bold", textTransform: "uppercase", display: "block", marginBottom: "6px" }}>
                    Copy Employees From:
                  </label>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <select 
                      value={copySourceMonth} 
                      onChange={(e) => setCopySourceMonth(e.target.value)}
                      style={{ flex: 1, padding: "8px", border: "1px solid #cbd5e1", borderRadius: "6px", background: "#fff", fontSize: "14px" }}
                    >
                      {allMonths.filter(m => m !== noDataMonth).map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    <button 
                      className="primary-button" 
                      onClick={() => handleCopyMonth(copySourceMonth)}
                      style={{ padding: "0 14px", height: "38px", fontSize: "13px" }}
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}

              {activeCompany === "NKPL" && (
                <button
                  className="ghost-button"
                  onClick={handleCreateSampleMonth}
                  style={{ justifyContent: "center", height: "42px", fontWeight: "600", color: "#2563eb", borderColor: "#2563eb", background: "rgba(37,99,235,0.04)" }}
                >
                  Use Default Sample Employees
                </button>
              )}

              <button 
                className="quiet-button" 
                onClick={handleCreateBlankMonth}
                style={{ justifyContent: "center", height: "42px", fontWeight: "500", border: "1px solid #cbd5e1" }}
              >
                Start with a Blank Sheet
              </button>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button 
                className="quiet-button" 
                onClick={handleCancelNoData}
                style={{ color: "#ef4444", fontWeight: "600" }}
              >
                Cancel & Restore Previous Month
              </button>
            </div>
          </div>
        </div>
      )}

      {isDbModalOpen && (
        <div className="attendance-overlay" onClick={() => setIsDbModalOpen(false)}>
          <div
            className="attendance-modal"
            style={{ maxWidth: "600px", height: "auto", padding: "28px" }}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <div>
                <span className="modal-eyebrow">Database Settings</span>
                <h2 style={{ fontSize: "20px", fontWeight: 700, margin: "4px 0" }}>Database Sync & Backup</h2>
              </div>
              <button className="close-modal" onClick={() => setIsDbModalOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <div style={{ marginBottom: "24px" }}>
              <div style={{ marginBottom: "20px", padding: "16px", background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: "10px", color: "#065f46", fontSize: "14px", display: "flex", gap: "10px", alignItems: "flex-start" }}>
                <Cloud size={20} style={{ color: "#059669", flexShrink: 0, marginTop: "2px" }} />
                <div>
                  <strong style={{ display: "block", marginBottom: "4px", fontSize: "15px" }}>Global Vercel Blob Sync Active</strong>
                  The application is successfully linked to your Vercel Blob store <strong>nawkiran-salary-blob</strong>. All database operations load and sync automatically by company and month for everyone who opens the app &mdash; NKPL and APTUS data are kept completely separate.
                </div>
              </div>

              <div style={{ marginBottom: "20px", padding: "12px 16px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", color: "#64748b", fontSize: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
                <Wifi size={18} style={{ color: "#2563eb", flexShrink: 0 }} />
                <div>
                  <strong>Local Caching Active:</strong> IndexedDB caches the data locally in your browser to ensure offline support and maximum speed.
                </div>
              </div>

              <div style={{ fontSize: "13px", color: "#64748b", background: "#f8fafc", padding: "14px", borderRadius: "8px", border: "1px solid #e2e8f0", lineHeight: "1.5" }}>
                <strong>Vercel Blob Advantages:</strong>
                <ul style={{ paddingLeft: "18px", marginTop: "6px", display: "flex", flexDirection: "column", gap: "4px", listStyleType: "disc" }}>
                  <li><strong>Zero Pauses</strong>: Free-tier Vercel Blob storage never pauses or sleeps, even with zero activity.</li>
                  <li><strong>Instant Access</strong>: Loads database entries within milliseconds for all visitors globally.</li>
                  <li><strong>No Configuration Required</strong>: Managed securely on Vercel's cloud infrastructure without leaking tokens to the frontend.</li>
                </ul>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
              <button 
                className="quiet-button" 
                onClick={() => setIsDbModalOpen(false)}
                style={{ fontWeight: "600" }}
              >
                Close Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`custom-toast ${toast.type}`} onClick={() => setToast(null)}>
          {toast.type === "success" ? <Check size={16} /> : <AlertTriangle size={16} />}
          <span>{toast.message}</span>
        </div>
      )}
    </>
  );
}

interface AttendanceCheckerModalProps {
  data: AttendanceEmployee[];
  month: string;
  onClose: () => void;
  employees: EmployeeInput[];
  onUploadNewFile: (data: AttendanceEmployee[], month: string) => void;
  onSyncAttendance: (auditedEmployees: AttendanceEmployee[]) => void;
  showToast: (message: string, type?: "success" | "error") => void;
}

function AttendanceCheckerModal({
  data,
  month,
  onClose,
  employees,
  onUploadNewFile,
  onSyncAttendance,
  showToast,
}: AttendanceCheckerModalProps) {
  const modalFileRef = useRef<HTMLInputElement>(null);

  const handleModalUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(buffer, { type: "array" });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
      const parsed = parseAttendanceExcel(rows, employees);
      onUploadNewFile(parsed.employees, parsed.monthLabel);
      showToast("Successfully uploaded and parsed new attendance file.");
    } catch (err) {
      console.error(err);
      showToast("Error parsing the Excel file. Please check format.", "error");
    } finally {
      event.target.value = "";
    }
  };

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(data[0]?.id || null);
  const [activeChartTab, setActiveChartTab] = useState<"days" | "hours">("days");
  const [sortField, setSortField] = useState<"name" | "presentDays" | "avgHours" | "sundaysWorked" | "sundaysEligible" | "warnings">("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [modalTab, setModalTab] = useState<"audit" | "analytics">("audit");
  const [chartSort, setChartSort] = useState<"name" | "value-desc" | "value-asc">("value-desc");

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection(field === "name" ? "asc" : "desc");
    }
  };

  const handleToggleOverride = (
    employeeId: string,
    dateString: string,
    type: "override" | "leaveType",
    value: any
  ) => {
    const updatedData = data.map((emp) => {
      if (emp.id !== employeeId) return emp;

      const updatedDaysDetail = emp.daysDetail.map((day) => {
        if (day.dateString !== dateString) return day;

        const newDay = { ...day };
        if (type === "override") {
          newDay.manualOverride = value; // "present" or undefined
          if (value === "present") {
            newDay.isPresent = true;
          } else {
            newDay.isPresent = newDay.punchTimes.length > 0 && !newDay.isShortStay;
          }
        } else if (type === "leaveType") {
          newDay.leaveType = value; // "approved" or "unapproved"
        }
        return newDay;
      });

      const stats = calculateEmployeeAttendanceStats(updatedDaysDetail, emp.isSecurity);

      return {
        ...emp,
        daysDetail: updatedDaysDetail,
        ...stats,
      };
    });

    onUploadNewFile(updatedData, month);
  };

  const sortedAndFilteredData = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let result = [...data];
    if (q) {
      result = result.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.department.toLowerCase().includes(q)
      );
    }

    result.sort((a, b) => {
      let valA: any;
      let valB: any;

      if (sortField === "warnings") {
        valA = a.isSecurity ? 99 : a.sundayDetails.filter((d) => !d.isEligible).length;
        valB = b.isSecurity ? 99 : b.sundayDetails.filter((d) => !d.isEligible).length;
      } else {
        valA = a[sortField];
        valB = b[sortField];
      }

      if (typeof valA === "string") {
        return sortDirection === "asc"
          ? valA.localeCompare(valB)
          : valB.localeCompare(valA);
      } else {
        return sortDirection === "asc" ? valA - valB : valB - valA;
      }
    });

    return result;
  }, [searchQuery, data, sortField, sortDirection]);

  const selectedEmployee = data.find((e) => e.id === selectedId);

  const totalWorkedSundays = data.reduce((sum, e) => sum + e.sundaysWorked, 0);
  const totalEligibleSundays = data.reduce((sum, e) => sum + e.sundaysEligible, 0);
  const totalWarnings = data.reduce((sum, e) => {
    const flaggedCount = e.sundayDetails.filter((d) => !d.isEligible).length;
    return sum + flaggedCount;
  }, 0);

  const avgAttendance =
    data.length > 0
      ? data.reduce((sum, e) => sum + e.presentDays, 0) / data.length
      : 0;
  const avgStayHours =
    data.length > 0
      ? data.reduce((sum, e) => sum + e.avgHours, 0) / data.length
      : 0;

  const maxPresentDays = Math.max(...data.map((e) => e.presentDays), 1);
  const maxStayHours = Math.max(...data.map((e) => e.avgHours), 1);

  const sortedChartData = useMemo(() => {
    const result = [...data];
    if (chartSort === "name") {
      result.sort((a, b) => a.name.localeCompare(b.name));
    } else if (chartSort === "value-desc") {
      result.sort((a, b) => {
        const valA = activeChartTab === "days" ? a.presentDays : a.avgHours;
        const valB = activeChartTab === "days" ? b.presentDays : b.avgHours;
        return valB - valA;
      });
    } else if (chartSort === "value-asc") {
      result.sort((a, b) => {
        const valA = activeChartTab === "days" ? a.presentDays : a.avgHours;
        const valB = activeChartTab === "days" ? b.presentDays : b.avgHours;
        return valA - valB;
      });
    }
    return result;
  }, [data, chartSort, activeChartTab]);

  return (
    <div className="attendance-overlay" onClick={onClose}>
      <div className="attendance-modal" onClick={(event) => event.stopPropagation()}>
        <header className="attendance-header">
          <div>
            <span className="modal-eyebrow">Data Auditor</span>
            <h1>Attendance Checker & Sunday Bonus Auditor</h1>
            <p className="modal-copy">
              Audit raw punch card logs, verify stay times, and inspect Sunday bonus eligibility for {month || "May 2026"}.
            </p>
          </div>
          <div className="attendance-header-actions" style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button
              className="primary-button"
              type="button"
              onClick={() => onSyncAttendance(data)}
              style={{ minHeight: "36px", height: "36px", padding: "0 12px", fontSize: "13px", background: "#059669", color: "#ffffff", borderColor: "#059669" }}
            >
              <Check size={14} /> Sync to Payroll
            </button>
            <button
              className="ghost-button"
              type="button"
              onClick={() => modalFileRef.current?.click()}
              style={{ minHeight: "36px", height: "36px", padding: "0 12px", fontSize: "13px" }}
            >
              <Upload size={15} /> Upload New File
            </button>
            <input
              ref={modalFileRef}
              className="hidden-input"
              type="file"
              accept=".xls,.xlsx"
              onChange={handleModalUpload}
            />
            <button
              className="icon-button close-modal"
              type="button"
              onClick={onClose}
              style={{ minHeight: "36px", height: "36px", width: "36px" }}
            >
              <X size={20} />
            </button>
          </div>
        </header>

        {/* Tab Selector Bar */}
        <div className="attendance-tabs">
          <button
            className={`attendance-tab-link ${modalTab === "audit" ? "active" : ""}`}
            onClick={() => setModalTab("audit")}
          >
            <Users size={15} /> Employee Auditor
          </button>
          <button
            className={`attendance-tab-link ${modalTab === "analytics" ? "active" : ""}`}
            onClick={() => setModalTab("analytics")}
          >
            <BarChart3 size={15} /> Analytics & Standings
          </button>
        </div>

        {modalTab === "audit" ? (
          /* Tab 1: Split Screen Auditor View */
          <div className="attendance-split-workspace">
            {/* Left Column: Employee List Table */}
            <div className="attendance-left-pane">
              <div className="attendance-panel-heading" style={{ padding: "16px 20px" }}>
                <div>
                  <h2 style={{ fontSize: "14px", fontWeight: 800 }}>Employee Records</h2>
                  <p style={{ fontSize: "11px", color: "#64748b" }}>{sortedAndFilteredData.length} total</p>
                </div>
                <div className="search-box attendance-search-box" style={{ width: "200px", minHeight: "34px", height: "34px" }}>
                  <Search size={14} />
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search name..."
                    style={{ fontSize: "12px", minHeight: "30px", height: "30px" }}
                  />
                </div>
              </div>

              <div className="attendance-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th onClick={() => handleSort("name")} className="sortable-th">
                        Name {sortField === "name" && (sortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleSort("presentDays")} className="sortable-th text-right">
                        Days {sortField === "presentDays" && (sortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleSort("avgHours")} className="sortable-th text-right">
                        Stay {sortField === "avgHours" && (sortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleSort("warnings")} className="sortable-th text-center">
                        Status {sortField === "warnings" && (sortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedAndFilteredData.map((emp) => {
                      const totalFlags = emp.sundayDetails.filter((d) => !d.isEligible).length;
                      const isSelected = emp.id === selectedId;
                      return (
                        <tr
                          key={emp.id}
                          onClick={() => setSelectedId(emp.id)}
                          className={`clickable-row ${isSelected ? "selected-row" : ""}`}
                        >
                          <td className="name-cell font-bold" style={{ fontSize: "11.5px" }}>{emp.name}</td>
                          <td className="text-right">{emp.presentDays} Days</td>
                          <td className="text-right">{emp.avgHours.toFixed(1)} Hrs</td>
                          <td>
                            {emp.isSecurity ? (
                              <span className="badge badge-rose" style={{ fontSize: "9px" }}>Security</span>
                            ) : totalFlags > 0 ? (
                              <span className="badge badge-amber" style={{ fontSize: "9px" }}>{totalFlags} Warning</span>
                            ) : emp.sundaysWorked > 0 ? (
                              <span className="badge badge-green" style={{ fontSize: "9px" }}>Eligible</span>
                            ) : (
                              <span className="badge badge-neutral" style={{ fontSize: "9px" }}>None</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {sortedAndFilteredData.length === 0 && (
                      <tr className="empty-row">
                        <td colSpan={4}>No matching audited employees.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Right Column: Selected Employee Audit Detail */}
            <div className="attendance-right-pane">
              {selectedEmployee ? (
                <div className="employee-audit-card">
                  <header className="employee-audit-header">
                    <div>
                      <h3 style={{ fontSize: "22px", fontWeight: 900 }}>{selectedEmployee.name}</h3>
                      <p style={{ fontSize: "13px", color: "#64748b", marginTop: "4px" }}>
                        Department: <strong>{selectedEmployee.department}</strong> | Present days this month:{" "}
                        <strong>{selectedEmployee.presentDays} Days</strong> | Average stay duration: <strong>{selectedEmployee.avgHours.toFixed(1)} Hrs/Day</strong>
                      </p>
                    </div>
                    <div className="employee-badges" style={{ gap: "8px" }}>
                      {selectedEmployee.isSecurity && (
                        <span className="badge badge-rose">Security guard (Exempt)</span>
                      )}
                      {!selectedEmployee.meetsMonthThreshold && (
                        <span className="badge badge-amber">Below Monthly Threshold</span>
                      )}
                      {selectedEmployee.daysDetail.some((d) => d.isShortStay) && (
                        <span className="badge badge-rose">
                          {selectedEmployee.daysDetail.filter((d) => d.isShortStay).length} Short Stays
                        </span>
                      )}
                    </div>
                  </header>

                  {/* Summary of Employee Sunday Status & Shifts */}
                  <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                    <div className="metric-card" style={{ flex: "1 1 120px", minHeight: "80px", padding: "12px 16px" }}>
                      <div>
                        <p style={{ fontSize: "11px", fontWeight: 800, color: "#64748b", textTransform: "uppercase" }}>Sundays Worked</p>
                        <strong style={{ fontSize: "20px", marginTop: "4px" }}>{selectedEmployee.sundaysWorked} Days</strong>
                      </div>
                    </div>
                    <div className="metric-card" style={{ flex: "1 1 120px", minHeight: "80px", padding: "12px 16px" }}>
                      <div>
                        <p style={{ fontSize: "11px", fontWeight: 800, color: "#64748b", textTransform: "uppercase" }}>Sunday Bonus Days</p>
                        <strong style={{ fontSize: "20px", marginTop: "4px" }}>{selectedEmployee.sundaysEligible} Days</strong>
                      </div>
                    </div>
                    <div className="metric-card" style={{ flex: "1 1 120px", minHeight: "80px", padding: "12px 16px" }}>
                      <div>
                        <p style={{ fontSize: "11px", fontWeight: 800, color: "#64748b", textTransform: "uppercase" }}>Day Shifts</p>
                        <strong style={{ fontSize: "20px", marginTop: "4px", color: "#2563eb" }}>
                          {selectedEmployee.daysDetail.filter((d) => d.isPresent && d.shift === "Day").length} Days
                        </strong>
                      </div>
                    </div>
                    <div className="metric-card" style={{ flex: "1 1 120px", minHeight: "80px", padding: "12px 16px" }}>
                      <div>
                        <p style={{ fontSize: "11px", fontWeight: 800, color: "#64748b", textTransform: "uppercase" }}>Night Shifts</p>
                        <strong style={{ fontSize: "20px", marginTop: "4px", color: "#7c3aed" }}>
                          {selectedEmployee.daysDetail.filter((d) => d.isPresent && d.shift === "Night").length} Days
                        </strong>
                      </div>
                    </div>
                  </div>

                  {selectedEmployee.sundayDetails && selectedEmployee.sundayDetails.length > 0 ? (
                    <div className="sunday-audit-section">
                      <h4 style={{ fontSize: "12px", fontWeight: 900 }}>Sunday Audit Logs</h4>
                      <div className="sunday-cards-grid" style={{ marginTop: "12px" }}>
                        {selectedEmployee.sundayDetails.map((sun, idx) => {
                          const dayDetail = selectedEmployee.daysDetail.find(
                            (d) => d.dateString === sun.date
                          );
                          const actuallyWorked = dayDetail?.isPresent;

                          let badgeText = "Not Paid";
                          let badgeBg = "#ffe4e6";
                          let badgeColor = "#b91c1c";
                          let borderStyle = "4px solid #f87171";
                          let cardBg = "#fffafb";

                          if (sun.isEligible) {
                            if (actuallyWorked) {
                              badgeText = "Double Pay (Present + Bonus)";
                              badgeBg = "#dcfce7";
                              badgeColor = "#15803d";
                              borderStyle = "4px solid #10b981";
                              cardBg = "#f6fdf9";
                            } else {
                              badgeText = "Paid (Auto-Presence)";
                              badgeBg = "#dbeafe";
                              badgeColor = "#1e40af";
                              borderStyle = "4px solid #3b82f6";
                              cardBg = "#f5f9ff";
                            }
                          } else {
                            if (actuallyWorked) {
                              badgeText = "Single Pay (No Bonus)";
                              badgeBg = "#fef3c7";
                              badgeColor = "#b45309";
                              borderStyle = "4px solid #f59e0b";
                              cardBg = "#fffdf5";
                            }
                          }

                          return (
                            <div
                              key={idx}
                              className="sunday-card"
                              style={{
                                padding: "12px",
                                borderLeft: borderStyle,
                                background: cardBg,
                              }}
                            >
                              <div className="sunday-card-header">
                                <span className="sunday-date" style={{ fontSize: "12px" }}>
                                  <Calendar size={13} style={{ marginRight: "4px" }} /> {sun.date}
                                </span>
                                <span
                                  className="badge"
                                  style={{
                                    fontSize: "9px",
                                    fontWeight: 800,
                                    textTransform: "uppercase",
                                    padding: "4px 8px",
                                    borderRadius: "9999px",
                                    background: badgeBg,
                                    color: badgeColor,
                                  }}
                                >
                                  {badgeText}
                                </span>
                              </div>
                              <ul className="reasons-list" style={{ marginTop: "8px" }}>
                                {sun.reasons.map((r, i) => (
                                  <li key={i} style={{ fontSize: "11px", color: badgeColor }}>
                                    <AlertTriangle size={12} style={{ marginRight: "4px" }} /> {r}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="info-callout" style={{ padding: "12px 16px" }}>
                      <Info size={16} />
                      <p style={{ fontSize: "13px" }}>No Sunday details available for this month.</p>
                    </div>
                  )}

                  <div className="daily-log-section">
                    <h4 style={{ fontSize: "12px", fontWeight: 900 }}>Daily Punch Logs & Durations</h4>
                    <div className="daily-timeline" style={{ marginTop: "16px" }}>
                      {selectedEmployee.daysDetail.map((day, idx) => {
                        const isSunday = day.dayOfWeek === 0;
                        const isSaturday = day.dayOfWeek === 6;
                        const dayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day.dayOfWeek];
                        const dateNum = day.dateString.split("/")[2] || "";

                        return (
                          <div
                            key={idx}
                            className={`timeline-row ${day.isPresent ? "present" : day.isShortStay ? "short-stay" : "absent"} ${
                              isSunday ? "sunday-row" : ""
                            } ${isSaturday ? "saturday-row" : ""}`}
                          >
                            <div className="timeline-date-col">
                              <span className="timeline-day-num">{dateNum}</span>
                              <span className="timeline-day-name" style={{ fontSize: "9px" }}>{dayName}</span>
                            </div>
                            <div className="timeline-status-indicator">
                              <span className="dot"></span>
                            </div>
                            <div className="timeline-info-col">
                              {day.isPresent ? (
                                <div className="punch-details" style={{ gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
                                  <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
                                    {day.punchTimes.length > 0 ? (
                                      <div className="punch-times-badge" style={{ padding: "3px 8px", fontSize: "11.5px" }}>
                                        <Clock size={12} />
                                        <span>Punches: {day.punchTimes.join("  |  ")}</span>
                                      </div>
                                    ) : (
                                      <div className="punch-times-badge" style={{ padding: "3px 8px", fontSize: "11.5px", background: "#f0fdf4", borderColor: "#bbf7d0", color: "#166534" }}>
                                        <Clock size={12} style={{ color: "#16a34a" }} />
                                        <span>No Punch Logs (Forgot Punch)</span>
                                      </div>
                                    )}
                                    {day.punchTimes.length > 0 && (
                                      <span className="punch-duration" style={{ fontSize: "11.5px" }}>
                                        {day.duration.toFixed(1)} Hours Stayed
                                      </span>
                                    )}
                                    {day.shift && day.punchTimes.length > 0 && (
                                      <span className="badge" style={{ fontSize: "10px", padding: "3px 8px", background: day.shift === "Night" ? "#f3e8ff" : "#eff6ff", color: day.shift === "Night" ? "#6b21a8" : "#1e40af", border: day.shift === "Night" ? "1px solid #d8b4fe" : "1px solid #bfdbfe", textTransform: "none" }}>
                                        {day.shift === "Night" ? "Night Shift" : "Day Shift"}
                                      </span>
                                    )}
                                    {day.manualOverride === "present" && (
                                      <span className="badge badge-green" style={{ fontSize: "10px", textTransform: "none", padding: "3px 8px", display: "inline-flex", alignItems: "center" }}>
                                        Approved (Manual Override)
                                      </span>
                                    )}
                                    {day.manualOverride === "present" && (
                                      <button
                                        type="button"
                                        onClick={() => handleToggleOverride(selectedEmployee.id, day.dateString, "override", undefined)}
                                        style={{ background: "none", border: "none", color: "#b91c1c", fontSize: "11px", fontWeight: 700, cursor: "pointer", textDecoration: "underline", padding: 0 }}
                                      >
                                        Revert
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ) : day.isShortStay ? (
                                <div className="punch-details" style={{ gap: "12px", flexDirection: "column", alignItems: "flex-start" }}>
                                  <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
                                    <div className="punch-times-badge" style={{ padding: "3px 8px", fontSize: "11.5px", background: "#fff5f5", borderColor: "#feb2b2", color: "#9b1c1c" }}>
                                      <Clock size={12} style={{ color: "#c53030" }} />
                                      <span>Punches: {day.punchTimes.join("  |  ")}</span>
                                    </div>
                                    <span className="badge badge-rose" style={{ fontSize: "10.5px", textTransform: "none", padding: "3px 10px", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                                      <AlertTriangle size={11} />
                                      Short Stay ({day.duration.toFixed(1)} Hrs &lt; 5 Hrs) - Marked Absent
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleToggleOverride(selectedEmployee.id, day.dateString, "override", "present")}
                                      style={{ background: "#dcfce7", border: "1px solid #bbf7d0", color: "#15803d", fontSize: "11px", fontWeight: 700, cursor: "pointer", padding: "4px 8px", borderRadius: "4px" }}
                                    >
                                      Approve as Present
                                    </button>
                                  </div>
                                  
                                  {/* Leave Status controls for Short Stay */}
                                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                    <span style={{ fontSize: "10.5px", color: "#64748b", fontWeight: 700 }}>Leave Status:</span>
                                    <div style={{ display: "flex", background: "#f1f5f9", padding: "2px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                                      <button
                                        type="button"
                                        onClick={() => handleToggleOverride(selectedEmployee.id, day.dateString, "leaveType", "approved")}
                                        style={{ fontSize: "10px", padding: "2px 8px", border: 0, borderRadius: "4px", fontWeight: 700, cursor: "pointer", background: day.leaveType !== "unapproved" ? "#ffffff" : "transparent", color: day.leaveType !== "unapproved" ? "#16a34a" : "#64748b", boxShadow: day.leaveType !== "unapproved" ? "0 1px 2px rgba(0,0,0,0.05)" : "none" }}
                                      >
                                        Approved (Informed)
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleToggleOverride(selectedEmployee.id, day.dateString, "leaveType", "unapproved")}
                                        style={{ fontSize: "10px", padding: "2px 8px", border: 0, borderRadius: "4px", fontWeight: 700, cursor: "pointer", background: day.leaveType === "unapproved" ? "#ffffff" : "transparent", color: day.leaveType === "unapproved" ? "#dc2626" : "#64748b", boxShadow: day.leaveType === "unapproved" ? "0 1px 2px rgba(0,0,0,0.05)" : "none" }}
                                      >
                                        Unapproved (Uninformed)
                                      </button>
                                    </div>
                                    {day.leaveType === "unapproved" && (
                                      <span className="badge badge-rose" style={{ fontSize: "10px", textTransform: "none", padding: "2px 6px", display: "inline-flex", alignItems: "center", gap: "2px" }}>
                                        <AlertTriangle size={9} />
                                        -1 Penalty Day (Marked 2 Days Absent)
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <div className="punch-details" style={{ gap: "12px", alignItems: "center", flexWrap: "wrap", justifyContent: "space-between", width: "100%" }}>
                                  <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                                    <span className="absent-label" style={{ fontSize: "11px" }}>Absent / Off-day</span>
                                    <button
                                      type="button"
                                      onClick={() => handleToggleOverride(selectedEmployee.id, day.dateString, "override", "present")}
                                      style={{ background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e40af", fontSize: "11px", fontWeight: 700, cursor: "pointer", padding: "4px 8px", borderRadius: "4px", display: "inline-flex", alignItems: "center", gap: "4px", transition: "all 0.15s ease" }}
                                    >
                                      <Check size={12} /> Mark Present (Forgot Punch)
                                    </button>
                                  </div>
                                  
                                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                    <span style={{ fontSize: "10.5px", color: "#64748b", fontWeight: 700 }}>Leave Status:</span>
                                    <div style={{ display: "flex", background: "#f1f5f9", padding: "2px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                                      <button
                                        type="button"
                                        onClick={() => handleToggleOverride(selectedEmployee.id, day.dateString, "leaveType", "approved")}
                                        style={{ fontSize: "10px", padding: "2px 8px", border: 0, borderRadius: "4px", fontWeight: 700, cursor: "pointer", background: day.leaveType !== "unapproved" ? "#ffffff" : "transparent", color: day.leaveType !== "unapproved" ? "#16a34a" : "#64748b", boxShadow: day.leaveType !== "unapproved" ? "0 1px 2px rgba(0,0,0,0.05)" : "none" }}
                                      >
                                        Approved (Informed)
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleToggleOverride(selectedEmployee.id, day.dateString, "leaveType", "unapproved")}
                                        style={{ fontSize: "10px", padding: "2px 8px", border: 0, borderRadius: "4px", fontWeight: 700, cursor: "pointer", background: day.leaveType === "unapproved" ? "#ffffff" : "transparent", color: day.leaveType === "unapproved" ? "#dc2626" : "#64748b", boxShadow: day.leaveType === "unapproved" ? "0 1px 2px rgba(0,0,0,0.05)" : "none" }}
                                      >
                                        Unapproved (Uninformed)
                                      </button>
                                    </div>
                                    {day.leaveType === "unapproved" && (
                                      <span className="badge badge-rose" style={{ fontSize: "10px", textTransform: "none", padding: "2px 6px", display: "inline-flex", alignItems: "center", gap: "2px" }}>
                                        <AlertTriangle size={9} />
                                        -1 Penalty Day (Marked 2 Days Absent)
                                      </span>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="select-prompt">
                  <Users size={32} />
                  <p>Select an employee from the list to audit their daily logs.</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Tab 2: Analytics & Overall Standings View */
          <div className="attendance-analytics-tab" style={{ flex: 1, display: "flex", flexDirection: "column", overflowY: "auto" }}>
            {/* Global Metric Cards */}
            <section className="attendance-stats-row" style={{ borderBottom: "1px solid #edf1f7", padding: "24px 32px" }}>
              <div className="metric-card blue">
                <span>
                  <Calendar />
                </span>
                <div>
                  <p>Avg Present Days</p>
                  <strong>{avgAttendance.toFixed(1)} Days</strong>
                  <small>Across {data.length} audited rows</small>
                </div>
              </div>
              <div className="metric-card green">
                <span>
                  <Clock />
                </span>
                <div>
                  <p>Avg Stay Duration</p>
                  <strong>{avgStayHours.toFixed(1)} Hrs/Day</strong>
                  <small>Present day durations</small>
                </div>
              </div>
              <div className="metric-card amber">
                <span>
                  <FileSpreadsheet />
                </span>
                <div>
                  <p>Worked Sundays</p>
                  <strong>{totalWorkedSundays} Sundays</strong>
                  <small>{totalEligibleSundays} Sundays eligible for bonus</small>
                </div>
              </div>
              <div className="metric-card rose">
                <span>
                  <AlertTriangle />
                </span>
                <div>
                  <p>Bonus Exclusions</p>
                  <strong>{totalWarnings} Flags</strong>
                  <small>Worked Sundays denied bonus</small>
                </div>
              </div>
            </section>

            {/* Standings Charts section */}
            <div className="attendance-panel charts-panel" style={{ margin: "32px", border: "1px solid #e0e5ee", borderRadius: "8px", background: "#ffffff", boxShadow: "none" }}>
              <div className="detail-tabs" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 24px" }}>
                <span className="tab-title-text" style={{ fontSize: "14px", fontWeight: 800, color: "#334155" }}>Comparative Standings Charts</span>
                
                <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                  {/* Chart Sorting Controls */}
                  <div className="chart-sort-controls" style={{ display: "flex", alignItems: "center", gap: "8px", background: "#f1f5f9", padding: "3px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                    <span style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", padding: "0 6px" }}>Sort:</span>
                    <button
                      className={`chart-tab-btn ${chartSort === "value-desc" ? "active" : ""}`}
                      onClick={() => setChartSort("value-desc")}
                      style={{ fontSize: "11px", padding: "4px 8px" }}
                    >
                      High-Low
                    </button>
                    <button
                      className={`chart-tab-btn ${chartSort === "value-asc" ? "active" : ""}`}
                      onClick={() => setChartSort("value-asc")}
                      style={{ fontSize: "11px", padding: "4px 8px" }}
                    >
                      Low-High
                    </button>
                    <button
                      className={`chart-tab-btn ${chartSort === "name" ? "active" : ""}`}
                      onClick={() => setChartSort("name")}
                      style={{ fontSize: "11px", padding: "4px 8px" }}
                    >
                      A-Z
                    </button>
                  </div>

                  {/* Chart Metric Tabs */}
                  <div className="chart-tabs-btn-group" style={{ display: "flex", background: "#f1f5f9", padding: "3px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                    <button
                      className={`chart-tab-btn ${activeChartTab === "days" ? "active" : ""}`}
                      onClick={() => setActiveChartTab("days")}
                      style={{ fontSize: "11px", padding: "4px 8px" }}
                    >
                      Days Present
                    </button>
                    <button
                      className={`chart-tab-btn ${activeChartTab === "hours" ? "active" : ""}`}
                      onClick={() => setActiveChartTab("hours")}
                      style={{ fontSize: "11px", padding: "4px 8px" }}
                    >
                      Staying Hours
                    </button>
                  </div>
                </div>
              </div>

              <div className="detail-content" style={{ padding: "24px", background: "#ffffff" }}>
                <div className="global-charts-card">
                  <div className="chart-body">
                    {activeChartTab === "days" ? (
                      <div className="custom-horizontal-chart">
                        <p className="chart-instructions">
                          Days present during month (out of {data[0]?.daysDetail.length || 31} calendar days)
                        </p>
                        <div className="chart-scroll-area" style={{ maxHeight: "480px" }}>
                          {sortedChartData.map((emp) => {
                            const pct = (emp.presentDays / maxPresentDays) * 100;
                            return (
                              <div key={emp.id} className="chart-bar-row">
                                <div className="bar-label-name" title={emp.name}>
                                  {emp.name}
                                </div>
                                <div className="bar-track-wrap">
                                  <div className="bar-fill" style={{ width: `${pct}%` }}></div>
                                </div>
                                <div className="bar-val-outside">{emp.presentDays} days</div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div className="custom-horizontal-chart">
                        <p className="chart-instructions">
                          Average hours spent between earliest and latest punches
                        </p>
                        <div className="chart-scroll-area" style={{ maxHeight: "480px" }}>
                          {sortedChartData.map((emp) => {
                            const pct = (emp.avgHours / maxStayHours) * 100;
                            return (
                              <div key={emp.id} className="chart-bar-row">
                                <div className="bar-label-name" title={emp.name}>
                                  {emp.name}
                                </div>
                                <div className="bar-track-wrap">
                                  <div className="bar-fill hours-fill" style={{ width: `${pct}%` }}></div>
                                </div>
                                <div className="bar-val-outside">{emp.avgHours.toFixed(1)} hrs</div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  caption,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  caption?: string;
  tone: "green" | "blue" | "amber" | "rose";
}) {
  return (
    <article className={`metric-card ${tone}`}>
      <span>{icon}</span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        {caption ? <small>{caption}</small> : null}
      </div>
    </article>
  );
}

function NumberInput({
  value,
  onChange,
  className = "number-input",
  min,
  max,
  allowBlank = false,
  disabled = false,
}: {
  value: number | undefined | "";
  onChange: (value: number | undefined) => void;
  className?: string;
  min?: number;
  max?: number;
  allowBlank?: boolean;
  disabled?: boolean;
}) {
  const displayValue =
    allowBlank && (value === undefined || value === "") ? "" : Number.isFinite(value) ? value : 0;
  return (
    <input
      className={className}
      type="number"
      min={min}
      max={max}
      value={displayValue}
      disabled={disabled}
      onChange={(event) => {
        const val = event.target.value;
        if (allowBlank && val === "") {
          onChange(undefined);
        } else {
          onChange(numberValue(val));
        }
      }}
    />
  );
}

function Rule({ label, value }: { label: string; value: string }) {
  return (
    <div className="rule-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default App;
