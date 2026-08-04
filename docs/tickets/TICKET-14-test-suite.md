# TICKET-14 — Repair the test runner and add invariant, fuzz and golden-master suites

**Type:** test infrastructure · **Priority:** P0 · **Blocks:** none
**Blocked by:** 01–12 (assertions reference the new behaviour) · **Spec:** SPEC-payroll.md §7

## Current behaviour

**`npm test` does not run at all.** In a clean checkout:

```
Error: Cannot find module @rollup/rollup-linux-x64-gnu.
npm has a bug related to optional dependencies
```

The four existing suites (`issue1`–`issue4`) therefore provide **zero** live signal, which is
how a 17% net-equality failure rate and a flipped advance sign both shipped.

The existing tests are also structurally weak:

- `issue4_e2e_month_proof.test.ts` asserts `expect(offRow.netPayable).toBeCloseTo(refRow.netPayable, 2)`
  — but `netPayable` on the PF-off path is *copied from* `refRow.netPayable` (`officialSheet.ts:180`).
  **The assertion is a tautology for exactly the rows most likely to be wrong.**
- Every fixture uses `workingDays: 30`. No test exercises 28, 29 or 31 days, so the
  `WORKING_DAYS = 31` default (TICKET-03) is invisible.
- No test supplies a negative `advance`, so TICKET-06 was undetectable.
- No test constructs an Unskilled employee without a day rate, so TICKET-04 was undetectable.

## Required behaviour

A runnable suite that would have caught every ticket in this batch.

## Changes

**1. Fix the runner.**

```bash
rm -rf node_modules package-lock.json && npm install
```

Then pin the platform binary so CI cannot regress:

```json
"optionalDependencies": { "@rollup/rollup-linux-x64-gnu": "^4.0.0" }
```

Add `npm test` to CI on every push. A red suite must block merge.

**2. `src/__tests__/invariants.test.ts` — property suite.**

Seeded generator (`seed = 7`, reproducible) over the full input space:
`monthDays ∈ {28,29,30,31}`, all four categories, `salaryPerDay ∈ {0, 150…3000}`,
`monthlySalary ∈ {0, 4000…120000}`, `bonusPerDay ∈ {0, 1…500}`, `daysWorked ∈ [0, D]`,
`extraDays ∈ {0,1,2,4,8}`, `basicPercent ∈ {50,54,60,70,76,100}`, `pfOptIn`, `esiOptIn`,
`advance ∈ {0, 500, 1500, 20000}`, `otherDeduction ∈ {0, 100, 15000}`,
`specialBonus ∈ {0, 5000}`.

Run 200,000 cases and assert **I1–I10** from SPEC §7. Report the `unpackable` rate in the
test output. Target: **0 violations**.

**3. `src/__tests__/golden-june.test.ts` — regression lock.**

Commit the corrected June 2026 rosters for NKPL (49 rows) and APTUS (36 rows) as fixtures,
with expected Reference and Official rows for every employee. Any change to a rupee figure
must be an explicit, reviewed fixture update.

Seed the expectations by **recomputing from the spec**, not by copying the 2026-07-07 `.xls`
exports — those predate the statutory rework and are known to disagree (see TICKET-15).

**4. Targeted regression tests, one per ticket.**

| Test | Asserts |
|---|---|
| `special_is_month_length_invariant` | Special `monthlySalary` identical at `D = 28` and `D = 31` (T-01) |
| `month_days_from_label` | Feb 2026 → 28, Feb 2028 → 29, Jul 2026 → 31 (T-03) |
| `unskilled_backfills_day_rate` | `{Unskilled, M:9600, r:0}` → `r === 320`, `gross > 0` (T-04) |
| `seed_rosters_store_base_salary` | Both bundled rosters pass the `M ≈ r × 30` guard (T-05) |
| `advance_always_reduces_net` | `advance: 1500` **and** `advance: -1500` both reduce net by ₹1,500 (T-06) |
| `official_attendance_capped` | `0 <= attendance <= 26` for all rows, PF on and off (T-07) |
| `bidyut_ray_wage_board_basic` | basic `12584`, pf `1510.08`, gross `23866.92`, net `22226.84` (T-08) |
| `official_net_is_computed` | Recompute net from components; must equal the reported net (T-09) |
| `category_survives_salary_change` | Changing `monthlySalary` never changes `category` (T-11) |
| `special_renders_on_official_sheet` | All 6 Specials build without throwing (T-12) |

**5. Delete the tautological assertion** in `issue4_e2e_month_proof.test.ts` and replace it
with an independent recomputation:

```ts
const recomputed = offRow.grossPayable - offRow.pf - offRow.esi
                 - offRow.professionalTax - offRow.advance - offRow.otherDeduction;
expect(recomputed).toBeCloseTo(offRow.netPayable, 2);      // internal consistency
expect(offRow.netPayable).toBeCloseTo(refRow.netPayable, 2); // net equality
```

Both assertions are required. The first is what was missing.

## Acceptance criteria

- [ ] `npm test` runs green from a clean `git clone` + `npm install`.
- [ ] The invariant suite runs 200,000 cases with 0 violations of I1–I10 and prints the `unpackable` rate.
- [ ] Golden-master fixtures exist for both June rosters and are derived from the spec, not the stale exports.
- [ ] All 11 targeted tests exist and pass.
- [ ] Each targeted test **fails** when its corresponding fix is reverted — verify this individually.
- [ ] CI blocks merge on a red suite.
