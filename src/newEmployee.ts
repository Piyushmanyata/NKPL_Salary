import { applyEmployeeEdit, type EditableField, type EditValue } from "./editEmployee";
import { blankEmployee } from "./roster";
import { calculateSalary, clampDays, ESI_GROSS_LIMIT, isSpecialCategory, numberValue } from "./salary";
import type { Category, EmployeeInput } from "./types";

type SalaryMode = "perDay" | "perMonth";

type EsiChoice = { on: boolean; overLimit: boolean };

export type NewEmployeeForm = {
  name: string;
  category: Category;
  salary: number;
  extra: number;
  daysWorked: number;
  extraDays: number;
  pfOptIn: boolean;
  esiChoice: EsiChoice | null;
  advance?: number;
  notes: string;
};

type NewEmployeeErrors = Partial<Record<"name" | "salary" | "daysWorked" | "duplicate", string>>;

export const salaryModeFor = (category: Category): SalaryMode =>
  category === "Unskilled" ? "perDay" : "perMonth";

export const emptyNewEmployeeForm = (monthDays: number): NewEmployeeForm => ({
  name: "",
  category: "Unskilled",
  salary: 0,
  extra: 0,
  daysWorked: monthDays,
  extraDays: 0,
  pfOptIn: true,
  esiChoice: null,
  notes: "",
});

const replay = (edits: [EditableField, EditValue][], employee: EmployeeInput, monthDays: number) =>
  edits.reduce((current, [field, value]) => applyEmployeeEdit(current, field, value, monthDays), employee);

function employeeBeforeEsi(form: NewEmployeeForm, monthDays: number): EmployeeInput {
  const special = isSpecialCategory(form.category);
  const salaryEdits: [EditableField, EditValue][] =
    salaryModeFor(form.category) === "perDay"
      ? [
          ["salaryPerDay", form.salary],
          ["bonusPerDay", form.extra],
        ]
      : [
          ["monthlySalary", form.salary],
          ["allowance", special ? 0 : form.extra],
        ];
  return replay(
    [
      ["category", form.category],
      ["name", form.name.trim()],
      ...salaryEdits,
      ...(special
        ? []
        : ([
            ["daysWorked", clampDays(numberValue(form.daysWorked), monthDays)],
            ["extraDays", Math.max(0, numberValue(form.extraDays))],
            ["pfOptIn", form.pfOptIn],
          ] as [EditableField, EditValue][])),
      ["advance", form.advance],
      ["notes", form.notes],
    ],
    blankEmployee(monthDays),
    monthDays,
  );
}

const aboveEsiLimit = (employee: EmployeeInput, monthDays: number) =>
  calculateSalary(employee, { workingDays: monthDays }).totalSalary > ESI_GROSS_LIMIT;

export const esiDefaultOn = (form: NewEmployeeForm, monthDays: number): boolean =>
  !aboveEsiLimit(employeeBeforeEsi(form, monthDays), monthDays);

const esiOnFor = (choice: EsiChoice | null, over: boolean) => (choice?.overLimit === over ? choice.on : !over);

export const esiChecked = (form: NewEmployeeForm, monthDays: number): boolean =>
  esiOnFor(form.esiChoice, !esiDefaultOn(form, monthDays));

export const withEsiChoice = (form: NewEmployeeForm, on: boolean, monthDays: number): NewEmployeeForm => ({
  ...form,
  esiChoice: { on, overLimit: !esiDefaultOn(form, monthDays) },
});

export function employeeFromForm(form: NewEmployeeForm, monthDays: number): EmployeeInput {
  const employee = employeeBeforeEsi(form, monthDays);
  if (isSpecialCategory(form.category)) return employee;
  const over = aboveEsiLimit(employee, monthDays);
  return replay([[over ? "esiOverLimitOptIn" : "esiOptIn", esiOnFor(form.esiChoice, over)]], employee, monthDays);
}

const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

export function newEmployeeErrors(
  form: NewEmployeeForm,
  monthDays: number,
  existingNames: string[],
): NewEmployeeErrors {
  const errors: NewEmployeeErrors = {};
  const key = nameKey(form.name);
  if (!key) errors.name = "Type the employee's name.";
  if (!(numberValue(form.salary) > 0)) {
    errors.salary =
      salaryModeFor(form.category) === "perDay" ? "Type the salary per day." : "Type the salary per month.";
  }
  if (!isSpecialCategory(form.category) && numberValue(form.daysWorked) > monthDays) {
    errors.daysWorked = `This month has only ${monthDays} days. Put the rest in Extra days.`;
  }
  if (key && existingNames.some((name) => nameKey(name) === key)) {
    errors.duplicate = `${form.name.trim()} is already on this month's sheet.`;
  }
  return errors;
}
