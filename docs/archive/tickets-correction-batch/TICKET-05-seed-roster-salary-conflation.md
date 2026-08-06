# TICKET-05 — Bundled June roster stores *total* salary in the `monthlySalary` field

**Type:** data bug · **Priority:** P1 · **Blocks:** 14
**Blocked by:** 01 · **Spec:** SPEC-payroll.md §5 step 1

## Current behaviour

`src/juneEmployees.ts` is the bundled fallback roster loaded whenever the database has no
record for June 2026 (`App.tsx:313`). In **10 of its 51 rows**, `monthlySalary` holds
`(salaryPerDay + bonusPerDay) × 30` — the *total* package — instead of the base salary
`salaryPerDay × 30`.

| Name | Category | Stored `monthlySalary` | Should be | Difference |
|---|---|---|---|---|
| GURU PRASAD PATRA | Skilled | 26,200 | 19,500 | +6,700 |
| Samir Dey | Semi-skilled | 13,500 | 11,010 | +2,490 |
| SISIR HEMRAM | Semi-skilled | 16,950 | 12,000 | +4,950 |
| S K SAJAMAL | Skilled | 22,700 | 17,010 | +5,690 |
| Tapas Chandra Kumar | Semi-skilled | 14,500 | 10,200 | +4,300 |
| UTTAM DAS | Skilled | 27,000 | 15,000 | +12,000 |
| PRIYOJIT GHOSH | Skilled | 22,500 | 16,710 | +5,790 |
| Ashok Ram | Semi-skilled | 19,000 | 15,690 | +3,310 |
| Kajal Senapati | Unskilled | 7,000 | 6,000 | +1,000 |
| Keya Patra | Unskilled | 6,800 | 6,510 | +290 |

Impact is **category-dependent**, and worst for exactly the branch that anchors on monthly:

- **Semi-skilled / Skilled** — `salaryPerDay` is derived as `monthlySalary / D`, so the stored
  `salaryPerDay` is *overwritten* by an inflated value. SISIR HEMRAM becomes ₹565/day instead
  of ₹400/day; the daily bonus is then double-counted, once inside salary and once as bonus.
- **Unskilled** — `salaryPerDay` wins, so the wrong `monthlySalary` is harmlessly recomputed.

The persisted database rows are correct (the June export shows SISIR HEMRAM at ₹400 / ₹12,000).
The bug only bites when the DB is empty, a new environment is provisioned, or the fallback path
at `App.tsx:313` is taken.

## Required behaviour

`monthlySalary` means **base salary only**, excluding the daily bonus. `totalSalary` is the
derived field (`M + D × b`) and is never stored as input.

## Changes

**`src/juneEmployees.ts`** — correct all 10 rows to `salaryPerDay × 30`. Verify the whole file
with the invariant below rather than fixing rows by hand.

**Add a build-time guard** — a test that asserts, for every bundled roster
(`juneEmployees.ts`, `sampleEmployees.ts`):

```ts
for (const e of roster) {
  if (e.category === "Special") continue;
  if (!e.salaryPerDay || !e.bonusPerDay) continue;
  expect(Math.abs(e.monthlySalary - e.salaryPerDay * 30)).toBeLessThanOrEqual(15);
  // and explicitly NOT the total:
  expect(Math.abs(e.monthlySalary - (e.salaryPerDay + e.bonusPerDay) * 30)).toBeGreaterThan(15);
}
```

**Audit `sampleEmployees.ts`** (699 lines) for the same defect before closing.

## Acceptance criteria

- [ ] All 10 listed rows corrected; the guard test passes for both bundled rosters.
- [ ] Loading June 2026 with an empty database reproduces the same Reference figures as
      loading it from a populated database.
- [ ] SISIR HEMRAM resolves to `salaryPerDay: 400`, `monthlySalary: 12000`, `totalSalary: 16950`.
