import {
  clampBasicPercent,
  isSpecialCategory,
  monthlyFromDaily,
  numberValue,
  roundMoney,
} from "./salary";
import { normalizeCategory } from "./officialSheet";
import type { EmployeeInput } from "./types";

/** Fields the UI may edit. "allowance" is a virtual field (T − M), not on EmployeeInput. */
export type EditableField = keyof EmployeeInput | "allowance";

export type EditValue = string | number | boolean | undefined;

const booleanValue = (value: unknown) =>
  value === true || value === "true" || value === "yes" || value === "on" || value === 1;

type FieldHandler = (
  employee: EmployeeInput,
  value: EditValue,
  calendarDays: number,
) => EmployeeInput;

function applyPackageEdit(
  employee: EmployeeInput,
  field: "monthlySalary" | "totalSalary" | "allowance",
  value: EditValue,
  calendarDays: number,
): EmployeeInput {
  // M and the Monthly Allowance are what the user types for the fixed-monthly
  // categories; T = M + allowance is the stored anchor and b is derived from it.
  // Editing M holds the allowance and carries T along; editing the allowance
  // leaves M alone. T at or below M means "no allowance".
  const D = calendarDays;
  const oldM = Math.max(0, numberValue(employee.monthlySalary));
  const oldT = Math.max(0, numberValue(employee.totalSalary));
  const bonus = oldT > oldM ? (oldT - oldM) / D : Math.max(0, numberValue(employee.bonusPerDay));
  const typed = Math.max(0, numberValue(value));
  const monthlySalary = field === "monthlySalary" ? typed : oldM;
  // Unskilled stays anchored on the day rate (SPEC §2.2).
  if (employee.category === "Unskilled") {
    return {
      ...employee,
      monthlySalary,
      salaryPerDay: monthlySalary / D,
      bonusPerDay: field === "allowance" ? typed / D : employee.bonusPerDay,
    };
  }
  const total =
    field === "totalSalary"
      ? typed
      : field === "allowance"
        ? monthlySalary + typed
        : monthlySalary + D * bonus;
  return {
    ...employee,
    monthlySalary,
    totalSalary: total > monthlySalary ? roundMoney(total) : undefined,
  };
}

const handlers: Partial<Record<EditableField, FieldHandler>> = {
  name(employee, value, calendarDays) {
    const nameStr = String(value);
    if (isSpecialCategory(employee.category)) {
      return {
        ...employee,
        name: nameStr,
        daysWorked: calendarDays,
        pfOptIn: false,
        esiOptIn: false,
      };
    }
    return { ...employee, name: nameStr };
  },

  notes(employee, value) {
    const notes = String(value ?? "");
    return { ...employee, notes: notes.trim() ? notes : undefined };
  },

  category(employee, value, calendarDays) {
    const next = normalizeCategory(value) ?? employee.category;
    if (next === "Special") {
      return {
        ...employee,
        category: next,
        salaryPerDay: 0,
        bonusPerDay: 0,
        extraDays: 0,
        daysWorked: calendarDays,
        pfOptIn: false,
        esiOptIn: false,
      };
    }
    return { ...employee, category: next };
  },

  pfOptIn(employee, value) {
    if (isSpecialCategory(employee.category)) {
      return { ...employee, pfOptIn: false, esiOptIn: false, esiOverLimitOptIn: undefined };
    }
    return { ...employee, pfOptIn: booleanValue(value) };
  },

  esiOptIn(employee, value) {
    if (isSpecialCategory(employee.category)) {
      return { ...employee, pfOptIn: false, esiOptIn: false, esiOverLimitOptIn: undefined };
    }
    return { ...employee, esiOptIn: booleanValue(value) };
  },

  esiOverLimitOptIn(employee, value) {
    if (isSpecialCategory(employee.category)) {
      return { ...employee, pfOptIn: false, esiOptIn: false, esiOverLimitOptIn: undefined };
    }
    const on = booleanValue(value);
    return {
      ...employee,
      esiOverLimitOptIn: on ? true : undefined,
      esiOptIn: on,
    };
  },

  monthlySalary(employee, value, calendarDays) {
    return applyPackageEdit(employee, "monthlySalary", value, calendarDays);
  },

  totalSalary(employee, value, calendarDays) {
    return applyPackageEdit(employee, "totalSalary", value, calendarDays);
  },

  allowance(employee, value, calendarDays) {
    return applyPackageEdit(employee, "allowance", value, calendarDays);
  },

  salaryPerDay(employee, value, calendarDays) {
    if (employee.category === "Unskilled") {
      return { ...employee, salaryPerDay: Math.max(0, numberValue(value)) };
    }
    const salaryPerDay = Math.max(0, numberValue(value));
    const monthlySalary = monthlyFromDaily(salaryPerDay, calendarDays);
    const allowance = Math.max(
      0,
      Math.max(0, numberValue(employee.totalSalary)) -
        Math.max(0, numberValue(employee.monthlySalary)),
    );
    return {
      ...employee,
      salaryPerDay,
      monthlySalary,
      totalSalary: allowance > 0 ? roundMoney(monthlySalary + allowance) : undefined,
    };
  },

  basicPercent(employee, value) {
    return { ...employee, basicPercent: clampBasicPercent(value) };
  },

  advance(employee, value) {
    const val = value === undefined || value === "" ? undefined : Number(value);
    if (val !== undefined && (Number.isNaN(val) || val < 0)) {
      return { ...employee, advance: undefined };
    }
    return {
      ...employee,
      advance: val === 0 || val === undefined ? undefined : val,
    };
  },

  specialBonus(employee, value) {
    const val = value === undefined || value === "" ? undefined : Number(value);
    return { ...employee, specialBonus: val };
  },

  daysWorked(employee, value) {
    return { ...employee, daysWorked: numberValue(value) };
  },

  extraDays(employee, value) {
    return { ...employee, extraDays: numberValue(value) };
  },

  otherDeduction(employee, value) {
    return { ...employee, otherDeduction: numberValue(value) };
  },

  bonusPerDay(employee, value) {
    return { ...employee, bonusPerDay: numberValue(value) };
  },
};

/**
 * Apply a single field edit to an employee record.
 * Money-affecting rules live here (domain), not in the UI event handler.
 * Unknown fields throw — never silently coerce to 0.
 */
export function applyEmployeeEdit(
  employee: EmployeeInput,
  field: EditableField,
  value: EditValue,
  calendarDays: number,
): EmployeeInput {
  const handler = handlers[field];
  if (!handler) {
    throw new Error(`Unknown employee field: ${String(field)}`);
  }
  return handler(employee, value, calendarDays);
}
