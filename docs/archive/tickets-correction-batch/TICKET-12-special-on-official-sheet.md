# TICKET-12 — `Special` has no wage-board row; guard the lookup and define its Official presentation

**Type:** bug (latent, becomes live after 01) · **Priority:** P1 · **Blocks:** none
**Blocked by:** 01, 07, 11 · **Spec:** SPEC-payroll.md §6.1 table, assumption A1

## Current behaviour

`officialSheet.ts:41-58` defines `wageRules` for exactly three keys. `buildOfficialRow:147-148`:

```ts
const wageCategory = classifyWageCategory(row);
const rule = wageRules[wageCategory];
...
employeeTypes: rule.employeeTypes,
allowedBasic:  rule.basic,
```

Today this cannot throw, because `classifyWageCategory` guesses a salary band and always
returns one of the three (see TICKET-11). A Special on ₹60,000 is silently presented as
`Skilled` with `allowedBasic: 12584`.

**After TICKET-01 and TICKET-11**, `wageCategory` is `row.category` verbatim. `wageRules["Special"]`
is `undefined`, and `rule.employeeTypes` throws `TypeError: Cannot read properties of undefined`.
Every Official sheet containing a Special employee — that is, both companies — fails to render.

## Required behaviour

`Special` is a valid Category on the Official sheet. It has:

- **No wage-board daily rate.** Its basic comes from the opt-out formula, since Specials
  always have `pfOptIn === false` and `esiOptIn === false`.
- **A display-only wage-board row.** Per spec assumption **A1**, Specials borrow the
  **Skilled** `employeeTypes` and `allowedBasic` for the presentation columns.

## Changes

**`src/officialSheet.ts`**

```ts
export const WAGE_BOARD_DAILY: Record<"Unskilled" | "Semi-skilled" | "Skilled", number> = {
  Unskilled: 400, "Semi-skilled": 440, Skilled: 484,
};

// Display-only. Special borrows the Skilled row (SPEC A1).
const DISPLAY_ROW: Record<Category, { employeeTypes: string; allowedBasic: number }> = {
  Unskilled:      { employeeTypes: "Cooly, Helper, Peon",           allowedBasic: 10400 },
  "Semi-skilled": { employeeTypes: "Assistant Moulder, ...Durwan",  allowedBasic: 11440 },
  Skilled:        { employeeTypes: "Moulder, Fitter, ...Typist",    allowedBasic: 12584 },
  Special:        { employeeTypes: "Moulder, Fitter, ...Typist",    allowedBasic: 12584 },
};
```

In `officialBasicForAttendance` (TICKET-08), index `WAGE_BOARD_DAILY` only on the PF-on
branch, and assert the category is not `Special` there:

```ts
if (row.pfOptIn) {
  if (row.category === "Special") throw new Error("Invariant: Special employees cannot have PF on");
  return roundMoney(A * WAGE_BOARD_DAILY[row.category]);
}
```

This is a genuine invariant (TICKET-01 forces `pfOptIn = false` for Specials), so a throw is
correct — it catches a broken upstream rather than papering over it.

**Special attendance.** `Dw === D` and `absentDays === 0`, so `A_max = 26` always. Specials
print Official attendance `26`.

## Acceptance criteria

- [ ] Rendering the Official sheet for a roster containing all 6 Specials does not throw.
- [ ] A Special prints `attendance: 26`, `pf: 0`, `esi: 0`, and `allowedBasic: 12584`.
- [ ] A Special's Official basic uses `max(21100, 0.51 × totalSalary) / 26 × 26`.
- [ ] Net equality holds for all 6 Specials (invariant **I1**).
- [ ] Constructing a Special with `pfOptIn: true` throws a named invariant error.
