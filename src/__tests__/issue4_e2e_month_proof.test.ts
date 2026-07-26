import { describe, expect, it } from "vitest";
import { calculateEmployeeAttendanceStats } from "../attendance";
import { buildOfficialRow } from "../officialSheet";
import { calculateSalary, roundMoney } from "../salary";
import type { AttendanceEmployee, EmployeeInput } from "../types";

type DayDetail = AttendanceEmployee["daysDetail"][number];

function createMonthDetails(
  workingDayIndices: number[],
  unapprovedAbsenceIndices: number[] = [],
  monthLength = 30
): DayDetail[] {
  const days: DayDetail[] = [];
  for (let i = 0; i < monthLength; i++) {
    const dayOfWeek = (i + 1) % 7; // Index 6 is Sunday (0), Index 5 is Saturday (6), Index 0 is Monday (1)
    const isPresent = workingDayIndices.includes(i);
    const isUnapproved = unapprovedAbsenceIndices.includes(i);

    days.push({
      dateString: `2026/06/${String(i + 1).padStart(2, "0")}`,
      dayOfWeek,
      isPresent,
      duration: isPresent ? 8 : 0,
      punchTimes: isPresent ? ["08:30", "17:30"] : [],
      isShortStay: !isPresent,
      shift: "Day",
      leaveType: isUnapproved ? "unapproved" : undefined,
    });
  }
  return days;
}

describe("Issue #4: End-to-end month proof (attendance to equal nets)", () => {
  it("proves the full pipeline across all employee types and verifies 100% Net Equality between Reference and Official sheets", () => {
    // Roster of realistic test employees covering all edge cases
    const employees = [
      {
        id: "e2e-1",
        name: "Ramesh (Labour Day-rate)",
        category: "Unskilled",
        monthlySalary: 0,
        salaryPerDay: 400,
        bonusPerDay: 50,
        isSecurity: false,
        pfOptIn: true,
        esiOptIn: true,
        // Present on 28 days, 1 unapproved absence at day index 2
        workingDays: Array.from({ length: 30 }, (_, i) => i).filter((i) => i !== 2 && i !== 10),
        unapprovedAbsences: [2],
      },
      {
        id: "e2e-2",
        name: "Suresh (Semi-skilled Fixed Monthly)",
        category: "Semi-skilled",
        monthlySalary: 18000,
        salaryPerDay: 0,
        bonusPerDay: 100,
        isSecurity: false,
        pfOptIn: true,
        esiOptIn: true,
        // Present on 25 days, Sunday Package eligible
        workingDays: Array.from({ length: 25 }, (_, i) => i),
        unapprovedAbsences: [],
      },
      {
        id: "e2e-3",
        name: "Avijit (Skilled High Wage)",
        category: "Skilled",
        monthlySalary: 35000,
        salaryPerDay: 0,
        bonusPerDay: 0,
        isSecurity: false,
        pfOptIn: true,
        esiOptIn: true, // Gross > 21,000 so ESI auto disabled
        // Worked Sunday (index 6) but sandwich violated (absent Sat index 5 & Mon index 7)
        workingDays: Array.from({ length: 24 }, (_, i) => i).filter((i) => i !== 5 && i !== 7),
        unapprovedAbsences: [],
      },
      {
        id: "e2e-4",
        name: "Punit (Special Employee)",
        category: "Special",
        monthlySalary: 60000,
        salaryPerDay: 2000,
        bonusPerDay: 0,
        isSecurity: false,
        pfOptIn: true,
        esiOptIn: true,
        workingDays: [0, 1, 2], // Minimal punches, but special gets full month
        unapprovedAbsences: [],
      },
      {
        id: "e2e-5",
        name: "Monaj (Security Guard)",
        category: "Semi-skilled",
        monthlySalary: 15000,
        salaryPerDay: 500,
        bonusPerDay: 0,
        isSecurity: true, // Security role -> no Sunday Package
        pfOptIn: true,
        esiOptIn: true,
        workingDays: Array.from({ length: 28 }, (_, i) => i), // Includes Sundays
        unapprovedAbsences: [],
      },
      {
        id: "e2e-6",
        name: "Explicit PF Opt-Out Worker",
        category: "Semi-skilled",
        monthlySalary: 14000,
        salaryPerDay: 0,
        bonusPerDay: 0,
        isSecurity: false,
        pfOptIn: false, // Explicitly opted out of PF
        esiOptIn: true,
        workingDays: Array.from({ length: 26 }, (_, i) => i),
        unapprovedAbsences: [],
      },
    ];

    const monthDays = 30;

    employees.forEach((emp) => {
      // 1. Attendance audit & calculation
      const daysDetail = createMonthDetails(emp.workingDays, emp.unapprovedAbsences, monthDays);
      const attStats = calculateEmployeeAttendanceStats(daysDetail, emp.isSecurity);

      // 2. Prepare EmployeeInput for salary calculation
      const input: EmployeeInput = {
        id: emp.id,
        name: emp.name,
        category: emp.category as EmployeeInput["category"],
        monthlySalary: emp.monthlySalary,
        salaryPerDay: emp.salaryPerDay,
        bonusPerDay: emp.bonusPerDay,
        daysWorked: attStats.presentDays,
        extraDays: attStats.sundaysEligible,
        pfOptIn: emp.pfOptIn,
        esiOptIn: emp.esiOptIn,
        otherDeduction: 0,
      };

      // 3. Compute Reference Sheet row
      const refRow = calculateSalary(input, { workingDays: monthDays });

      // 4. Compute Official Sheet row
      const offRow = buildOfficialRow(refRow, monthDays);

      // 5. Verification Assertions
      if (emp.category === "Special") {
        expect(refRow.daysWorked).toBe(monthDays);
        expect(refRow.pfOptIn).toBe(false);
        expect(refRow.esiOptIn).toBe(false);
        expect(refRow.employeePf).toBe(0);
        expect(refRow.esi).toBe(0);
        expect(refRow.salaryPerDay).toBe(0);
      }

      if (emp.isSecurity) {
        expect(attStats.sundaysEligible).toBe(0);
      }

      // Independent recomputation — catches the historical tautology where
      // Official net was assigned from Reference net (TICKET-09 / TICKET-14).
      const recomputed = roundMoney(
        offRow.grossPayable -
          offRow.pf -
          offRow.esi -
          offRow.professionalTax -
          (offRow.advance || 0) -
          offRow.otherDeduction,
      );
      expect(recomputed).toBeCloseTo(offRow.netPayable, 2); // internal consistency
      if (!offRow.unpackable) {
        expect(offRow.netPayable).toBeCloseTo(refRow.netPayable, 2); // net equality
      }
    });
  });
});
