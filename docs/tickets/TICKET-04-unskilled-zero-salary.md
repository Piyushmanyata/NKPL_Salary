# TICKET-04 — Unskilled employee with a monthly salary but no day rate earns ₹0

**Type:** bug / data loss · **Priority:** P0 · **Blocks:** 14
**Blocked by:** 01 · **Spec:** SPEC-payroll.md §2.2 (back-fill rule)

## Current behaviour

`salary.ts:93-95`:

```ts
if (isLabour) {
  monthlySalary = roundMoney(workingDays * salaryPerDay);
}
```

The overwrite is **unconditional**. If `salaryPerDay` is `0`, `undefined`, `null` or an empty
string, `monthlySalary` is destroyed — whatever was stored is replaced by `0`.

Downstream: `earnedSalary = 0` → `basicSalary = 0` → `absentDeduction = 0` → the employee's
gross consists only of `earnedBonus + performanceBonus + specialBonus`, and net can go
negative once `advance` is applied. No warning is raised anywhere.

Fuzz reproduction (`{category:"Unskilled", monthlySalary:38438, salaryPerDay:0, bonusPerDay:75, daysWorked:17, D:29}`):
`basicSalary = 0`, `grossPayable = 6275.00` — the entire ₹38,438 package vanished.

`App.tsx:218-222` (`sanitizeEmployee`) *does* back-fill correctly:

```ts
if (salaryPerDay === 0 && monthlySalary > 0) salaryPerDay = roundMoney(monthlySalary / monthDays);
```

So the loader and the engine disagree. Any caller of `calculateSalary` that bypasses
`sanitizeEmployee` — including every unit test and the API — hits the bug.

## Required behaviour

Back-fill the day rate **before** the overwrite, inside `calculateSalary`, so the engine is
self-sufficient and cannot disagree with the loader.

## Changes

**`src/salary.ts`** — in the `Unskilled` branch of the switch introduced by TICKET-01:

```ts
case "Unskilled": {
  if (salaryPerDay <= 0 && monthlySalary > 0) {
    salaryPerDay = roundMoney(monthlySalary / workingDays);
  }
  monthlySalary = roundMoney(workingDays * salaryPerDay);
  break;
}
```

**`src/App.tsx`** — `sanitizeEmployee` keeps its own back-fill (harmless, now idempotent),
but the two must produce the same result. Add a dev-mode assertion or delete the duplicate
and delegate to a shared exported helper `resolveRates(input, monthDays)`.

**Guard.** Add a validation warning surfaced in the roster UI when
`salaryPerDay <= 0 && monthlySalary <= 0` for any non-Special employee — that row genuinely
has no pay basis and should be flagged, not silently zeroed.

## Acceptance criteria

- [ ] `calculateSalary({category:"Unskilled", monthlySalary:9600, salaryPerDay:0, daysWorked:30}, {workingDays:30})`
      returns `salaryPerDay === 320` and `monthlySalary === 9600`.
- [ ] `calculateSalary` and `sanitizeEmployee` produce identical `salaryPerDay` /
      `monthlySalary` for the same input and `monthDays`.
- [ ] No input with `monthlySalary > 0` or `salaryPerDay > 0` produces `grossPayable === 0`
      across a 200,000-case fuzz (invariant **I7**).
- [ ] An employee with neither a monthly salary nor a day rate is flagged in the UI.
