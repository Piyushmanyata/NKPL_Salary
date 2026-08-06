# Ticket Index — Payroll Correction Batch

**Created:** 2026-07-26 · **Spec:** [`../SPEC-payroll.md`](../SPEC-payroll.md)
**Read before executing:** `SPEC-payroll.md`, then `CONTEXT.md`, then `docs/adr/`.

Every ticket is self-contained: current behaviour with `file:line`, required behaviour,
code sketch, and acceptance criteria. Execute in wave order. Do not start a ticket whose
blockers are open.

---

## Tickets

| # | Title | Type | Pri | Blocked by |
|---|---|---|---|---|
| 01 | Make `Special` a fourth Category and delete the `isSpecial` flag | schema | P0 | — |
| 03 | Derive calendar days from the month label; delete `WORKING_DAYS = 31` | bug | P1 | — |
| 04 | Unskilled with a monthly salary but no day rate earns ₹0 | bug | P0 | 01 |
| 05 | Bundled June roster stores *total* salary in `monthlySalary` | data | P1 | 01 |
| 06 | **Advance sign flipped — employees with advances are overpaid** | money | **P0** | — |
| 07 | Collapse the two Official paths; 26-day frame for everyone | refactor | P0 | 01 |
| 08 | Official basic: wage board wins when PF on; drop the ₹15,000 cap | bug | P0 | 07 |
| 09 | Official net must be computed, never copied; `unpackable` flag | bug | P0 | 07, 08 |
| 10 | Remove input fields the engine silently ignores | cleanup | P2 | 01 |
| 11 | `normalizeWageCategory` reclassifies from salary bands | bug | P0 | — |
| 12 | `Special` has no wage-board row; guard the lookup | bug | P1 | 01, 07, 11 |
| 13 | Update `CONTEXT.md`; record ADR-0003 | docs | P1 | 01, 07, 08, 09 |
| 14 | Repair the test runner; invariant, fuzz and golden-master suites | test | P0 | 01–12 |
| 15 | Stale `.xls` exports predate the code — not an oracle | process | P1 | — |

---

## Execution waves

```
Wave 0  ── independent, start immediately, no shared files
   06 ── advance sign  ⚠ SHIP FIRST, ships with a data migration
   03 ── month days from label
   15 ── investigate deployed build + P-Tax exemption (no code)

Wave 1  ── schema foundation, land 01 and 11 in the SAME commit
   01 ── Category as a closed 4-value set
   11 ── stop salary-band guessing        ← without this, 01 is undone at App.tsx:443

Wave 2  ── depends on the new schema
   04 ── Unskilled day-rate back-fill
   05 ── fix the bundled June roster
   10 ── remove dead input fields

Wave 3  ── Official sheet, strictly sequential
   07 ── one code path, 26-day frame
   08 ── basic rules            (needs 07's helper extraction)
   09 ── computed net + packing (needs 08's basic formula)
   12 ── Special on the Official sheet

Wave 4  ── close out
   14 ── tests (assertions reference every prior ticket)
   13 ── docs + ADR-0003
```

**01 and 11 must land together.** `App.tsx:443` re-runs `normalizeWageCategory` on every
render and rewrites `"Special"` to `"Skilled"` via the salary-band fallback. Shipping 01
alone silently reverts it.

**06 ships first and ships with its migration.** The code fix without the data migration
leaves stored negative advances; the migration without the code fix double-corrects.

---

## Severity summary

| Defect | Scope | Evidence |
|---|---|---|
| Advance sign flipped | 5 employees, ₹5,178 overpaid in June alone | T-06 |
| Official net copied, not computed | 13.1% of 200,000 fuzzed inputs misreport net | T-09 |
| Net equality broken | 17.0% of 200,000 fuzzed inputs | T-09 |
| Official attendance above the 26-day cap | 12 of 49 NKPL rows | T-07 |
| Unskilled silently zeroed | any Unskilled row missing a day rate | T-04 |
| Bundled roster salary conflation | 10 of 51 rows | T-05 |
| Basic capped below the ESI threshold it claims to clear | 1 employee (BIDYUT RAY) | T-08 |
| `npm test` does not run | entire suite, zero signal | T-14 |

---

## Definition of done for the batch

- [ ] All 14 remaining tickets closed.
- [ ] `npm test` green from a clean clone.
- [ ] Invariants **I1–I10** hold across 200,000 fuzzed cases with 0 violations.
- [ ] Both June rosters re-exported and diffed; every changed rupee attributed to a ticket.
- [ ] `CONTEXT.md`, ADR-0003 and `SPEC-payroll.md` mutually consistent.
- [ ] Advance migration executed, with a dry-run log retained.
- [ ] Payroll sign-off informed of the advance correction and any P-Tax arrears.
