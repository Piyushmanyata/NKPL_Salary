# TICKET-08 — Official basic: the wage board wins when PF is on; remove the ₹15,000 display cap

**Type:** bug · **Priority:** P0 · **Blocks:** 09
**Blocked by:** 07 · **Spec:** SPEC-payroll.md §6.3

## Current behaviour

Two independent defects compound.

**Defect A — the opt-out elevation fires while PF is on.** `officialSheet.ts:206-211`:

```ts
const hasNoPf  = !row.pfOptIn  || row.pfOptedOut;
const hasNoEsi = !row.esiOptIn || row.esiOptedOut;
if ((hasNoPf || hasNoEsi) && candidate > 0) {
  const fullMonthBasicRate = getOptOutBasicRate(row.totalSalary, hasNoPf, hasNoEsi);
  candidateBasic = roundMoney((fullMonthBasicRate / OFFICIAL_WAGE_DAYS) * candidate);
}
```

The elevated basic exists to justify a *missing* statutory deduction. But the condition is
`hasNoPf || hasNoEsi`, so an employee with **PF on and ESI off** is pushed to
`max(21100, 0.51 × totalSalary)` even though their PF is being deducted against the wage board.

**Defect B — the displayed basic is capped at ₹15,000.** `:212-214` and `:243-245`:

```ts
if (pfActive) {
  candidateBasic = Math.min(candidateBasic, PF_BASIC_LIMIT);   // 15000
}
```

₹15,000 is the EPF **contribution** ceiling, not a wage ceiling. Capping the printed basic
makes the register unreconcilable to the wage board.

**Combined effect — BIDYUT RAY (Skilled, PF on, ESI opted out), the only affected employee in June:**

Defect A pushes basic to ₹21,100 (to explain the absent ESI), then Defect B knocks it to
₹15,000 — which is **below** the ₹21,000 ESI threshold. The printed register now shows a
basic that says the employee *should* have ESI, next to an ESI line of ₹0.

| | Wage board | Basic printed | PF | Net |
|---|---|---|---|---|
| Current | 12,584 | **15,000** | 1,800.00 | 22,226.84 |
| Required | 12,584 | **12,584** | 1,510.08 | 22,226.84 |

## Required behaviour

```
officialBasic(A) =
    pfEligible            → A × wageBoardDaily[wageCategory]        // 400 / 440 / 484
    else if !esiEligible  → (max(21100, 0.51 × totalSalary) / 26) × A
    else                  → (max(15100, 0.51 × totalSalary) / 26) × A
```

No cap on the returned value. The ₹15,000 ceiling appears **only** inside the PF formula:
`officialPf = pfEligible ? 0.12 × min(officialBasic, 15000) : 0`.

## Changes

**`src/officialSheet.ts`**

- Delete both `Math.min(candidateBasic, PF_BASIC_LIMIT)` (`:213`) and
  `Math.min(statutoryBasic, PF_BASIC_LIMIT)` (`:244`).
- Rewrite `getOptOutBasicRate` (`:103-111`) so PF-on short-circuits:

```ts
function officialBasicForAttendance(row: SalaryRow, wageCategory: Category, A: number): number {
  if (row.pfOptIn) {
    return roundMoney(A * WAGE_BOARD_DAILY[wageCategory]);
  }
  const rate = !row.esiOptIn
    ? Math.max(21100, Math.round(row.totalSalary * 0.51))
    : Math.max(15100, Math.round(row.totalSalary * 0.51));
  return roundMoney((rate / OFFICIAL_WAGE_DAYS) * A);
}
```

- Keep `PF_BASIC_LIMIT` used only in the PF calculation.
- `pfOptedOut` / `esiOptedOut` (`SalaryRow`) become redundant here: `row.pfOptIn` and
  `row.esiOptIn` are already the *effective* post-eligibility flags from `salary.ts:133`/`:144`.
  Using `!row.pfOptIn || row.pfOptedOut` double-counts. Use the effective flags only.

**`Category = "Special"`** has no wage-board daily rate. Specials always have `pfOptIn === false`,
so they take the opt-out branch and never index `WAGE_BOARD_DAILY`. Add an explicit guard
regardless — see TICKET-12.

## Acceptance criteria

- [ ] BIDYUT RAY: Official basic `12,584.00`, PF `1,510.08`, gross `23,866.92`, net `22,226.84`.
- [ ] For every PF-on employee in both June rosters,
      `officialBasic === attendance × WAGE_BOARD_DAILY[category]` exactly.
- [ ] `Math.min(..., PF_BASIC_LIMIT)` appears exactly once in `officialSheet.ts`, inside the PF formula.
- [ ] A PF-on employee whose basic exceeds ₹15,000 still has PF of exactly `0.12 × 15000 = 1,800`.
- [ ] An ESI-opted-out, PF-off employee still gets the ₹21,100 floor.
- [ ] Net equality (invariant **I1**) holds for every row in both June rosters.
