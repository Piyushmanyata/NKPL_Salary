# TICKET-03 — Derive calendar days from the month label; delete `WORKING_DAYS = 31`

**Type:** bug · **Priority:** P1 · **Blocks:** 14
**Blocked by:** none · **Spec:** SPEC-payroll.md §3

## Current behaviour

`salary.ts:3` — `export const WORKING_DAYS = 31;`

This constant is the default for `clampMonthDays`, `clampDays`, `blankEmployee(monthDays = WORKING_DAYS)`
(`App.tsx:77`), `sanitizeEmployee(..., monthDays = WORKING_DAYS)` (`:201`) and
`loadEmployees(..., monthDays = WORKING_DAYS)` (`:307`).

`monthDays` is otherwise held in React state (`App.tsx:333`) seeded from a stored config
(`loadMonthConfig`) — i.e. a **user-editable number** that is not derived from, and can
disagree with, `monthLabel`.

Two failure modes:
1. Any code path that omits `monthDays` silently computes a 31-day month. In June (30 days)
   an Unskilled worker's monthly salary is inflated by one day's wage.
2. `monthLabel` and `monthDays` can drift out of sync — "February 2026" with `monthDays: 31`
   is representable and produces wrong pay for every Unskilled employee.

## Required behaviour

`D` is a **pure function of the month label** and is never independently editable.

```ts
export function calendarDaysForMonth(label: string): number {
  const p = parseMonthYearString(label);          // already exists in attendance.ts:200
  if (!p) return 30;                              // safe neutral default, never 31
  return new Date(p.year, p.monthIndex + 1, 0).getDate();
}
```

## Changes

- `src/salary.ts:3` — delete `WORKING_DAYS`. Replace with `DEFAULT_MONTH_DAYS = 30` used
  only as a parse-failure fallback. `MIN_MONTH_DAYS`/`MAX_MONTH_DAYS` become `28`/`31`.
- `src/attendance.ts` — export `calendarDaysForMonth` (it already owns `parseMonthYearString`).
- `src/App.tsx:333` — `monthDays` stops being independent state. Derive it:
  `const effectiveMonthDays = useMemo(() => calendarDaysForMonth(monthLabel), [monthLabel]);`
  Delete `setMonthDays` and the month-days input control.
- `loadMonthConfig` / `saveMonthConfig` — stop persisting `days`. Persist `label` only;
  recompute `days` on read. Ignore any stored `days` value.
- Make `monthDays` a **required** parameter on `sanitizeEmployee`, `loadEmployees` and
  `blankEmployee` so no call site can fall through to a default.

## Acceptance criteria

- [ ] `WORKING_DAYS` does not appear anywhere in `src/` or `api/`.
- [ ] `calendarDaysForMonth` returns 28 for "February 2026", 29 for "February 2028",
      30 for "June 2026", 31 for "July 2026".
- [ ] No function in `src/` has a default value for a `monthDays` parameter.
- [ ] The UI exposes no way to set month days independently of the month label.
- [ ] An Unskilled employee at ₹400/day with full attendance yields ₹11,200 in February 2026
      and ₹12,400 in July 2026.
