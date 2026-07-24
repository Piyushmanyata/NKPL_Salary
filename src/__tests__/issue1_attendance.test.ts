import { describe, expect, it } from "vitest";
import { calculateEmployeeAttendanceStats } from "../attendance";
import type { AttendanceEmployee } from "../types";

type DayDetail = AttendanceEmployee["daysDetail"][number];

function createMonthDays(
  daysCount: number,
  presentIndices: number[] = [],
  unapprovedAbsenceIndices: number[] = [],
  overrides: Record<number, Partial<DayDetail>> = {}
): DayDetail[] {
  const days: DayDetail[] = [];
  // Assume day 0 is Monday or any starting day. Let's make day 0 a Monday (dayOfWeek = 1).
  // So index 6 is Sunday (dayOfWeek = 0), index 13 is Sunday, etc.
  for (let i = 0; i < daysCount; i++) {
    const dayOfWeek = (i + 1) % 7; // index 5 is Saturday (6), index 6 is Sunday (0), index 0 is Monday (1)
    const isPresent = presentIndices.includes(i);
    const isUnapproved = unapprovedAbsenceIndices.includes(i);
    const dateString = `2026/06/${String(i + 1).padStart(2, "0")}`;

    days.push({
      dateString,
      dayOfWeek,
      isPresent,
      duration: isPresent ? 8 : 0,
      punchTimes: isPresent ? ["08:30", "17:30"] : [],
      isShortStay: !isPresent,
      shift: "Day",
      leaveType: isUnapproved ? "unapproved" : undefined,
      ...overrides[i],
    });
  }
  return days;
}

describe("Issue #1: Attendance & Sunday Package", () => {
  it("treats single punch alone as absent unless manual present override exists", () => {
    // Single punch has 0 duration in analyzePunches, so isPresent=false
    const dayWithoutOverride: DayDetail = {
      dateString: "2026/06/01",
      dayOfWeek: 1,
      isPresent: false,
      duration: 0,
      punchTimes: ["08:30"],
      isShortStay: true,
    };
    const dayWithOverride: DayDetail = {
      dateString: "2026/06/02",
      dayOfWeek: 2,
      isPresent: false,
      duration: 0,
      punchTimes: ["08:30"],
      isShortStay: true,
      manualOverride: "present",
    };

    const stats = calculateEmployeeAttendanceStats([dayWithoutOverride, dayWithOverride], false);
    // Only dayWithOverride should count as present
    expect(stats.presentDays).toBe(1);
  });

  it("applies 2x pay hit for unapproved absence (unpaid day + 1 present day removed)", () => {
    // 30 day month. 25 days present, 1 unapproved absence, 4 normal absences
    const presentIndices = Array.from({ length: 25 }, (_, i) => i);
    const days = createMonthDays(30, presentIndices, [25]);

    const stats = calculateEmployeeAttendanceStats(days, false);
    // Raw present = 25. 1 unapproved absence subtracts 1 present day (on top of the 4 absent days being unpaid).
    // Effective present = 25 - 1 = 24.
    expect(stats.presentDays).toBe(24);
    expect(stats.meetsMonthThreshold).toBe(true);
  });

  it("calculates month threshold correctly for 31, 30, and other month lengths", () => {
    // 31-day month threshold is 21
    const days31 = createMonthDays(31, Array.from({ length: 21 }, (_, i) => i));
    expect(calculateEmployeeAttendanceStats(days31, false).meetsMonthThreshold).toBe(true);

    const days31Under = createMonthDays(31, Array.from({ length: 20 }, (_, i) => i));
    expect(calculateEmployeeAttendanceStats(days31Under, false).meetsMonthThreshold).toBe(false);

    // 30-day month threshold is 20
    const days30 = createMonthDays(30, Array.from({ length: 20 }, (_, i) => i));
    expect(calculateEmployeeAttendanceStats(days30, false).meetsMonthThreshold).toBe(true);

    const days30Under = createMonthDays(30, Array.from({ length: 19 }, (_, i) => i));
    expect(calculateEmployeeAttendanceStats(days30Under, false).meetsMonthThreshold).toBe(false);
  });

  it("applies sandwich rule: denies Sunday benefits when absent on BOTH preceding Saturday and following Monday", () => {
    // Month length 30. Threshold 20.
    // Let's set up a Sunday at index 6. Saturday is index 5, Monday is index 7.
    // Present on 22 days total.
    const presentIndices = Array.from({ length: 22 }, (_, i) => i).filter(
      (idx) => idx !== 5 && idx !== 6 && idx !== 7 // Absent on Sat (5), Sun (6), Mon (7)
    );

    const days = createMonthDays(30, presentIndices);
    const stats = calculateEmployeeAttendanceStats(days, false);

    const sunDetail = stats.sundayDetails.find((s) => s.date === "2026/06/07");
    expect(sunDetail?.isEligible).toBe(false);
  });

  it("grants Sunday benefits if present on Saturday OR Monday (sandwich not violated)", () => {
    // Present on Sat (5), absent on Sun (6), absent on Mon (7)
    const presentIndices = [0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
    const days = createMonthDays(30, presentIndices);
    const stats = calculateEmployeeAttendanceStats(days, false);

    const sunDetail = stats.sundayDetails.find((s) => s.date === "2026/06/07");
    expect(sunDetail?.isEligible).toBe(true);
  });

  it("handles worked Sunday: auto-paid + Extra Day when eligible, normal present day (no Extra Day) when sandwich violated or threshold not met", () => {
    // 1) Worked Sunday and eligible -> counts as Present Day AND grants 1 Extra Day per worked Sunday
    const presentIndices1 = Array.from({ length: 22 }, (_, i) => i); // Includes 3 Sundays (6, 13, 20)
    const days1 = createMonthDays(30, presentIndices1);
    const stats1 = calculateEmployeeAttendanceStats(days1, false);

    expect(stats1.sundaysWorked).toBe(3);
    expect(stats1.sundaysEligible).toBe(3);

    // 2) Worked Sunday (index 6) but sandwich violated (absent Sat index 5 & Mon index 7)
    // Only 1 Sunday worked (index 6) by excluding indices 13 and 20 from present list
    const presentIndices2 = Array.from({ length: 22 }, (_, i) => i).filter(
      (idx) => idx !== 5 && idx !== 7 && idx !== 13 && idx !== 20
    );
    const days2 = createMonthDays(30, presentIndices2);
    const stats2 = calculateEmployeeAttendanceStats(days2, false);

    const sunDetail = stats2.sundayDetails.find((s) => s.date === "2026/06/07");
    expect(sunDetail?.isEligible).toBe(false); // Double pay denied due to sandwich
    expect(stats2.sundaysEligible).toBe(0); // 0 Extra Days
  });

  it("treats Security Employee: no Sunday package (no auto-paid Sunday, no Extra Days), worked Sunday is normal present day only", () => {
    const presentIndices = Array.from({ length: 25 }, (_, i) => i); // Includes Sundays
    const days = createMonthDays(30, presentIndices);
    const stats = calculateEmployeeAttendanceStats(days, true); // Security = true

    expect(stats.sundaysEligible).toBe(0);
    const sunDetails = stats.sundayDetails;
    sunDetails.forEach((sun) => {
      expect(sun.isEligible).toBe(false);
      expect(sun.reasons[0]).toContain("Security");
    });
  });
});
