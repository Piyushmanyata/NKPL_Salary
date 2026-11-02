# ADR 0020: Professional Tax slab is chosen by the salary month

## Status

Accepted (2026-11-02).

## Context

West Bengal replaced the employee P-Tax slab from 1 October 2026 (Kolkata Gazette,
notification 1407-F.T. dated 18 August 2026, Schedule Part A Sl. 1). The new slab exempts gross
up to ₹20,000 (was ₹10,000) and tops out at ₹208 above ₹1,00,000 (was ₹200 above ₹40,000).
Both tables are in `SPEC-payroll.md` §5.

Every row, saved months included, is recomputed from its inputs on load, so `calculateSalary`
had no idea which month it was computing and could hold only one slab.

## Decision

- `calculateSalary` takes `monthLabel`; the app passes the open month.
- `calculateProfessionalTax(wages, monthLabel)` uses the old slab for months before
  October 2026 and the new slab from October 2026 on.
- A missing or unreadable month gets the slab in force now.
- The TDS-payer waiver (TICKET-15) and the base (prorated Reference Gross Payable) are unchanged.

Rejected: replacing the slab outright. Opening June–September 2026 would then show a different
P-Tax and net from what was paid, against ADR-0017 (a saved month keeps what it paid).

## Consequences

- June–September 2026 and every earlier month look exactly as before; the June golden tests
  pin `monthLabel: "June 2026"`.
- October 2026 is recomputed on the new slab when opened, saved or not. On the June 2026 rosters
  the new slab cuts monthly P-Tax from ₹8,040 to ₹2,440 (NKPL) and ₹6,860 to ₹1,680 (APTUS).
- `scripts/reference-oracle.py` models the pre-October 2026 slab only, matching the June
  Source Workbooks it was built to reproduce.
- The next slab change adds a third table and a start month here.
