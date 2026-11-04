import { alignReferenceEsi, calculateSalary, clampBasicPercent } from "./salary";
import { buildOfficialRow } from "./officialSheet";
import type { EmployeeInput } from "./types";

export function buildMonthSheets(employees: EmployeeInput[], monthDays: number, monthLabel: string) {
  const calculated = employees
    .filter((employee) => employee.name.trim())
    .map((employee) =>
      calculateSalary(employee, {
        basicShare: clampBasicPercent(employee.basicPercent) / 100,
        workingDays: monthDays,
        monthLabel,
      }),
    );
  const officialRows = calculated.map((row) => buildOfficialRow(row, monthDays));
  const salaryRows = calculated.map((row, index) => {
    const official = officialRows[index];
    return official ? alignReferenceEsi(row, official.esi, official.employerEsi) : row;
  });
  return { salaryRows, officialRows };
}
