import { MONTH_NAMES, parseMonthYearString } from "./months";
import { roundMoney } from "./salary";
import type { Increment } from "./types";

const monthKey = (label: string) => {
  const parsed = parseMonthYearString(label);
  return parsed ? parsed.year * 12 + parsed.monthIndex : Number.NaN;
};

export function sanitizeIncrements(value: unknown): Increment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const kept = value.flatMap((entry): Increment[] => {
    if (!entry || typeof entry !== "object") return [];
    const { month, amount, note } = entry as Record<string, unknown>;
    const parsed = typeof month === "string" ? parseMonthYearString(month) : null;
    const rounded = typeof amount === "number" ? roundMoney(amount) : 0;
    if (!parsed || !(rounded > 0)) return [];
    const trimmed = typeof note === "string" ? note.trim() : "";
    return [
      {
        month: `${MONTH_NAMES[parsed.monthIndex]} ${parsed.year}`,
        amount: rounded,
        ...(trimmed ? { note: trimmed } : {}),
      },
    ];
  });
  kept.sort((a, b) => monthKey(a.month) - monthKey(b.month));
  return kept.length ? kept : undefined;
}

export function incrementsForMonth(increments: Increment[] | undefined, monthLabel: string) {
  const key = monthKey(monthLabel);
  const matching = (increments ?? []).filter((entry) => monthKey(entry.month) === key);
  return {
    total: roundMoney(matching.reduce((sum, entry) => sum + entry.amount, 0)),
    notes: matching.flatMap((entry) => (entry.note ? [entry.note] : [])),
  };
}
