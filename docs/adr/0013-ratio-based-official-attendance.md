# ADR 0013: Official attendance is a ratio of the calendar month, not a subtraction

## Status

Accepted (2026-09-03). Replaces the `A_max` rule of SPEC §6.2. Official basic (§6.3, including
the ADR-0012 pin), net equality (ADR-0001), the ESI base (ADR-0002, ADR-0005) and the packer
(§6.5) are unchanged — only the ceiling handed to the packer moves.

## Context

The Main (Official) sheet files attendance on a 26-day wage-board frame while day inputs are
captured on the real calendar frame of 28–31 days. The old rule subtracted absent days
one-for-one from the 26-day ceiling:

```
A_max = clamp(26 − max(0, D − Dw), 0, 26)
```

That mixes frames. An absent day is scored against a 30-day month but deducted from a 26-day
ceiling, so each absence costs more than a day's worth of the frame it is deducted from. Ten
days worked in a 30-day month printed an attendance of 6 — a third of the month worked,
under a quarter of the frame filed.

The distortion is exactly `absentDays × (D − 26) / D`, so it is zero only at full attendance
and worst in 31-day months.

## Decision

**Scale days worked into the 26-day frame.**

```
A_max = clamp(round((Dw / D) × 26), 0, 26)
A_min = Dw > 0 ? 1 : 0
```

1. **`D` is the calendar days of the labelled month** (28–31), the same `D` the Reference sheet
   uses. `Dw` is already clamped to `D` on input, so the ratio never exceeds 1.

2. **Rounded to a whole day.** Attendance is filed as a day count and the packer walks `A` in
   whole steps. A fractional `8.67` on a statutory register buys nothing and would force a
   fractional packer search.

3. **The packer is unchanged.** This sets the ceiling only; `pickPackableAttendance` still walks
   `A` down from `A_max` to `A_min` until the row's target gross covers its basic and the bonus
   floor. A row that was packable before stays packable — the search range only widens upward.

4. **Everything else is untouched.** Extra Days stays a separate column. Special employees have
   `Dw = D` forced, so they print 26 under both rules. The Reference sheet's `absentDeduction`
   (`r × absentDays`) stays on the true calendar frame, where it belongs — that is real pay for
   real days.

5. **It applies to every month, including already-stored ones.** The Main sheet is derived from
   the stored day inputs on every load; there is no per-month rule flag, and adding one would
   mean two attendance rules live in the code forever.

## Consequences

- **Printed attendance rises for anyone with absences**, by `absentDays × (D − 26) / D`
  before rounding. 30-day month: 20 days worked goes 16 → 17, 10 days worked goes 6 → 9.
  Full attendance is 26 under both rules, so a fully-present roster sees no change at all.

- **PF rises, because PF follows basic.** `officialPf = 0.12 × min(basic, 15000)` and basic is a
  function of `A`. On the June 2026 rosters: **NKPL +₹797.76/month employee PF across 13 of 51
  rows; APTUS +₹398.40 across 7 of 36.** Employer PF moves the same way. This is the point of
  the change — the register should show contributions on the attendance actually worked.

- **ESI rises, and unlike the ADR-0012 pin this one does move Net Payable.** `officialEsi` is
  `0.0075 × officialBasic`, and Reference ESI is aligned to Official ESI (ADR-0005), so an
  ESI-eligible employee with absences takes home **0.75% of the basic increase less**. Packing
  (ADR-0001) keeps Official net equal to Reference net, but it equalises both to a slightly
  lower figure — it does not absorb the ESI charge itself. June 2026: NKPL net −₹42.60 across
  the roster (largest single row −₹6.60), APTUS −₹24.90 (largest −₹9.90). Employer ESI rises
  +₹184.60 and +₹107.90 respectively. Accepted: an ESI charge computed on a higher declared
  basic is the correct charge, and clamping it would print a contribution that does not match
  the basic beside it.

- **Reopening a filed month reprints it.** Any month with absences shows a different attendance,
  basic, PF and ESI than the copy already filed, and — per the point above — a net a few rupees
  lower for ESI-eligible rows. Accepted for the same reason ADR-0012 accepted retroactivity, but
  noted here as the larger exposure: re-exporting an old month produces a sheet that differs
  from the filed one in the contribution columns and, for ESI rows, in net.

- **Rows can no longer be squeezed to `A_max < A_min`.** `Dw ≥ 1` always rounds to `A_max ≥ 1`,
  so the degenerate case where the old rule handed the packer an empty range (e.g. 5 days
  worked in a 31-day month: `A_max = 0`, `A_min = 1`, no `A` to try) disappears. On the fuzz
  oracle at seed 7 this drops the `unpackable` rate from **8.47% to 0.24%** over 200,000 cases,
  all ten invariants still holding. Confirmed to be the empty range and not extra packing room:
  the old frame with `A_max` merely floored at `A_min` gives the same 0.24%.

## Alternatives rejected

**Keep the subtraction, but deduct on the calendar frame** (`A = 26 × Dw / D` computed as
`26 − absentDays × 26/D`). Algebraically identical to the decision; stated as a ratio because
that is how the rule was asked for and how it reads on the sheet.

**Carry `A` as a two-decimal figure.** More faithful to the ratio, but attendance is a filed day
count, the packer steps in whole days, and the export writes the field verbatim. Rounding loses
at most half a day of basic, which packing absorbs anyway.

**Gate the new rule to months from a chosen date forward.** Would keep already-filed months
byte-identical, at the cost of two permanent attendance rules and a per-month flag in storage.
Rejected: the app has no such mechanism, and every month is recomputed from inputs on load.
