# TICKET-15 — The reference `.xls` sheets predate the current code and must not be used as an oracle

**Type:** investigation / process · **Priority:** P1 · **Blocks:** 14 (fixture sourcing)
**Blocked by:** none · **Spec:** SPEC-payroll.md §9 assumption A2

## Finding

`NKPL Reference Salary Sheet June 2026.xls` and `APTUS Reference Salary Sheet June 2026.xls`
are dated **2026-07-07**. The statutory rework landed on **2026-07-24**:

```
9425051 2026-07-24  feat(db): update db api endpoints and local storage sync
a83e080 2026-07-24  test(e2e): add end-to-end month proof … (#4)
e341587 2026-07-24  feat(statutory): implement dual-sheet statutory math and net equality packing (#3)
c227b94 2026-07-24  feat(rates): implement Wage Category rate derivation and explicit Special Employee flag (#2)
d06dae4 2026-07-24  feat(attendance): implement Days Worked and Extra Days … (#1)
006c1ef 2026-07-07  Migrate backend database from Vercel Blob to Redis using ioredis
```

The exports therefore reflect commit `006c1ef` or earlier. Two independent confirmations:

**1. ESI base.** The exports compute employee ESI on **Earned Salary**, not Gross Payable.

| Employee | Earned salary | Gross payable | ESI in export | ÷ 0.0075 |
|---|---|---|---|---|
| Samir Dey | 9,909 | 12,150.00 | 74.32 | **9,909.3** |
| Ashok Ram | 15,690 | 19,623.00 | 117.68 | **15,690.7** |
| SISIR HEMRAM | 12,000 | 16,950.00 | 90.00 | **12,000.0** |

Matches commit `6340b68` ("Update ESI auto-off threshold to check basic salary instead of gross").
Current `salary.ts:146` uses gross, per ADR-0002.

**2. Professional Tax.** `calculateSalary` has **no** P-Tax override path — it is always
`calculateProfessionalTax(grossPayable)`. Yet the exports show:

| Employee | Gross | P-Tax in export | Slab requires |
|---|---|---|---|
| PUNIT SODHANI (NKPL) | 60,000 | **0** | 200 |
| Nawneet Sodhani (APTUS) | 99,990 | **0** | 200 |
| Sonal Goenka (NKPL) | 60,000 | 200 | 200 ✓ |

The current code **cannot** produce a ₹0 for PUNIT SODHANI. Either the deployed build differs
from `src/HEAD`, or a P-Tax exemption existed and was removed. Both need resolving.

## Why this matters

1. The exports are the sheets the business has been reading. If the deployed app still runs
   the old build, **current production output is wrong** in at least the ESI base.
2. Using these files as golden-master fixtures (TICKET-14) would lock in the old, incorrect
   behaviour.

## Actions

- [ ] **Determine what is deployed.** Check the Vercel deployment SHA against `git log`.
      Record it. If it predates `9425051`, the July 24 rework is not live.
- [ ] **Resolve the P-Tax question.** Confirm with the business whether PUNIT SODHANI and
      Nawneet Sodhani are intentionally P-Tax exempt.
      - If **yes** → add an explicit `professionalTaxExempt: boolean` to `EmployeeInput`,
        implement it in `salary.ts:149`, and document it in `CONTEXT.md`. Raise as a follow-up ticket.
      - If **no** → the exports are wrong and both should have been charged ₹200.
        Note the arrears.
- [ ] **Re-export both sheets** from the fixed build once TICKETS 01–12 land, and diff against
      the 2026-07-07 files. Every changed rupee must map to a ticket in this batch. Any
      unexplained delta is a new bug.
- [ ] **Move the stale files** to `docs/archive/2026-07-07/` with a README explaining they are
      historical and not an oracle. Do not delete — they are the only record of what the
      business was shown.
- [ ] **Communicate the advance correction (TICKET-06)** and any P-Tax arrears to whoever
      signs off payroll, before the corrected sheets are issued.

## Acceptance criteria

- [x] The deployed commit SHA is recorded in this ticket. → **`9425051`** (see archive README)
- [ ] The P-Tax exemption question has a written answer from the business. → **still open**
- [x] The stale exports are archived with an explanatory README. → `docs/archive/2026-07-07/`
- [x] A diff of old vs new June exports exists, with every changed figure attributed to a ticket.
      → `docs/archive/2026-07-07/JUNE-DIFF-ATTRIBUTION.md` (matched-name Δ NKPL −2,298.78 / APTUS −628.18)
