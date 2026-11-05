import { describe, expect, it } from "vitest";
import { compareMonths, newWarnings, previousMonthLabel, splitResolved, type Flag, type MonthSide, type ResolvedFlag } from "../flags";
import type { EmployeeInput } from "../types";

const worker = (id: string, name: string, extra: Partial<EmployeeInput> = {}): EmployeeInput => ({
  id,
  name,
  category: "Unskilled",
  monthlySalary: 0,
  salaryPerDay: 400,
  bonusPerDay: 0,
  daysWorked: 30,
  extraDays: 0,
  basicPercent: 70,
  pfOptIn: false,
  esiOptIn: false,
  otherDeduction: 0,
  ...extra,
});

const staff = (id: string, name: string, extra: Partial<EmployeeInput> = {}): EmployeeInput =>
  worker(id, name, { category: "Skilled", monthlySalary: 20000, salaryPerDay: 0, ...extra });

const sep = (employees: EmployeeInput[]): MonthSide => ({ label: "September 2026", days: 30, employees });
const oct = (employees: EmployeeInput[]): MonthSide => ({ label: "October 2026", days: 31, employees });

const keys = (side: MonthSide, previous: MonthSide | null) =>
  compareMonths(side, previous).flags.map((flag) => `${flag.level} ${flag.key.split("|")[1].replace(/:\d+$/, "")}`);

describe("previousMonthLabel", () => {
  it("steps back one month, across a year end", () => {
    expect(previousMonthLabel("October 2026")).toBe("September 2026");
    expect(previousMonthLabel("January 2027")).toBe("December 2026");
    expect(previousMonthLabel("nonsense")).toBeNull();
  });
});

describe("compareMonths", () => {
  const steady = [worker("a", "Laltu Malik", { daysWorked: 29 }), staff("b", "Surya Patra", { daysWorked: 28 })];

  it("raises nothing when a month looks like the last one", () => {
    expect(keys(oct(steady), sep(steady))).toEqual([]);
  });

  it("flags a blank name even though the sheet leaves that row out", () => {
    const report = compareMonths(oct([...steady, worker("g", "", { monthlySalary: 6500, salaryPerDay: 209.68 })]), sep(steady));
    const blank = report.flags.find((flag) => flag.key === "fix|blank-name:g");
    expect(blank?.level).toBe("fix");
    expect(blank?.blankName).toBe(true);
    expect(blank?.detail).toContain("nobody is paid");
  });

  it("flags the default New Employee name and duplicate names", () => {
    expect(keys(oct([...steady, worker("n", "New Employee"), worker("d", " laltu  malik ")]), sep(steady))).toEqual(
      expect.arrayContaining(["fix blank-name:n", "fix duplicate:LALTU MALIK"]),
    );
  });

  it("flags more days than the month has, a missing rate and a zero net", () => {
    const now = [
      worker("a", "Laltu Malik", { daysWorked: 33 }),
      worker("b", "Surya Patra", { salaryPerDay: 0 }),
      worker("c", "Rajesh", { advance: 20000 }),
    ];
    expect(keys(oct(now), null)).toEqual(
      expect.arrayContaining(["fix days-over:a", "fix no-rate:b", "check net-zero:c"]),
    );
  });

  it("flags a big net drop and says what changed", () => {
    const report = compareMonths(oct([worker("a", "Laltu Malik", { daysWorked: 12 }), steady[1]]), sep(steady));
    const flag = report.flags.find((entry) => entry.key === "check|net:a");
    expect(flag?.level).toBe("check");
    expect(flag?.detail).toContain("Days 29 → 12");
    expect(report.rows[0].name).toBe("Laltu Malik");
    expect(report.rows[0].flagged).toBe(true);
  });

  it("ignores small net moves from one more calendar day", () => {
    expect(keys(oct(steady), sep(steady)).filter((key) => key.includes("net:"))).toEqual([]);
  });

  it("treats a rate cut as must-fix, an unlogged rise as check and a logged rise as note", () => {
    const cut = [worker("a", "Laltu Malik", { daysWorked: 29, salaryPerDay: 380 }), steady[1]];
    expect(keys(oct(cut), sep(steady))).toContain("fix rate:a");
    const rise = [steady[0], staff("b", "Surya Patra", { daysWorked: 28, monthlySalary: 21000 })];
    expect(keys(oct(rise), sep(steady))).toContain("check rate:b");
    const logged = [steady[0], staff("b", "Surya Patra", { daysWorked: 28, monthlySalary: 21000, increments: [{ month: "October 2026", amount: 1000 }] })];
    expect(keys(oct(logged), sep(steady))).toContain("note rate:b");
  });

  it("lists new and missing people", () => {
    const now = [steady[0], worker("c", "Gokul Roy")];
    expect(keys(oct(now), sep(steady))).toEqual(expect.arrayContaining(["note new:c", "check gone:b"]));
  });

  it("matches a person by name when the row id changed", () => {
    const now = [steady[0], staff("b2", "SURYA PATRA", { daysWorked: 28 })];
    expect(keys(oct(now), sep(steady))).toEqual([]);
  });

  it("flags advance, other cut and special bonus changes", () => {
    const before = [worker("a", "S K Sajamal", { advance: 2500 }), steady[1]];
    const now = [worker("a", "S K Sajamal", { specialBonus: 500, otherDeduction: 100 }), steady[1]];
    expect(keys(oct(now), sep(before))).toEqual(
      expect.arrayContaining(["check advance:a", "check otherDeduction:a", "check specialBonus:a"]),
    );
  });

  it("flags Extra Days given while days were missed, but not for a full month", () => {
    const now = [worker("a", "Laltu Malik", { daysWorked: 25, extraDays: 1 }), worker("b", "Rajesh", { daysWorked: 31, extraDays: 2 })];
    const found = keys(oct(now), null);
    expect(found).toContain("check extra-with-absence:a");
    expect(found).not.toContain("check extra-with-absence:b");
  });

  it("flags a month where every day count is still the carried-forward full month", () => {
    const full = ["a", "b", "c"].map((id) => worker(id, `Worker ${id}`, { daysWorked: 31 }));
    expect(keys(oct(full), null)).toContain("check month:all-full-days");
  });
});

