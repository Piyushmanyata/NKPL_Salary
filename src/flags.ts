import { incrementsForMonth } from "./increments";
import { MONTH_NAMES, monthKey } from "./months";
import { buildMonthSheets } from "./monthSheets";
import { currency, isSpecialCategory, numberValue } from "./salary";
import type { EmployeeInput, SalaryRow } from "./types";

export type FlagLevel = "fix" | "check" | "note";

export type Flag = {
  key: string;
  level: FlagLevel;
  id?: string;
  name: string;
  title: string;
  detail: string;
  blankName?: boolean;
};

export type MonthSide = { label: string; days: number; employees: EmployeeInput[] };

type PersonSnapshot = { days: number; extra: number; rate: string; net: number };

export type CompareRow = {
  key: string;
  name: string;
  before?: PersonSnapshot;
  after?: PersonSnapshot;
  change: number;
  flagged: boolean;
};

export type FlagReport = {
  flags: Flag[];
  rows: CompareRow[];
  netBefore?: number;
  netAfter: number;
  peopleBefore?: number;
  peopleAfter: number;
};

const NET_CHANGE_SHARE = 0.15;
const NET_CHANGE_MIN = 1000;

const PLACEHOLDER_NAMES = new Set(["", "NEW EMPLOYEE"]);

const LEVEL_ORDER: Record<FlagLevel, number> = { fix: 0, check: 1, note: 2 };

export function previousMonthLabel(label: string): string | null {
  const index = monthKey(label) - 1;
  return Number.isFinite(index) ? `${MONTH_NAMES[index % 12]} ${Math.floor(index / 12)}` : null;
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toUpperCase();
}

function rateOf(employee: EmployeeInput): { value: number; text: string } {
  if (employee.category === "Unskilled") {
    const value = Math.round((numberValue(employee.salaryPerDay) + numberValue(employee.bonusPerDay)) * 100) / 100;
    return { value, text: `${currency(value)}/day` };
  }
  const value = Math.max(numberValue(employee.monthlySalary), numberValue(employee.totalSalary));
  return { value, text: `${currency(value)}/month` };
}

function rateChanged(before: EmployeeInput, after: EmployeeInput): boolean {
  if (before.category !== after.category) return true;
  const tolerance = after.category === "Unskilled" ? 0.5 : 1;
  return Math.abs(rateOf(before).value - rateOf(after).value) > tolerance;
}

function money(value: number | null | undefined): string {
  return numberValue(value) > 0 ? currency(numberValue(value)) : "none";
}

function percent(before: number, after: number): string {
  if (before <= 0) return "";
  const share = Math.round(((after - before) / before) * 100);
  return ` (${share > 0 ? "+" : ""}${share}%)`;
}

function sheetRows(side: MonthSide): Map<string, SalaryRow> {
  const { salaryRows } = buildMonthSheets(side.employees, side.days, side.label);
  return new Map(salaryRows.map((row) => [row.id, row]));
}

function snapshot(employee: EmployeeInput, row: SalaryRow | undefined): PersonSnapshot {
  return {
    days: numberValue(row?.daysWorked ?? employee.daysWorked),
    extra: numberValue(row?.extraDays ?? employee.extraDays),
    rate: rateOf(employee).text,
    net: Math.round(numberValue(row?.netPayable)),
  };
}

function matchPrevious(current: EmployeeInput[], previous: EmployeeInput[]): Map<string, EmployeeInput> {
  const byId = new Map(previous.map((employee) => [employee.id, employee]));
  const matched = new Map<string, EmployeeInput>();
  const used = new Set<string>();
  for (const employee of current) {
    const old = byId.get(employee.id);
    if (old) {
      matched.set(employee.id, old);
      used.add(old.id);
    }
  }
  const unusedByName = new Map<string, EmployeeInput>();
  for (const old of previous) {
    const name = normalizeName(old.name);
    if (!used.has(old.id) && !PLACEHOLDER_NAMES.has(name) && !unusedByName.has(name)) unusedByName.set(name, old);
  }
  for (const employee of current) {
    if (matched.has(employee.id)) continue;
    const old = unusedByName.get(normalizeName(employee.name));
    if (old) {
      matched.set(employee.id, old);
      unusedByName.delete(normalizeName(employee.name));
    }
  }
  return matched;
}

