# TICKET-06 — Advance sign convention was silently flipped; employees with advances are overpaid

**Type:** bug / money · **Priority:** **P0 — highest** · **Blocks:** 14
**Blocked by:** none · **Spec:** SPEC-payroll.md §2.4

## Current behaviour

Three parts of the system disagree about the sign of `advance`.

**1. The engine subtracts it.** `salary.ts:150`:

```ts
const netPayable = grossPayable - employeePf - esi - professionalTax - advance - otherDeduction;
```

**2. The UI documents the opposite.** `App.tsx:1688`:

```tsx
<Rule label="Advance" value="Positive adds to net pay, negative subtracts from net pay" />
```

**3. The stored data follows the UI, not the engine.** Every advance in the June exports is
stored **negative**: Ashok Ram `−1500`, Kajal Senapati `−500`, Jayanta Koley `−2000`
(NKPL); Biswasundar Bhoi `−95`, Piku Mondal `−83` (APTUS).

The exports (2026-07-07) predate the statutory rework (2026-07-24). At export time
`net = ... + advance`, so a stored `−1500` correctly *reduced* net by ₹1,500. The rework
changed the operator to `−` without migrating the data or updating the help text.

**Live impact — Ashok Ram, June 2026:**

| | Gross | PF | ESI | P-Tax | Advance effect | Net |
|---|---|---|---|---|---|---|
| Exported (correct) | 19,623.00 | 1,317.96 | 117.68 | 130 | **−1,500** | **16,557.36** |
| Current code | 19,623.00 | 1,317.96 | 117.68 | 130 | **+1,500** | **19,557.36** |

**Every employee with a stored advance is now overpaid by twice the advance amount.**
Five employees across the two June rosters; ₹5,178 total on that month alone.

`App.tsx:570` and `:596` compound the confusion by using yet another convention in the
totals row (`total - (row.advance || 0) + row.otherDeduction`).

## Required behaviour

`advance` is stored **positive**, meaning "₹X was advanced and is being recovered this month".
The engine always subtracts. Negative input is clamped to `0` at the boundary. The minus sign
is presentation only.

## Changes

**`src/salary.ts`** — clamp at the boundary, matching `otherDeduction`:

```ts
const advance = Math.max(0, numberValue(input.advance));
```

Keep `:150` as-is (`− advance`). Change the returned `advance` from the passthrough
`input.advance` (`:168`) to the clamped value, so `SalaryRow.advance` is always non-negative.

**`src/App.tsx`**

- `sanitizeEmployee:250` — clamp: `numberValue(row.advance) > 0 ? numberValue(row.advance) : undefined`.
- `updateEmployee:690-694` — reject negative input in the row editor.
- `:1688` — correct the help text to `"Amount advanced to the employee, recovered from this month's net pay"`.
- `:570`, `:596` — totals use `+ row.advance + row.otherDeduction` on the deductions side.
- `:1003`, `:1035` — export writes `-roundMoney(row.advance)` for display only.

**Data migration — required, run once before deploy:**

```
for every stored employee row, for every company and month:
    if (advance != null && advance < 0) advance = Math.abs(advance)
```

Write this as a one-shot script against the KV store (`api/db.ts`), log every row it touches,
and dry-run it first. Do not ship the code change without the migration — the two together
are what restores correctness.

## Acceptance criteria

- [ ] `calculateSalary` with `advance: 1500` reduces net by exactly ₹1,500.
- [ ] `calculateSalary` with `advance: -1500` reduces net by exactly ₹1,500 (clamped, not added).
- [ ] `SalaryRow.advance >= 0` always.
- [ ] Ashok Ram, June 2026, recomputes to a net of ₹16,557.36 (matching the 2026-07-07 export).
- [ ] The migration script's dry-run output lists exactly the 5 known negative advances.
- [ ] UI help text, totals row and export all agree with the engine.
