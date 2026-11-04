const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  category: "Category",
  daysWorked: "Days",
  extraDays: "Extra days",
  monthlySalary: "Monthly salary",
  totalSalary: "Total salary",
  salaryPerDay: "Per day",
  bonusPerDay: "Bonus per day",
  advance: "Advance",
  otherDeduction: "Other deduction",
  specialBonus: "Special bonus",
  basicPercent: "Basic %",
  fullAttendanceBasic: "Full-attendance basic",
  pfOptIn: "PF",
  esiOptIn: "ESI",
  esiOverLimitOptIn: "ESI over limit",
  notes: "Notes",
  increments: "Increments",
};

type Row = Record<string, unknown>;

function show(value: unknown): string {
  if (value === undefined || value === null || value === "") return "blank";
  if (typeof value === "boolean") return value ? "on" : "off";
  if (typeof value === "number") return value.toLocaleString("en-IN");
  if (typeof value === "string") return value;
  return "changed";
}

function rowName(row: Row): string {
  return String(row.name || row.id || "Unnamed");
}

/** One plain line per change that turns `before` into `after`, e.g. "Laltu Malik: Days 25 → 24". */
export function describeChanges(before: unknown[], after: unknown[]): string[] {
  const oldRows = new Map((before as Row[]).map((row) => [String(row.id), row]));
  const newRows = new Map((after as Row[]).map((row) => [String(row.id), row]));
  const lines: string[] = [];
  for (const [id, row] of newRows) {
    const old = oldRows.get(id);
    if (!old) {
      lines.push(`Added ${rowName(row)}`);
      continue;
    }
    for (const key of new Set([...Object.keys(old), ...Object.keys(row)])) {
      if (key === "id" || JSON.stringify(old[key]) === JSON.stringify(row[key])) continue;
      const label = FIELD_LABELS[key] ?? key;
      lines.push(
        typeof row[key] === "object" && row[key] !== null
          ? `${rowName(row)}: ${label} changed`
          : `${rowName(row)}: ${label} ${show(old[key])} → ${show(row[key])}`,
      );
    }
  }
  for (const [id, row] of oldRows) {
    if (!newRows.has(id)) lines.push(`Removed ${rowName(row)}`);
  }
  return lines;
}
