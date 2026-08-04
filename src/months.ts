const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function parseMonthYearString(str: string) {
  if (!str) return null;
  const yearMatch = str.match(/\b\d{4}\b/);
  const year = yearMatch ? Number(yearMatch[0]) : null;

  const lower = str.toLowerCase();
  const monthIndex = MONTH_NAMES.findIndex((month) =>
    lower.includes(month.toLowerCase()) || lower.includes(month.slice(0, 3).toLowerCase()),
  );

  return monthIndex !== -1 && year !== null ? { monthIndex, year } : null;
}

// Month labels come back from storage in arbitrary order; sort them chronologically.
export function sortMonthsChronologically(months: string[]): string[] {
  return [...months].sort((a, b) => {
    const pa = parseMonthYearString(a);
    const pb = parseMonthYearString(b);
    const ka = pa ? pa.year * 12 + pa.monthIndex : -1;
    const kb = pb ? pb.year * 12 + pb.monthIndex : -1;
    return ka - kb;
  });
}

/** Pick the nearest earlier month, or the earliest later month, for carry-forward. */
export function pickCarrySource(months: string[], target: string): string {
  const key = (label: string) => {
    const parsed = parseMonthYearString(label);
    return parsed ? parsed.year * 12 + parsed.monthIndex : Number.NaN;
  };
  const targetKey = key(target);
  if (!Number.isFinite(targetKey)) return "";

  const candidates = months.filter((month) => month !== target && Number.isFinite(key(month)));
  const sorted = [...candidates].sort((a, b) => key(a) - key(b));
  const before = sorted.filter((month) => key(month) < targetKey);
  return before.length ? before[before.length - 1] : (sorted[0] ?? "");
}

/** Calendar days for a pay month; invalid labels use the neutral 30-day default. */
export function calendarDaysForMonth(label: string): number {
  const parsed = parseMonthYearString(label);
  if (!parsed) return 30;
  return new Date(parsed.year, parsed.monthIndex + 1, 0).getDate();
}
