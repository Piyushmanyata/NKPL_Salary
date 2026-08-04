# ADR 0011: ESI above a ₹21,000 package is opt-in, and the Official basic makes room for it

## Status

Accepted (2026-08-04). Refines the ESI **eligibility** clause of ADR-0004 §1 and the PF-off basic
floor of TICKET-08. The ESI *base* (Earned Salary for the Reference baseline, Official Monthly
Basic for the displayed amount under ADR-0005) is unchanged.

## Context

Two problems, one visible and one latent.

**1. The package test was a wall, not a default.** `calculateSalary` refused ESI whenever
`totalSalary > 21000`. Some employees above that line are still covered and payroll needs to
deduct for them, and there was no way to say so — the ESI toggle was overruled by the package.

**2. Enabling ESI on such a row would not have worked anyway.** `officialBasic` for a PF-off row
is `max(15100, 0.51 × totalSalary)` prorated on 26 — floored above the PF ceiling, but with no
ceiling of its own. For a package over roughly ₹41,000 that basic lands above ₹21,000, and
`officialEsi` returns 0 for `basic > 21000`. The sheet would have shown ESI switched on and
charged ₹0, silently.

## Decision

**1. Above a ₹21,000 package, ESI is off by default and can be switched on by hand.**

```
esiEligible = Category !== "Special"
              && esiOptIn !== false
              && (totalSalary <= 21000 || esiOverLimitOptIn === true)
```

The consent lives in its own field, `esiOverLimitOptIn`, because `esiOptIn` cannot carry it:
`sanitizeEmployee` writes `esiOptIn: true` on every row that nobody ever touched, so reading that
flag as consent would switch these employees on by surprise the moment this ADR shipped. Absent
means "no consent"; the UI keeps a single ESI toggle, which writes this field for over-limit rows.
An explicit `esiOptIn: false` still wins.

**2. When ESI is on and PF is off, the Official basic is held inside (15,000, 21,000].**

```
fullMonthRate = esiOptIn
  ? min(21000, max(15100, round(0.51 × totalSalary)))
  : max(21100, round(0.51 × totalSalary))
```

Above the PF ceiling so PF stays off; at or below the ESI ceiling so the ESI the user switched on
is actually charged. The ESI-off floor of 21,100 is untouched — that row wants a basic above the
ESI line.

## Consequences

- An employee over ₹21,000 can be put on ESI deliberately, one toggle, and the deduction appears on
  both sheets.
- Nobody starts paying ESI without that toggle being clicked. Every existing row keeps the exemption
  it had.
- High-package PF-off rows that are switched on get a smaller Official basic than before; the
  packing step moves the difference into HRA/TA/bonus, so net pay still matches the Reference sheet
  (ADR-0001 net equality holds — the 200k-case invariant suite passes unchanged).
- No row in the June 2026 golden fixtures changes: no fixture row is both over the limit and opted
  in, so this restates no historical payroll.
