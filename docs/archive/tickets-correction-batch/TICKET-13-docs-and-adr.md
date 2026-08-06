# TICKET-13 — Update `CONTEXT.md` and record the superseding decisions as ADR-0003

**Type:** docs · **Priority:** P1 · **Blocks:** none
**Blocked by:** 01, 07, 08, 09 (land docs with the code) · **Spec:** SPEC-payroll.md (all)

## Current behaviour

`CONTEXT.md` is the project glossary and is read first by every agent (`docs/agents/domain.md`).
Four of its entries now contradict `SPEC-payroll.md`:

| `CONTEXT.md` entry | States | Spec says |
|---|---|---|
| **Semi-skilled / Skilled** | "monthly salary is fixed…" | Correct, but must be restated as one of **four** categories, not a pair alongside a Special *flag* |
| **Special Employee** | "Special was an attendance-exempt role/flag" | Special is a **Category**, mutually exclusive with the other three (TICKET-01) |
| **Official Attendance** | "at most 26" | Correct, but the PF-off path violated it; add that the 26-day frame applies to **every** employee (TICKET-07) |
| **Opt-Out Basic** | "if no ESI, max(₹21,100, 51%…); if no PF, max(₹15,100, 51%…)" | Applies **only when PF is off**. When PF is on, the wage board wins (TICKET-08) |

`CONTEXT.md` also needed to distinguish manual day inputs from the computed Official attendance
field, and had no entry for **Unpackable Row**.

ADR-0001 and ADR-0002 remain valid — ADR-0002's ESI bases were explicitly reconfirmed in the
2026-07-26 grill (Reference ESI on Gross Payable, Official ESI on Official Basic).

## Changes

**`CONTEXT.md`**

- Rewrite **Special Employee** as a Category. Add the constraint list from SPEC §2.2.
- Remove the retired Security Employee / attendance-checker vocabulary.
- Amend **Official Attendance**: "Derived as `clamp(26 − calendar absences, 0, 26)` for every
  employee regardless of PF status."
- Amend **Opt-Out Basic**: "Used only when PF is off. When PF is on, Official basic is the
  wage-board daily rate × Official attendance, uncapped."
- Add **Unpackable Row**: a row for which no Official attendance produces
  `targetGross ≥ officialBasic`. Flagged in the UI and blocks export.
- Amend **Calendar Days**: derived from the month label; never independently editable.
- Add a pointer at the top: "Formulas are defined in `docs/SPEC-payroll.md`, which is
  authoritative where this glossary is ambiguous."

**`docs/adr/0003-category-as-closed-set-and-official-frame.md`** — new:

```markdown
# ADR 0003: Category as a closed four-value set; one Official frame

## Status
Accepted (grill 2026-07-26). Amends ADR-0001.

## Context
`Special` was a boolean overlay on a free-text category, and the Official sheet had two
divergent code paths keyed on PF status. This produced Official attendance above the 26-day
cap for 12 of 49 NKPL rows, a ₹15,000 cap on the displayed basic that contradicted the ESI
line, and a copied `netPayable` that misreported net in 13.1% of fuzzed inputs.

## Decision
- `Category = Unskilled | Semi-skilled | Skilled | Special`, mutually exclusive and closed.
  Category is never inferred from salary bands.
- Unskilled anchors on day rate; Semi-skilled and Skilled anchor on monthly salary;
  Special is fixed monthly, attendance-exempt, with no day rate.
- Calendar days are derived from the month label.
- Days Worked and Extra Days are manual employee-month inputs; no attendance checker or automatic
  Sunday/double-shift behavior remains.
- The Official sheet has one code path. Attendance is `clamp(26 − calendar absences, 0, 26)`
  for everyone. PF status affects only the basic formula and the PF amount.
- Official basic uses the wage board when PF is on; the opt-out elevation applies only when
  PF is off. The ₹15,000 EPF ceiling applies to the PF base, never to the displayed basic.
- Official net is always computed. If no attendance packs, the row is flagged `unpackable`
  and export is blocked. ADR-0001's net equality holds for every non-flagged row.

## Consequences
- ADR-0001 net equality becomes a testable invariant rather than an assignment.
- Official registers reconcile to the statutory wage board.
- Stored records need migration for `isSpecial` → `category` and for advance sign (TICKET-06).
```

## Acceptance criteria

- [ ] No statement in `CONTEXT.md` contradicts `SPEC-payroll.md`.
- [ ] `CONTEXT.md` distinguishes manual day inputs, computed Official attendance, and Unpackable Row.
- [ ] ADR-0003 exists, is marked Accepted, and references ADR-0001.
- [ ] ADR-0001 and ADR-0002 are left in place, with ADR-0001 marked "Amended by ADR-0003".