function whatChanged(before: PersonSnapshot, after: PersonSnapshot, old: EmployeeInput, now: EmployeeInput): string {
  const parts: string[] = [];
  if (before.days !== after.days) parts.push(`Days ${before.days} → ${after.days}`);
  if (before.extra !== after.extra) parts.push(`Extra ${before.extra} → ${after.extra}`);
  if (before.rate !== after.rate) parts.push(`Rate ${before.rate} → ${after.rate}`);
  if (numberValue(old.advance) !== numberValue(now.advance)) parts.push(`Advance cut ${money(old.advance)} → ${money(now.advance)}`);
  if (numberValue(old.otherDeduction) !== numberValue(now.otherDeduction)) {
    parts.push(`Other cut ${money(old.otherDeduction)} → ${money(now.otherDeduction)}`);
  }
  if (numberValue(old.specialBonus) !== numberValue(now.specialBonus)) {
    parts.push(`Special bonus ${money(old.specialBonus)} → ${money(now.specialBonus)}`);
  }
  return parts.join(", ");
}

function displayName(employee: EmployeeInput): string {
  return employee.name.trim() || "(no name)";
}

export function compareMonths(current: MonthSide, previous: MonthSide | null): FlagReport {
  const flags: Flag[] = [];
  const nowRows = sheetRows(current);
  const add = (flag: Flag) => flags.push({ ...flag, key: `${flag.level}|${flag.key}` });

  const nameCounts = new Map<string, number>();
  for (const employee of current.employees) {
    const name = normalizeName(employee.name);
    if (!PLACEHOLDER_NAMES.has(name)) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }
  for (const [name, count] of nameCounts) {
    if (count > 1) {
      add({
        key: `duplicate:${name}`,
        level: "fix",
        name,
        title: "Same name twice",
        detail: `${count} rows have this name. Remove the extra row or tell them apart.`,
      });
    }
  }

  for (const employee of current.employees) {
    const name = displayName(employee);
    const row = nowRows.get(employee.id);
    const special = isSpecialCategory(employee.category);
    if (PLACEHOLDER_NAMES.has(normalizeName(employee.name))) {
      add({
        key: `blank-name:${employee.id}`,
        level: "fix",
        id: employee.id,
        name,
        title: employee.name.trim() ? "Name not typed" : "Blank name",
        detail: employee.name.trim()
          ? "This row still has the default name. Type the person's name."
          : `This row has no name, so it is left off the sheet and nobody is paid for it (rate ${rateOf(employee).text}, ${numberValue(employee.daysWorked)} days).`,
        blankName: !employee.name.trim(),
      });
    }
    if (!row) continue;
    if (row.missingRate) {
      add({ key: `no-rate:${employee.id}`, level: "fix", id: employee.id, name, title: "No salary rate", detail: "Salary is 0, so net pay is 0. Type the rate." });
      continue;
    }
    if (!special && numberValue(employee.daysWorked) > current.days) {
      add({
        key: `days-over:${employee.id}`,
        level: "fix",
        id: employee.id,
        name,
        title: "More days than the month has",
        detail: `Days ${numberValue(employee.daysWorked)}, but ${current.label} has ${current.days}. The sheet pays only ${current.days}; put the rest in Extra Days.`,
      });
    }
    if (row.netPayable <= 0 && row.daysWorked > 0) {
      add({ key: `net-zero:${employee.id}`, level: "check", id: employee.id, name, title: "Net pay is zero or less", detail: `Net ${currency(row.netPayable)}: the cuts are bigger than the pay.` });
    }
    if (!special && row.daysWorked < current.days && row.extraDays > 0) {
      add({
        key: `extra-with-absence:${employee.id}`,
        level: "check",
        id: employee.id,
        name,
        title: "Extra Days while days were missed",
        detail: `Extra ${row.extraDays} with ${current.days - row.daysWorked} day(s) missed. Under the rules only double shifts give Extra Days then.`,
      });
    }
  }

  const named = current.employees.filter((employee) => normalizeName(employee.name) && !isSpecialCategory(employee.category));
  if (named.length >= 3 && named.every((employee) => numberValue(employee.daysWorked) >= current.days && !numberValue(employee.extraDays))) {
    add({
      key: "month:all-full-days",
      level: "check",
      name: "Whole month",
      title: "Everyone has full days",
      detail: `All ${named.length} people show ${current.days} days and 0 Extra Days. Were the register days typed in?`,
    });
  }

  const rows: CompareRow[] = [];
  const netAfter = Math.round([...nowRows.values()].reduce((sum, row) => sum + row.netPayable, 0));
  if (!previous) {
    for (const employee of current.employees) {
      const row = nowRows.get(employee.id);
      if (row) rows.push({ key: employee.id, name: displayName(employee), after: snapshot(employee, row), change: 0, flagged: false });
    }
    return finish(flags, rows, { netAfter, peopleAfter: nowRows.size });
  }

  const oldRows = sheetRows(previous);
  const matches = matchPrevious(current.employees, previous.employees);
  const matchedOldIds = new Set([...matches.values()].map((employee) => employee.id));

  for (const employee of current.employees) {
    const row = nowRows.get(employee.id);
    if (!row) continue;
    const name = displayName(employee);
    const after = snapshot(employee, row);
    const old = matches.get(employee.id);
    const oldRow = old ? oldRows.get(old.id) : undefined;
    if (!old || !oldRow) {
      add({ key: `new:${employee.id}`, level: "note", id: employee.id, name, title: "New this month", detail: `Not on the ${previous.label} sheet. Rate ${after.rate}, net ${currency(after.net)}.` });
      rows.push({ key: employee.id, name, after, change: after.net, flagged: false });
      continue;
    }
    const before = snapshot(old, oldRow);
    rows.push({ key: employee.id, name, before, after, change: after.net - before.net, flagged: false });

    if (rateChanged(old, employee)) {
      const raise = incrementsForMonth(employee.increments, current.label);
      const down = rateOf(employee).value < rateOf(old).value && old.category === employee.category;
      add({
        key: `rate:${employee.id}`,
        level: down ? "fix" : raise.total > 0 ? "note" : "check",
        id: employee.id,
        name,
        title: down ? "Rate went down" : raise.total > 0 ? "Raise logged" : "Rate changed, no raise logged",
        detail: `${before.rate} → ${after.rate}${old.category !== employee.category ? ` (${old.category} → ${employee.category})` : ""}${raise.total > 0 ? `. Raise of ${currency(raise.total)} logged for ${current.label}.` : "."}`,
      });
    }

    const change = after.net - before.net;
    const share = before.net > 0 ? Math.abs(change) / before.net : 1;
    if (Math.abs(change) >= NET_CHANGE_MIN && share >= NET_CHANGE_SHARE) {
      const why = whatChanged(before, after, old, employee);
      add({
        key: `net:${employee.id}`,
        level: "check",
        id: employee.id,
        name,
        title: change > 0 ? "Net went up a lot" : "Net went down a lot",
        detail: `Net ${currency(before.net)} → ${currency(after.net)}${percent(before.net, after.net)}.${why ? ` ${why}.` : ""}`,
      });
    }

    for (const [field, label] of [
      ["advance", "Advance cut"],
      ["otherDeduction", "Other cut"],
      ["specialBonus", "Special bonus"],
    ] as const) {
      const was = numberValue(old[field]);
      const now = numberValue(employee[field]);
      if (was === now) continue;
      add({
        key: `${field}:${employee.id}:${now}`,
        level: "check",
        id: employee.id,
        name,
        title: `${label} changed`,
        detail: `${label} ${money(was)} in ${previous.label} → ${money(now)} now.${field === "specialBonus" && now > 0 ? " This is extra pay: check it was approved." : ""}`,
      });
    }
  }

  for (const old of previous.employees) {
    const oldRow = oldRows.get(old.id);
    if (!oldRow || matchedOldIds.has(old.id)) continue;
    const before = snapshot(old, oldRow);
    add({
      key: `gone:${old.id}`,
      level: "check",
      id: old.id,
      name: displayName(old),
      title: "Missing this month",
      detail: `On the ${previous.label} sheet (net ${currency(before.net)}), not on this one. Left, or removed by mistake?`,
    });
    rows.push({ key: `gone:${old.id}`, name: displayName(old), before, change: -before.net, flagged: false });
  }

  const netBefore = Math.round([...oldRows.values()].reduce((sum, row) => sum + row.netPayable, 0));
  return finish(flags, rows, { netAfter, peopleAfter: nowRows.size, netBefore, peopleBefore: oldRows.size });
}

function finish(
  flags: Flag[],
  rows: CompareRow[],
  totals: Omit<FlagReport, "flags" | "rows">,
): FlagReport {
  const flaggedIds = new Set(flags.filter((flag) => flag.level !== "note").map((flag) => flag.id));
  flags.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || a.name.localeCompare(b.name));
  rows.forEach((row) => {
    row.flagged = flaggedIds.has(row.key.replace(/^gone:/, ""));
  });
  rows.sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || a.name.localeCompare(b.name));
  return { flags, rows, ...totals };
}

/** Flags that should stop an autosave: not notes, and not already present when the month was loaded or accepted with Save anyway. */
export function newWarnings(flags: Flag[], accepted: ReadonlySet<string> | null): Flag[] {
  if (!accepted) return [];
  return flags.filter((flag) => flag.level !== "note" && !accepted.has(flag.key));
}
