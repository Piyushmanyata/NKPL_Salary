import {
  clampBasicPercent,
  clampDays,
  clampMonthDays,
  numberValue,
  repairRates,
  uid,
} from "./salary";
import { normalizeCategory } from "./officialSheet";
import type { EmployeeInput } from "./types";
import type { EmployeeRateMap } from "./db";

export const blankEmployee = (monthDays: number): EmployeeInput => ({
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
  specialBonus: undefined,
});

export const sanitizeEmployee = (
  value: unknown,
  index: number,
  monthDays: number,
): EmployeeInput | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const row = value as Partial<EmployeeInput> & { isSpecial?: boolean };
  const name = String(row.name ?? "").trim();
  const rawMonthlySalary = Math.max(0, numberValue(row.monthlySalary));
  const hasSalaryPerDay =
    row.salaryPerDay !== undefined && row.salaryPerDay !== null && String(row.salaryPerDay).trim() !== "";

  // One-release shim: migrate legacy isSpecial flag → Category "Special" (TICKET-01).
  let category = normalizeCategory(row.category);
  if (row.isSpecial === true) {
    category = "Special";
  }
  if (category === null) {
    // Unrecognizable strings fall back visibly to Unskilled rather than salary-band guessing.
    category = "Unskilled";
  }
  const isSpecial = category === "Special";
  const days = clampMonthDays(monthDays);
  const rawSalaryPerDay = hasSalaryPerDay ? Math.max(0, numberValue(row.salaryPerDay)) : 0;
  const rawBonusPerDay = Math.max(0, numberValue(row.bonusPerDay));
  // One-time rate repair at load (SPEC §2.2.1 / TICKET-04). Persisted after this.
  const repaired = repairRates(category, rawMonthlySalary, rawSalaryPerDay, rawBonusPerDay, days);
  const monthlySalary = repaired.monthlySalary;
  const salaryPerDay = repaired.salaryPerDay;
  const bonusPerDay = repaired.bonusPerDay;

  if (!name && monthlySalary <= 0 && salaryPerDay <= 0) {
    return null;
  }

  return {
    id: String(row.id || `emp-${Date.now()}-${index}`),
    name,
    category,
    monthlySalary,
    totalSalary:
      category === "Unskilled"
        ? undefined
        : Math.max(0, numberValue(row.totalSalary)) > monthlySalary
          ? Math.max(0, numberValue(row.totalSalary))
          : undefined,
    salaryPerDay,
    bonusPerDay,
    daysWorked: isSpecial ? days : clampDays(numberValue(row.daysWorked), days),
    extraDays: isSpecial ? 0 : Math.max(0, numberValue(row.extraDays)),
    basicPercent: clampBasicPercent(row.basicPercent),
    pfOptIn: isSpecial ? false : row.pfOptIn !== false,
    esiOptIn: isSpecial ? false : row.esiOptIn !== false,
    esiOverLimitOptIn: !isSpecial && row.esiOverLimitOptIn === true ? true : undefined,
    advance:
      row.advance !== undefined &&
      row.advance !== null &&
      String(row.advance).trim() !== "" &&
      numberValue(row.advance) > 0
        ? numberValue(row.advance)
        : undefined,
    otherDeduction: Math.max(0, numberValue(row.otherDeduction)),
    // Absent / 0 / negative all mean "no pin" — the §6.3 formula applies. Issue #29.
    fullAttendanceBasic:
      Math.max(0, numberValue(row.fullAttendanceBasic)) > 0
        ? Math.max(0, numberValue(row.fullAttendanceBasic))
        : undefined,
    specialBonus:
      row.specialBonus !== undefined &&
      row.specialBonus !== null &&
      String(row.specialBonus).trim() !== ""
        ? numberValue(row.specialBonus)
        : undefined,
  };
};

// A new month inherits the roster and every standing rate from the month
// before it — salary, allowance, category, PF/ESI choices and TDS all carry.
// Reset manual per-month pay inputs so last month's absences are not billed twice.
export const carryForwardEmployee = (
  employee: EmployeeInput,
  monthDays: number,
): EmployeeInput => ({
  ...employee,
  daysWorked: clampMonthDays(monthDays),
  extraDays: 0,
  advance: undefined,
  specialBonus: undefined,
});

// Salary/day and bonus/day are shared across every month for a given
// employee — overlay the shared rate on top of whatever per-month snapshot
// was loaded so every month always reflects the latest rate.
export const applyEmployeeRates = (
  list: EmployeeInput[],
  rates: EmployeeRateMap,
): EmployeeInput[] =>
  list.map((employee) => {
    const rate = rates[employee.id];
    if (!rate) {
      return employee;
    }
    const monthlySalary = Math.max(0, numberValue(rate.monthlySalary));
    const totalSalary = Math.max(0, numberValue(rate.totalSalary));
    const fullAttendanceBasic = Math.max(0, numberValue(rate.fullAttendanceBasic));
    return {
      ...employee,
      salaryPerDay: Math.max(0, numberValue(rate.salaryPerDay)),
      bonusPerDay: Math.max(0, numberValue(rate.bonusPerDay)),
      ...(monthlySalary > 0 ? { monthlySalary } : {}),
      ...(totalSalary > monthlySalary ? { totalSalary } : {}),
      ...(rate.notes ? { notes: rate.notes } : {}),
      // The pin is standing rate data: clearing it in the card clears it
      // everywhere, so an explicit 0 must erase the month snapshot's value.
      fullAttendanceBasic: fullAttendanceBasic > 0 ? fullAttendanceBasic : undefined,
    };
  });

export const buildRateMap = (list: EmployeeInput[]): EmployeeRateMap => {
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
      monthlySalary: Math.max(0, numberValue(employee.monthlySalary)),
      totalSalary: Math.max(0, numberValue(employee.totalSalary)),
      ...(employee.notes?.trim() ? { notes: employee.notes } : {}),
      fullAttendanceBasic: Math.max(0, numberValue(employee.fullAttendanceBasic)),
    };
  });
  return map;
};

/** Hydrate a stored month record: sanitize each row then overlay Rate Card. */
export function hydrateRoster(
  rawEmployees: unknown[],
  monthDays: number,
  rates: EmployeeRateMap = {},
): EmployeeInput[] {
  const sanitized = rawEmployees
    .map((emp, index) => sanitizeEmployee(emp, index, monthDays))
    .filter((emp): emp is EmployeeInput => Boolean(emp));
  return applyEmployeeRates(sanitized, rates);
}
