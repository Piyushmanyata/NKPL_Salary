# ADR 0011: ESI eligibility is tested on Basic, on both sheets

## Status

Accepted (2026-08-04). Supersedes the ESI **eligibility** test in ADR-0004 §1. The ESI *base*
(Earned Salary for the Reference baseline, Official Monthly Basic for the displayed amount under
ADR-0005) is unchanged.

## Context

The two sheets asked the eligibility question of two different quantities:

| Sheet | Eligibility test |
|---|---|
| Reference (`calculateSalary`) | `totalSalary <= 21000` — the package, per ADR-0004 |
| Main / Official (`officialEsi`) | `officialBasic > 21000 -> no ESI` — the basic |

For a row with a package over ₹21,000 whose basic is under it, the Reference sheet called the
employee exempt while the Official sheet called them eligible. ADR-0005 papers over the visible
symptom by copying the Official amount into the Reference row, but the disagreement still leaks:
`row.esiOptIn` picks the 51% basic floor inside `officialBasic` (21,100 when off, 15,100 when on),
so an eligibility answer the Reference sheet got from the package was reshaping the Official basic.

## Decision

Reference ESI eligibility moves onto **Basic**:

```
esiEligible = Category !== "Special" && esiOptIn !== false && fullMonthBasic <= 21000
```

`fullMonthBasic` is the **standing** basic (`monthlySalary × basicPercent`), not the prorated one —
the same quantity the PF ₹15,000 cutoff already uses. Eligibility is therefore a property of the
employee's grade, and cannot flip because they were absent for a few days.

## Consequences

- Both sheets answer ESI eligibility with the same quantity. A row can no longer be eligible on one
  and exempt on the other.
- Rows whose package exceeds ₹21,000 but whose basic does not are now ESI-eligible on the Reference
  sheet. At the default 70% basic they are packages between ₹21,000 and ₹30,000.
- No row in the June 2026 golden fixtures changes: the parity and invariant suites pass unmodified,
  so this does not restate any historical payroll.
- ADR-0004's rule that "the Source Workbooks outrank ADR-0002's reasoning" still holds for
  everything else; this is the explicit exception that ADR-0004 §3 requires such a change to record.
