# TICKET-02 — Persist `isSecurity` on the employee and enforce the no-Sunday-package rule

**Type:** schema / bug · **Priority:** P0 · **Blocks:** 14
**Blocked by:** none · **Spec:** SPEC-payroll.md §2.3, §4

## Current behaviour

`EmployeeInput` has **no** `isSecurity` field. Security status is inferred from strings during
attendance import only (`attendance.ts:23-30`):

```ts
function detectSecurity(rawName, department, matchedEmp) {
  return rawName.toLowerCase().includes("security") || ... ;
}
```

It is then **discarded**. `App.tsx:1780` maps a detected security guard onto a wage category
and drops the flag entirely:

```ts
category: d.isSecurity ? "Semi-skilled" : "Skilled",
```

Consequences:
1. The salary engine can never enforce "Security gets no Sunday package" — it does not know.
2. `salary.ts:121` computes `performanceBonus = (perDayWage + bonusPerDay) * extraDays`
   with no security guard, so a manually entered `extraDays` pays out regardless.
3. Detection is name-string-dependent — it silently fails on rename or typo.

Live in the June NKPL data: `Parimal Ghosh(Security)` carries `extraDays: 3`
(₹690 performance bonus) and `Monaj Chatterjee(Security)` carries `extraDays: 5`
(₹1,150 performance bonus), both in direct violation of the rule.

## Required behaviour

`isSecurity` is an explicit, persisted, user-editable boolean on the employee, orthogonal to
Category. When true: no auto-paid Sunday, no Sunday double pay, `extraDays` forced to `0`.

## Changes

**`src/types.ts`** — add to `EmployeeInput` and `SalaryRow`:

```ts
isSecurity?: boolean;   // default false
```

**`src/salary.ts`** — inside `calculateSalary`, immediately after resolving the category:

```ts
const isSecurity = input.isSecurity === true;
const extraDays  = (isSecurity || input.category === "Special")
  ? 0
  : Math.max(0, numberValue(input.extraDays));
```

Replace the existing `:111` assignment. `performanceBonus` at `:121` then falls out at `0`
automatically. Return `isSecurity` on the row.

**`src/App.tsx`**

- `sanitizeEmployee` (`:201`): read and persist `isSecurity: Boolean(row.isSecurity)`.
  Back-fill on first load: `row.isSecurity ?? /\(?\s*security\s*\)?/i.test(row.name)`.
- Attendance import (`:1759`, `:1780-1785`): stop overloading `category`. Write
  `isSecurity: d.isSecurity` and set `category` from the roster (or `"Unskilled"` for a
  genuinely new import), not from the security flag.
- Roster settings panel: add an `isSecurity` toggle next to the Category control. When on,
  disable the `extraDays` input and show "No Sunday package (Security)".

**`src/attendance.ts`** — `calculateEmployeeAttendanceStats` already accepts `isSecurity`
and correctly returns `sundaysEligible: 0`. No change needed; it just needs to be fed the
persisted flag instead of the name-derived one.

## Acceptance criteria

- [ ] `isSecurity` round-trips through save/load and survives an attendance re-import.
- [ ] `isSecurity: true` ⟹ `extraDays === 0` and `performanceBonus === 0`, even when a
      non-zero `extraDays` is supplied in the input.
- [ ] `calculateEmployeeAttendanceStats(days, true)` returns `sundaysEligible === 0` and
      `presentDays` excludes auto-paid Sundays.
- [ ] Migrating the June NKPL roster sets `isSecurity: true` on Parimal Ghosh and
      Monaj Chatterjee and drops their ₹690 / ₹1,150 performance bonuses.
- [ ] Invariant **I6** passes.