describe("newWarnings", () => {
  it("returns only non-note flags that were not accepted", () => {
    const { flags } = compareMonths(oct([worker("a", "Laltu", { daysWorked: 40 }), worker("c", "Gokul")]), sep([worker("a", "Laltu")]));
    expect(newWarnings(flags, null)).toEqual([]);
    expect(newWarnings(flags, new Set()).map((flag) => flag.key)).toEqual(["fix|days-over:a"]);
    expect(newWarnings(flags, new Set(["fix|days-over:a"]))).toEqual([]);
  });

  it("holds again when an accepted flag gets worse or a cut gets a new amount", () => {
    const before = sep([worker("a", "Laltu", { daysWorked: 29 }), worker("b", "Rajesh", { advance: 1000 })]);
    const loaded = compareMonths(oct([worker("a", "Laltu", { daysWorked: 29, salaryPerDay: 450 }), worker("b", "Rajesh", { advance: 2000 })]), before);
    const accepted = new Set(loaded.flags.map((flag) => flag.key));
    const edited = compareMonths(oct([worker("a", "Laltu", { daysWorked: 29, salaryPerDay: 350 }), worker("b", "Rajesh", { advance: 20000 })]), before);
    expect(newWarnings(edited.flags, accepted).map((flag) => flag.key)).toEqual(
      expect.arrayContaining(["fix|rate:a", "check|advance:b:20000"]),
    );
  });
});

describe("splitResolved", () => {
  const resolvedFrom = (flag: Flag, resolvedAt = "2026-11-05T07:00:00.000Z"): ResolvedFlag => ({
    key: flag.key,
    level: flag.level,
    name: flag.name,
    title: flag.title,
    detail: flag.detail,
    resolvedAt,
  });

  it("hides a resolved flag from Open while its detail is unchanged, and stops it holding a save", () => {
    const { flags } = compareMonths(oct([worker("a", "Laltu", { daysWorked: 40 }), worker("c", "Gokul")]), sep([worker("a", "Laltu")]));
    const daysOver = flags.find((flag) => flag.key === "fix|days-over:a")!;
    const split = splitResolved(flags, [resolvedFrom(daysOver)]);
    expect(split.open.map((flag) => flag.key)).not.toContain("fix|days-over:a");
    expect(split.resolved).toEqual([{ record: resolvedFrom(daysOver), now: "same" }]);
    expect(newWarnings(split.open, new Set())).toEqual([]);
  });

  it("opens the flag again when its numbers change, and keeps the old note", () => {
    const before = sep([worker("a", "Laltu")]);
    const first = compareMonths(oct([worker("a", "Laltu", { daysWorked: 40 })]), before).flags.find((flag) => flag.key === "fix|days-over:a")!;
    const later = compareMonths(oct([worker("a", "Laltu", { daysWorked: 45 })]), before).flags;
    const split = splitResolved(later, [resolvedFrom(first)]);
    expect(split.open.map((flag) => flag.key)).toContain("fix|days-over:a");
    expect(split.changedSince.get("fix|days-over:a")?.detail).toBe(first.detail);
    expect(split.resolved[0].now).toBe("changed");
    expect(newWarnings(split.open, new Set()).map((flag) => flag.key)).toContain("fix|days-over:a");
  });

  it("keeps a resolved flag in the list after the flag itself is gone", () => {
    const before = sep([worker("a", "Laltu")]);
    const first = compareMonths(oct([worker("a", "Laltu", { daysWorked: 40 })]), before).flags.find((flag) => flag.key === "fix|days-over:a")!;
    const fixed = compareMonths(oct([worker("a", "Laltu", { daysWorked: 30 })]), before).flags;
    const split = splitResolved(fixed, [resolvedFrom(first)]);
    expect(split.open).toEqual(fixed);
    expect(split.resolved).toEqual([{ record: resolvedFrom(first), now: "gone" }]);
  });
});
