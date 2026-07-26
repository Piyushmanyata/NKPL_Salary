# TICKET-10 — Remove input fields the engine silently ignores

**Type:** cleanup / correctness · **Priority:** P2 · **Blocks:** none
**Blocked by:** 01 · **Spec:** SPEC-payroll.md §5 step 11, §6

## Current behaviour

Three fields on `EmployeeInput` are accepted, persisted and round-tripped, but never affect
any number on either sheet. A user who edits them sees no change and no error.

**1. `performanceBonus` (`types.ts:49`)**

`sanitizeEmployee` reads and stores it (`App.tsx:259`). `calculateSalary` **overwrites** it
unconditionally at `salary.ts:121`:

```ts
const performanceBonus = (perDayWage + bonusPerDay) * extraDays;
```

The stored value never reaches the output. `App.tsx:1760` even conditionally preserves it
during attendance import (`matched.sundaysEligible > 0 ? undefined : emp.performanceBonus`),
implying an intended manual-override semantic that was never implemented.

**2. `officialAttendance` (`types.ts:52`)** and **3. `officialBonus` (`types.ts:53`)**

Passed through to `OfficialRow` by `buildReferenceOfficialRow` (`:171-172`), then explicitly
discarded by `buildOfficialRow` (`:265-266`):

```ts
officialAttendance: undefined,
officialBonus: undefined,
```

Neither is read anywhere in the Official calculation. Whether they survive depends on the
employee's PF status — the clearest possible signal that they are vestigial.

## Required behaviour

Pick one semantic per field and make the code match it. Recommended: **delete all three.**
`extraDays` is the real input for performance bonus; Official attendance and bonus are
derived quantities that must not be overridable, or net equality becomes unenforceable.

## Changes

**`src/types.ts`** — remove `performanceBonus`, `officialAttendance`, `officialBonus` from
`EmployeeInput`. `performanceBonus` **stays** on `SalaryRow` (it is a computed output).

**`src/App.tsx`** — remove from `sanitizeEmployee` (`:257-260`), `blankEmployee` (`:77-90`),
the attendance-import merge (`:1760`), and any roster editor control bound to them.

**`src/officialSheet.ts`** — remove `officialAttendance` / `officialBonus` from `OfficialRow`
(`:36-37`) and from both return sites.

**Migration** — ignore the fields on read; they drop out of the record on next save. No
backfill needed since they never influenced a computed value.

**If manual override is genuinely wanted** (defer to a follow-up ticket, do not build now):
model it as an explicit `overrides: { performanceBonus?: number }` object, apply it *after*
the derived value, and mark the row as overridden in the UI so it is auditable.

## Acceptance criteria

- [ ] The three fields do not appear in `src/` or `api/`.
- [ ] Recomputing both June rosters produces byte-identical output before and after removal.
- [ ] `SalaryRow.performanceBonus` is still present and still equals `(r + b) × extraDays`.
- [ ] Loading a stored record containing the removed fields does not throw.
