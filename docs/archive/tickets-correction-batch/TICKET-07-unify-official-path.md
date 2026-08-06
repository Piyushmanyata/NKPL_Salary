# TICKET-07 — Collapse the two Official Sheet code paths into one; apply the 26-day frame to everyone

**Type:** refactor / bug · **Priority:** P0 · **Blocks:** 08, 09
**Blocked by:** 01 · **Spec:** SPEC-payroll.md §6.2

## Current behaviour

`officialSheet.ts` has **two** builders selected by a single flag (`:184-189`):

```ts
export function buildOfficialRow(row: SalaryRow, monthDays: number): OfficialRow {
  const pfActive = row.pfOptIn;
  if (!pfActive) {
    return buildReferenceOfficialRow(row, monthDays);   // ← completely different algorithm
  }
  ...
}
```

They differ in ways that have nothing to do with PF:

| | `buildReferenceOfficialRow` (PF off) | `buildOfficialRow` (PF on) |
|---|---|---|
| Attendance | `row.daysWorked` — **uncapped, up to 31** (`:149`) | `clamp(26 − absentDays, 0, 26)` with a search loop (`:196-232`) |
| Proration divisor | `monthDays` (`:150`) | `26` (`:204`, `:234`) |
| Net | **copied** from Reference (`:180`) | recomputed (`:249`) |
| `officialAttendance` / `officialBonus` | passed through (`:171-172`) | forced `undefined` (`:265-266`) |

Result on the **real June NKPL roster**, PF-off employees:

| Employee | Days worked | Official attendance printed | Cap |
|---|---|---|---|
| GURU PRASAD PATRA | 30 | **30** | 26 |
| Anupam Mahesh | 30 | **30** | 26 |
| SAGAR CHANDRA MAJHI | 29 | **29** | 26 |
| S K SAJAMAL | 27 | **27** | 26 |

`CONTEXT.md` states Official Attendance is "at most 26". Twelve of the 49 NKPL rows violate it.
A filed wage register showing 30 days against a 26-day wage board is the single most visible
defect on the sheet.

## Required behaviour

**One** function. Attendance is derived identically for every employee:

```
absentDays = max(0, D − Dw)            // calendar frame
A_max      = clamp(26 − absentDays, 0, 26)
A_min      = Dw > 0 ? 1 : 0
```

PF status affects only the **basic formula** (TICKET-08) and the **PF amount** — never the
attendance frame, never the proration divisor, never whether net is computed.

## Changes

**`src/officialSheet.ts`** — delete `buildReferenceOfficialRow` entirely. Rewrite
`buildOfficialRow` as a single function:

```ts
export function buildOfficialRow(row: SalaryRow, monthDays: number): OfficialRow {
  const wageCategory = row.category;                        // TICKET-11: no re-guessing
  const absentDays   = Math.max(0, monthDays - row.daysWorked);
  const aMax         = Math.max(0, Math.min(OFFICIAL_WAGE_DAYS, OFFICIAL_WAGE_DAYS - absentDays));
  const aMin         = row.daysWorked > 0 ? 1 : 0;

  const attendance = pickPackableAttendance(row, wageCategory, aMax, aMin);   // TICKET-09
  return assembleOfficialRow(row, wageCategory, attendance);                  // TICKET-09 §6.6
}
```

Extract `officialBasic(row, wageCategory, A)`, `officialPf(row, basic)` and
`officialEsi(row, basic)` as pure exported helpers so they can be unit-tested and reused by
the packing search without duplication. `calculateStatutoryComponents` (`:122-144`) is
replaced by these.

The proration divisor is **always 26**: `proratedTotal26 = (row.totalSalary / 26) × A`.

**`src/App.tsx:466`** — call site is unchanged.

## Acceptance criteria

- [ ] `buildReferenceOfficialRow` no longer exists; `officialSheet.ts` exports one row builder.
- [ ] `0 <= officialRow.attendance <= 26` for every row in both June rosters (invariant **I3**).
- [ ] GURU PRASAD PATRA prints Official attendance `26`, not `30`.
- [ ] `officialBasic`, `officialPf`, `officialEsi` are pure, exported and individually tested.
- [ ] Toggling `pfOptIn` on a fixture changes only `basic`, `pf` and the packed components —
      never `attendance`, unless packing forces a walk-down.
