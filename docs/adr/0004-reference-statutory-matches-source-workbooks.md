# ADR 0004: Reference statutory arithmetic matches the Source Workbooks

## Status

Accepted (issue #24, 2026-07-29). **Supersedes the Reference clause of [ADR-0002](0002-esi-bases-by-sheet.md).**
ADR-0002's *Official* clause — Official ESI is 0.75% of Official Monthly Basic — is untouched and
remains correct. The two sheets keep deliberately different ESI bases.

## Context

The Reference Sheet exists to reproduce the payroll the business has always run in Excel. Two
Source Workbooks still carry their live formulas:

- `data/SALARY OLD NKPL.xlsx` — sheets `ACTUAL`, `ACTUAL (2..4)`
- `data/SALARY OLD APTUS.xlsx` — sheets `ACTUALL`, `ACTUALL (2..4)`

Comparing them to the engine showed a different Net Payable for most employees. The gap was
entirely in two statutory lines. The workbook formulas are character-identical across both files
and every row inspected:

| | Cell | Formula |
|---|---|---|
| ESI | NKPL `X`, APTUS `W` | `=IF(J<=21000, ROUNDUP(O*0.75%, 0), 0)` |
| PF | NKPL `W`, APTUS `V` | `=ROUND(IF(V<=15000, V*12%, 0), 0)` |

where `J` = `TOTAL Salary P.M` (itself `= K + N`, i.e. `Salary P.M` + `Increase in Salary Amount`)
and `O` = `Salary`, the attendance-prorated basic-track figure the app calls **Earned Salary**.

Against that, the engine charged ESI on **Gross Payable** for both eligibility and base, and
rounded both ESI and PF to two decimals.

`SPEC-payroll.md` §10.2 records that a prior session moved the ESI base *off* Earned Salary and
*onto* Gross, costing each eligible employee ₹16–₹38. ADR-0002 ratified that move. This is the
second time the base has moved, which is why it is being recorded rather than merely fixed.

## Decision

**1. Reference ESI follows the workbook.**

```
esiEligible = Category !== "Special" && esiOptIn !== false && totalSalary <= 21000
esi         = esiEligible ? ceil(earnedSalary × 0.0075) : 0
employerEsi = esiEligible ? ceil(earnedSalary × 0.0325) : 0
```

Eligibility moves onto **Total Salary**, so ESI status is a property of the employee's package and
does not switch on merely because they missed days this month. The base moves onto **Earned
Salary**, so Travel Allowance, Performance Bonus and Special Bonus stop inflating a deduction the
workbooks never applied them to. Both shares round **up** to the whole rupee, matching `ROUNDUP`
and ESIC practice.

**2. Reference PF rounds to the whole rupee.**

```
employeePf = pfEligible ? round(min(basicSalary, 15000) × 0.12) : 0
employerPf = employeePf
```

`ceil` for ESI and `round` for PF is an asymmetry present in the source, not an oversight.

**3. The Source Workbooks outrank ADR-0002's reasoning.** They are the historical payroll. Where
the engine and a workbook disagree on a statutory rupee, the workbook wins unless this ADR records
an explicit exception.

## Accepted divergences

Two, both deliberate, both re-affirmed by the user in issue #24.

**PF eligibility stays on the full-month basic** (`monthlySalary × basicShare > 15000` forces PF
off), not the earned basic `V` the NKPL workbook tests. The two workbooks disagree with each other
here — APTUS rows alternate between testing `K` and testing `U` — and keying the test to the
full-month figure makes an employee's PF status stable month to month rather than flickering with
attendance. This also preserves what `CONTEXT.md` already documented.

**HRA / Travel Allowance keep the 70/30 pooling** of `max(0, proratedTotal − basicSalary)`. The
workbooks compute HRA as `O × (1 − basicShare)` and pay the earned allowance outright as TA.
Because Gross Payable is the same total under either split, **Net Payable parity and HRA/TA
presentation parity are independent** — the divergence costs nothing in take-home and only shows
up in three displayed component amounts. `HRA_SHARE_OF_BALANCE` / `TA_SHARE_OF_BALANCE` stay, and
`officialSheet.ts` continues to use them for its own packing residual.

The proof that these are independent: NKPL `ACTUAL` row 16 (Keya Patra, April-26, `K=6500`,
`N=300`, `F=29`) nets **5,997.33 — exactly the workbook figure — with the 70/30 split in place.**
Before this change the engine paid 5,996.23 (ESI 49.30 vs 48, PF 527.80 vs 528).

## Consequences

**Money.** ESI-eligible employees take home slightly more. Nobody's Gross Payable, Professional Tax
or Days Worked moves. Measured on the real June rosters:

| Roster | Rows changed | Net impact | Roster ESI before → after |
|---|---|---|---|
| NKPL | 37 of 51 | +₹452.75 | ₹2,797.48 → ₹2,344 |
| APTUS | 29 of 36 | +₹418.45 | ₹2,219.78 → ₹1,803 |

No single row moves more than ~₹37.

**Live coupling with the Official Sheet.** `officialSheet.officialBasic` picks its opt-out floor
with `!row.esiOptIn ? max(21100, 0.51×T) : max(15100, 0.51×T)`. Moving ESI eligibility onto Total
Salary can therefore move Official basic. **Measured on both June rosters: 0 rows flip
`esiOptIn`**, so the Main Sheet is unaffected this month — but the coupling is real for future
data and a roster whose Total Salary straddles ₹21,000 while its Gross Payable does not will move
the Official basic floor. `officialSheet.ts` was not modified; any Main Sheet movement is Net
Equality Packing responding to a new Reference target. `unpackable` stays at 0 on both rosters.

**Sub-rupee drift, known and not fixed.** The workbooks compute Earned Salary as `L × F` with
`L = K/30` unrounded; the engine computes `monthlySalary − round(monthlySalary/D, 2) × absentDays`.
These agree to the paisa on every row checked but can differ by up to `absentDays × ₹0.005`. Worth
knowing if a future parity test fails by a fraction of a rupee.

**Tests.** June goldens regenerated from `scripts/gen-golden-fixtures.mjs`. The hardcoded HANDOFF
figures were re-pinned by hand with their prior values recorded inline and in the commit message.
The 200k-case invariant fuzz and the net-equality packing fuzz pass **unchanged** — this alters
rupee amounts, not structural guarantees.

## Presentation

The settings panel's second fixed-monthly field is now **Allowance / Month**: it displays
`Total Salary − Monthly Salary` and stores `Monthly Salary + typed`, with Total Salary as a live
readout beneath. This is the same number the workbook's `Increase in Salary Amount` column asks
for, and it makes `J = K + N` visible instead of showing two boxes that echo each other. Storage
shape is unchanged — `totalSalary` remains the persisted anchor, still dropped when it does not
exceed Monthly Salary, so **no data migration**. Labour keeps its day-rate and bonus-per-day
inputs, which already match how the workbooks' grade rows type `L` and `M` directly.
