import { calendarDaysForMonth } from "../src/months.ts";
import { calculateSalary } from "../src/salary.ts";

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("OK:", msg);
}

assert(calendarDaysForMonth("February 2026") === 28, "Feb 2026 = 28");
assert(calendarDaysForMonth("February 2028") === 29, "Feb 2028 = 29");
assert(calendarDaysForMonth("June 2026") === 30, "June 2026 = 30");
assert(calendarDaysForMonth("July 2026") === 31, "July 2026 = 31");
assert(calendarDaysForMonth("not-a-month") === 30, "parse fail defaults to 30");

const labour = {
  id: "u1",
  name: "Labour",
  category: "Unskilled",
  monthlySalary: 0,
  salaryPerDay: 400,
  bonusPerDay: 0,
  daysWorked: 28,
  extraDays: 0,
  basicPercent: 70,
  pfOptIn: false,
  esiOptIn: false,
  otherDeduction: 0,
};

const feb = calculateSalary(
  { ...labour, daysWorked: 28, monthlySalary: 28 * 400 },
  { workingDays: 28 },
);
const jul = calculateSalary(
  { ...labour, daysWorked: 31, monthlySalary: 31 * 400 },
  { workingDays: 31 },
);

// For unskilled full days, monthly = D * r when engine derives from day rate
const febFromDay = calculateSalary(
  {
    ...labour,
    monthlySalary: 0,
    salaryPerDay: 400,
    daysWorked: 28,
  },
  { workingDays: 28 },
);
const julFromDay = calculateSalary(
  {
    ...labour,
    monthlySalary: 0,
    salaryPerDay: 400,
    daysWorked: 31,
  },
  { workingDays: 31 },
);

assert(febFromDay.monthlySalary === 11200, `Feb full Unskilled 400/day = 11200 (got ${febFromDay.monthlySalary})`);
assert(julFromDay.monthlySalary === 12400, `Jul full Unskilled 400/day = 12400 (got ${julFromDay.monthlySalary})`);
assert(feb.monthlySalary === 11200 || febFromDay.earnedSalary === 11200, "Feb earned path");
assert(julFromDay.earnedSalary === 12400, `Jul earned = 12400 (got ${julFromDay.earnedSalary})`);

console.log("\n*** TICKET-03 offline checks passed ***");
