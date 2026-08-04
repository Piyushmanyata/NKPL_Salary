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
  Special is fixed monthly, uses full Calendar Days for payroll, and has no day rate.
- Calendar days are derived from the month label.
- Days Worked and Extra Days are manual employee-month inputs; no punch-based attendance layer
  participates in payroll.
- The Official sheet has one code path. Attendance is `clamp(26 − calendar absences, 0, 26)`
  for everyone. PF status affects only the basic formula and the PF amount.
- Official basic uses the wage board when PF is on; the opt-out elevation applies only when
  PF is off. The ₹15,000 EPF ceiling applies to the PF base, never to the displayed basic.
- Official net is always computed. If no Official frame packs, the row is flagged `unpackable`
  and export is blocked. ADR-0001's net equality holds for every non-flagged row.

## Consequences
- ADR-0001 net equality becomes a testable invariant rather than an assignment.
- Official registers reconcile to the statutory wage board.
- Stored records need migration for `isSpecial` → `category` and for advance sign (TICKET-06).
