# SPEC: Payroll Calculation

**Status:** Authoritative. Supersedes any conflicting statement in `CONTEXT.md`.
**Resolved:** 2026-07-26 grill session.
**Applies to:** NKPL and APTUS. Identical rules; only rosters and rates differ.

This document defines *exactly* what the payroll engine computes, in execution order.
Every quantity below is either an **input**, or **derived** by a formula stated here.
Nothing is left to implementation choice. Where a rule was previously ambiguous, the
resolution and the file/line it replaces are noted inline.

---

## 1. Notation

| Symbol | Meaning |
|---|---|
| `D` | Calendar days in the pay month (28, 29, 30 or 31) |
| `Dw` | Days Worked — manual Reference input, `0 ≤ Dw ≤ D` |
| `Xd` | Extra Days — manual extra-work units |
| `r` | Salary per day (Reference rate) |
| `b` | Bonus per day |
| `M` | Monthly salary (base, **excluding** daily bonus) |
| `p` | Basic share, `0.50 ≤ p ≤ 1.00` |
| `A` | Official Attendance, `0 ≤ A ≤ 26` |

All money is rounded to **2 decimal places** at every stored field.
Net equality is asserted with a tolerance of **₹0.01**.

---

## 2. Employee model

### 2.1 Category — exactly four values

`Category = "Unskilled" | "Semi-skilled" | "Skilled" | "Special"`

These are **mutually exclusive**. `Special` is a Category, not a flag.
The previous `isSpecial: boolean` overlay is removed.

### 2.2 Rate anchoring by Category

This is the single most important table in this document.

| Category | Anchor (source of truth) | Derivation | Does full-month pay change with `D`? |
|---|---|---|---|
| **Unskilled** | `r` | `M = D × r` | **Yes.** 28-day month pays `28r`, 31-day month pays `31r`. |
| **Semi-skilled** | `M` | `r = M / D` | No. `M` is fixed; `r` floats inversely with `D`. |
| **Skilled** | `M` | `r = M / D` | No. `M` is fixed; `r` floats inversely with `D`. |
| **Special** | `M` | `r = 0` — **no day rate exists** | No. `M` is invariant to `D` and to attendance. |

### 2.2.0 Which anchors are *typed*

The table above states the derivation. This states what a user enters.

| Category | Typed | Derived (read-only) |
|---|---|---|
| **Unskilled** | `r`, `b` | `M = D × r`, `T = M + D × b` |
| **Semi-skilled / Skilled** | `M`, `T` | `r = M / D`, `b = (T − M) / D` |
| **Special** | `M`, `T` | `r = 0`, `b = 0` |

`T` (`totalSalary`) is a **stored, optional** anchor on `EmployeeInput` for the three
fixed-monthly categories. It is never stored for Unskilled, whose total stays derived.

Rationale: `M` and `T` drive different money. `M` sets Reference `earnedSalary` → `basicSalary`
→ the PF gate. `T` sets the Official opt-out basic floor `max(21100 | 15100, 0.51 × T)` (§6.3)
and `proratedTotal26`. Because PF is always off for Special, `0.51 × T` is the **only** lever on a
Special employee's Official basic — so `T` must be enterable independently of `M`.

`T ≤ M` means "no bonus" and is stored as absent. When `T` is absent the engine falls back to
`T = M + D × b`, so every pre-existing roster computes bit-identically.

**Special keeps `b = 0`.** A `T > M` on a Special row raises the Official basic without adding any
Reference earnings — `dailyBonus` and `earnedBonus` stay `0`, so Reference gross remains `M`.

*(Replaces the read-only `<strong>` readouts at `App.tsx:1505-1514`, which left `M` — the anchor for
three of the four categories — with no editor at all, while exposing a `salaryPerDay` input that
`calculateSalary` unconditionally overwrote.)*

#### 2.2.0.1 Per Day / Per Month input switch

The table above is the **default** input form, not a restriction. Settings carries a
**Per Day / Per Month** toggle that lets either form of the same salary be typed for any
non-Special category; the UI converts with `M = D × r` (`monthlyFromDaily` /
`dailyFromMonthly` in `salary.ts`) and stores the Category's anchor unchanged:

| Category | Typed per month | Typed per day |
|---|---|---|
| **Unskilled** | stores `r = M / D`, allowance stores `b = allowance / D` | stores `r`, `b` (default) |
| **Semi-skilled / Skilled** | stores `M`, `T = M + allowance` (default) | stores `M = D × r`, allowance on `T` preserved |
| **Special** | stores `M`, `T` — no day rate exists, so the toggle is not shown | n/a |

Anchoring, derivation and every downstream formula are untouched: the toggle changes only
which number the user types. Round-trip equality is asserted in
`src/__tests__/salary_input_mode.test.ts`.

### 2.2.1 Rate back-fill is a ONE-TIME repair, not a per-calculation step

When a stored employee is missing the anchor their Category requires, the missing value is
back-filled **once**, at load/migration, and then persisted:

| Category | Missing | Back-fill (once, at load) |
|---|---|---|
| Unskilled | `r` absent/0, `M > 0` | `r = M / D`, persist `r`. `M` is thereafter derived from `r`. |
| Special | `M` absent/0, `r > 0` | `M = D × r`, persist `M`. `r` is thereafter discarded. |
| Semi-skilled / Skilled | `M` absent/0, `r > 0` | `M = D × r`, persist `M`. |

**This must not run inside `calculateSalary`.** If the Unskilled back-fill executes on every
calculation, `r` is re-derived from `M` each month and the employee silently behaves as
fixed-monthly — the exact opposite of the Unskilled rule. Verified by fuzz: 1,264 of 1,264
month-length violations were Unskilled rows with no stored day rate.

After the one-time repair, `calculateSalary` **asserts** its anchor is present:

| Category | Assertion | On failure |
|---|---|---|
| Unskilled | `r > 0` | Flag the row `missingRate`; do not compute; surface in the UI |
| Semi-skilled / Skilled / Special | `M > 0` | Flag the row `missingRate`; do not compute; surface in the UI |

An employee is never silently zeroed. *(Replaces the unconditional overwrite at `salary.ts:95`,
which produced `M = 0` and a ₹0 salary whenever `r` was absent.)*

**Special constraints.** For `Category = "Special"`:
- `M` is mandatory. If only a day rate is stored, `M` is back-filled once per §2.2.1.
  *(Fuzz: 9,270 of 9,270 zero-gross rows were Specials carrying a day rate but no `M`.)*
- `r` is not stored and not displayed after migration. Any stored value is ignored.
- `b` must be `0`. Any stored value is ignored.
- `Xd` is forced to `0`.
- `Dw` is forced to `D`; `absentDays = 0`; `absentDeduction = 0`.
- `pfOptIn` and `esiOptIn` are forced to `false`.
- Professional Tax **does** apply (confirmed against the June sheet: Sonal Goenka, ₹200).
- `specialBonus` is permitted.

### 2.3 Payroll input flags

| Field | Type | Rule |
|---|---|---|
| `pfOptIn` | `boolean` | Employee-level opt-in. Forced `false` for Special and when full-month basic > ₹15,000. |
| `esiOptIn` | `boolean` | Employee-level opt-in. Forced `false` for Special. Independent of `pfOptIn`. |

### 2.4 Deduction sign convention

`advance ≥ 0` and `otherDeduction ≥ 0`. Both are **stored positive** and **always subtracted**.
A negative input is clamped to `0` at the boundary. The UI renders them in a deductions column
with a leading minus; the sign is presentation only and never reaches the engine.

---

## 3. Month frame

`D` is derived from the selected month label (e.g. `"June 2026" → 30`), not from a constant.
*(Replaces `WORKING_DAYS = 31` at `salary.ts:3`, which defaulted every month to 31 days.)*

`D` is clamped to `[28, 31]`.

---

## 4. Manual day inputs

`Dw` and `Xd` are entered directly for each employee-month. `Dw` is clamped to `[0, D]`;
`Xd` is a non-negative count of approved extra-work units and is forced to `0` for Special.
There is no punch import, attendance workbook, biometric mapping, Sunday package, double-shift
inference, reconciliation pass, or automatic attendance synchronization.

When a new month is opened, the existing roster is carried forward while `Dw` resets to `D`
and `Xd` resets to `0`. Previously saved month records remain unchanged.

---

## 5. Reference Sheet — ordered calculation

Given `D`, and the Category-resolved `r`, `M`, `b`, `p`:

```
 1  totalSalary      = M + (D × b)

 2  absentDays       = Special ? 0 : max(0, D − Dw)
 3  absentDeduction  = Special ? 0 : r × absentDays

 4  earnedSalary     = Special ? M : max(0, M − absentDeduction)
 5  earnedBonus      = Special ? (D × b) : (Dw × b)
 6  proratedTotal    = earnedSalary + earnedBonus

 7  basicSalary      = min(earnedSalary, earnedSalary × p)
 8  remainder        = max(0, proratedTotal − basicSalary)
 9  hra              = remainder × 0.70
10  travelAllowance  = remainder × 0.30

11  performanceBonus = (r + b) × Xd
12  specialBonus     = max(0, manual input)

13  grossPayable     = basicSalary + hra + travelAllowance + performanceBonus + specialBonus
```

**Note on step 7.** `p` is applied to `earnedSalary` only — the earned daily bonus flows
entirely into the HRA/TA remainder. Effective basic as a share of gross is therefore lower
than `p` (e.g. GURU PRASAD PATRA: `p = 70%`, basic/gross = 52%). This is intentional and
matches the June sheets.

### 5.1 Statutory (Reference)

```
14  fullMonthBasic = M × p

15  pfEligible  = Category !== "Special"
                  && pfOptIn !== false
                  && fullMonthBasic ≤ 15000

16  employeePf  = pfEligible ? round(0.12 × min(basicSalary, 15000)) : 0    // whole rupee
17  employerPf  = employeePf

18  esiEligible = Category !== "Special"
                  && esiOptIn !== false
                  && (totalSalary ≤ 21000               // package default — ADR-0004
                      || esiOverLimitOptIn === true)   // switched on by hand — ADR-0011

19  rawReferenceEsi = esiEligible ? ceil(0.0075 × earnedSalary) : 0       // pre-alignment baseline
20  referenceEsi    = officialEsi(A*)                                      // final Reference amount
21  employerEsi     = officialEmployerEsi(A*)

22  professionalTax = otherDeduction > 0 ? 0 : wbSlab(grossPayable)   // TDS payers exempt

23  netPayable = grossPayable − employeePf − referenceEsi − professionalTax − advance − otherDeduction
24  totalCost  = grossPayable + employerPf + employerEsi
```

`pfEligible` and `esiEligible` are **independent**. Neither forces the other.

The raw baseline in step 19 reproduces the Source Workbooks (`data/SALARY OLD NKPL.xlsx` col
`X`/`W`, `data/SALARY OLD APTUS.xlsx` col `W`/`V`) to the rupee, but the user-facing Reference
amount is replaced by Main/Official ESI at the selected attendance (`A*`). **ADR-0005** makes
that alignment explicit; ADR-0004 remains the source-arithmetic record. `pfEligible` deliberately
stays on the **full-month** basic `M × p`, not the earned basic the NKPL workbook tests, so PF
status is stable month to month.

**West Bengal Professional Tax slab** (`wbSlab`, on `grossPayable`):

| Monthly wages | Tax |
|---|---|
| ≤ ₹10,000 | ₹0 |
| ₹10,001 – ₹15,000 | ₹110 |
| ₹15,001 – ₹25,000 | ₹130 |
| ₹25,001 – ₹40,000 | ₹150 |
| > ₹40,000 | ₹200 |

---

## 6. Official Sheet — construction

The Official Sheet is a **presentation** of the same take-home on a 26-day wage-board frame.
It has **one** code path. The current `buildOfficialRow` / `buildReferenceOfficialRow` split
is removed — both branches are replaced by the algorithm below.

### 6.1 Wage board

| Wage category | Daily basic | Full 26-day basic | Employee types (display) |
|---|---|---|---|
| Unskilled | ₹400 | ₹10,400 | Cooly, Helper, Peon |
| Semi-skilled | ₹440 | ₹11,440 | Assistant Moulder, Assistant Fitter, Assistant Machineman, Assistant Punchingman, Assistant Cuttingman, Assistant Mistry, Durwan |
| Skilled | ₹484 | ₹12,584 | Moulder, Fitter, Machineman, Punchingman, Cuttingman, Mistry, Clerk, Typist |
| **Special** | *n/a* | *n/a* | Uses the **Skilled** row for the display-only `employeeTypes` / `allowedBasic` columns. Its basic comes from the opt-out formula in 6.3. |

`wageCategory` is taken **directly from `Category`**. It is never re-guessed from salary bands.
*(Removes the band-guessing fallback at `officialSheet.ts:69-78`, which could silently
reclassify an employee whose Category string did not match exactly.)*

### 6.2 Official Attendance frame

One frame for **every** employee, PF on or off:

```
absentDays = max(0, D − Dw)                    // from the CALENDAR frame
A_max      = clamp(26 − absentDays, 0, 26)
A_min      = Dw > 0 ? 1 : 0
```

*(Replaces `officialSheet.ts:149`, where the PF-off path set `attendance = row.daysWorked`
uncapped — producing Official attendance of 30, 30, 29 and 27 for GURU PRASAD PATRA,
Anupam Mahesh, SAGAR CHANDRA MAJHI and S K SAJAMAL on the real June sheet.)*

### 6.3 Official basic — as a function of `A`

```
officialBasic(A) =
    pfEligible                → A × wageBoardDaily[wageCategory]
    else if !esiEligible      → (max(21100, 0.51 × totalSalary) / 26) × A
    else                      → (max(15100, 0.51 × totalSalary) / 26) × A
```

Two rules, both changed:

1. **The wage board wins whenever PF is on.** The opt-out elevation applies only when PF is
   off. *(Replaces `officialSheet.ts:206-211` and `:236-242`, where a PF-on / ESI-off employee
   such as BIDYUT RAY was pushed to a ₹21,100 opt-out basic.)*
2. **There is no ₹15,000 cap on the displayed basic.** ₹15,000 is an EPF *contribution*
   ceiling, applied only inside the PF formula. *(Removes `officialSheet.ts:212-214` and
   `:243-245`.)*

### 6.4 Official statutory — as a function of `A`

```
officialPf(A)  = pfEligible ? 0.12 × min(officialBasic(A), 15000) : 0

officialEsi(A) = (Category !== "Special" && esiOptIn !== false && officialBasic(A) ≤ 21000)
                 ? 0.0075 × officialBasic(A) : 0                    // base is BASIC — ADR-0002
```

Official ESI is **never** forced on merely because PF is on.
The final Reference ESI is set to `officialEsi(A*)`; Official PF may still differ from Reference PF.

### 6.5 Net Equality Packing

```
referenceNetBeforeEsi = grossPayable − employeePf − professionalTax − advance − otherDeduction

targetGross(A) = referenceNetBeforeEsi
               + officialPf(A) + professionalTax
               + advance + otherDeduction

packable(A)    = targetGross(A) ≥ officialBasic(A)
```

Walk `A` from `A_max` down to `A_min` and take the **first** `A` where `packable(A)` is true.

- If some `A` packs → build the row with that `A`.
- If **no** `A` packs → set `A = A_min`, mark the row `unpackable: true`, and assemble it
  with **`officialBonus = 0`** (§6.6). An `unpackable` row is rendered with a visible warning
  and **blocks export** of the sheet. Its `officialNet` is still computed honestly from its
  own components and will differ from `referenceNet` — that difference *is* the warning. It
  must never print a `netPayable` its components do not produce.

  Forcing `officialBonus = 0` on unpackable rows keeps every component non-negative; without
  it, `bonus = targetGross − basic` goes negative whenever `targetGross < basic`. Verified by
  fuzz: 9,775 of 9,775 negative-component rows were unpackable.

### 6.6 Component split

With the chosen `A`:

```
officialBasic  = officialBasic(A)
proratedTotal₂₆ = (totalSalary / 26) × A
base            = min(proratedTotal₂₆, targetGross)

remainder       = max(0, base − officialBasic)
officialHra     = remainder × 0.70
officialTa      = remainder − officialHra
officialBonus   = unpackable ? 0
                : targetGross − (officialBasic + officialHra + officialTa)

officialGross   = officialBasic + officialHra + officialTa + officialBonus
officialNet     = officialGross − officialPf − officialEsi
                              − professionalTax − advance − otherDeduction
```

For a packable row, `officialBonus ≥ 0` is guaranteed: `packable(A)` gives `targetGross ≥ officialBasic`, and
`base ≤ targetGross` gives `remainder ≤ targetGross − officialBasic`.

`officialNet` is **computed**, never copied.
*(Replaces `officialSheet.ts:180`, `netPayable: row.netPayable`, which reported a net the
components did not produce in 13.1% of 200,000 fuzzed inputs.)*

---

## 7. Invariants

These are hard assertions. A build that violates any of them is broken.

| # | Invariant | Tolerance |
|---|---|---|
| **I1** | `officialNet === referenceNet` for every employee-month **not** flagged `unpackable` | ₹0.01 |
| **I2** | `officialNet` is computed from `officialGross` and the Official deductions — never assigned from Reference | exact |
| **I3** | `0 ≤ A ≤ 26` for every employee, PF on or off | exact |
| **I4** | Every component (`basic`, `hra`, `ta`, `bonus`, `gross`) is `≥ 0` on both sheets | exact |
| **I5** | `Category === "Special"` ⟹ `Dw === D`, `absentDays === 0`, `Xd === 0`, `pf === 0`, `esi === 0` on both sheets | exact |
| **I6** | `Category === "Special"` ⟹ `Xd === 0` and `performanceBonus === 0` | exact |
| **I7** | An employee whose Category anchor is present never produces `grossPayable === 0` when `Dw > 0`. An employee whose anchor is absent is flagged `missingRate` and never computed | exact |
| **I8** | `pfEligible` and `esiEligible` are independent — neither implies the other | exact |
| **I9** | `Category` is preserved end-to-end; it is never re-derived from a salary band | exact |
| **I10** | Changing `D` (28→31) leaves `M` unchanged for Semi-skilled, Skilled and Special; changes `M` proportionally for Unskilled **with a stored day rate**. Back-fill must not run per-calculation (§2.2.1) | exact |

---

## 8. Worked example — BIDYUT RAY (NKPL, June 2026)

Inputs: `Category = Skilled`, `M = 15,990`, `b = 257`, `p = 0.70`, `D = 30`, `Dw = 30`,
`Xd = 0`, `pfOptIn = true`, `esiOptIn = false`, `advance = 0`, `otherDeduction = 0`.

**Reference**

| Step | Value |
|---|---|
| `r = M / D` | 533.00 |
| `totalSalary = M + 30b` | 23,700.00 |
| `earnedSalary` | 15,990.00 |
| `earnedBonus = 30 × 257` | 7,710.00 |
| `basicSalary = 15,990 × 0.70` | 11,193.00 |
| `remainder` | 12,507.00 |
| `hra` / `ta` | 8,754.90 / 3,752.10 |
| `grossPayable` | 23,700.00 |
| `fullMonthBasic = 15,990 × 0.70 = 11,193 ≤ 15,000` → PF on | |
| `employeePf = 0.12 × 11,193` | 1,343.16 |
| `esi` (opted out) | 0.00 |
| `professionalTax` | 130.00 |
| **`netPayable`** | **22,226.84** |

**Official** — `absentDays = 0` → `A_max = 26`. PF is on, so the wage board applies.

| | Current build | **Per this spec** |
|---|---|---|
| `A` | 26 | 26 |
| `officialBasic` | 15,000.00 *(21,100 opt-out, capped)* | **12,584.00** *(26 × ₹484)* |
| `officialPf` | 1,800.00 | **1,510.08** *(0.12 × 12,584)* |
| `officialEsi` | 0.00 | 0.00 |
| `targetGross` | 24,156.84 | **23,866.92** |
| `proratedTotal₂₆ = (23,700/26) × 26` | 23,700.00 | 23,700.00 |
| `base = min(23,700, 23,866.92)` | — | 23,700.00 |
| `remainder` | — | 11,116.00 |
| `officialHra` / `officialTa` | 6,409.79 / 2,747.05 | **7,781.20 / 3,334.80** |
| `officialBonus` | 0.00 | **166.92** |
| `officialGross` | 24,156.84 | **23,866.92** |
| **`officialNet`** | 22,226.84 | **22,226.84** ✓ |

The register now reconciles to the Skilled wage board (₹484 × 26) instead of printing a
basic of ₹15,000 that appears above the ESI threshold while carrying no ESI line.

---

## 9. Open assumptions

Flagged for confirmation; each is implemented as stated unless overridden.

| # | Assumption |
|---|---|
| A1 | Special employees display the **Skilled** wage-board row (`employeeTypes`, `allowedBasic`) on the Official sheet, while their basic comes from the opt-out formula. |
| A2 | Professional Tax applies to Special employees (matches June: Sonal Goenka ₹200, PUNIT SODHANI ₹0 at gross 60,000 — the ₹0 is itself suspect and is raised in `TICKET-15`). |
| A3 | Employer PF mirrors employee PF at 12%, with no 8.33/3.67 EPS split and no admin charges. |
| A4 | Professional Tax is charged on **prorated** gross, not on the full-month package. |
| A5 | `p` (basic share) has a floor of 50% and a ceiling of 100%, defaulting to 70%. |

---

## 10. Verification record (2026-07-26)

This spec was implemented as a reference port and executed before any ticket was written.

### 10.1 Property fuzz — 200,000 seeded cases (`seed = 7`)

Input space: `D ∈ {28,29,30,31}`, all four Categories, `r ∈ {0, 150…3000}`,
`M ∈ {0, 4000…120000}`, `b ∈ {0, 1…500}`, `Dw ∈ [0, D]`, `Xd ∈ {0,1,2,4,8}`,
`p ∈ {50,54,60,70,76,100}`, `pfOptIn`, `esiOptIn`,
`advance ∈ {0, 500, 1500, −1500, 20000}`, `otherDeduction ∈ {0, 100, 15000}`,
`specialBonus ∈ {0, 5000}`.

| | Current `src/HEAD` | This spec |
|---|---|---|
| Cases computed | 200,000 | 200,000 |
| **I1** net equality violations | **33,954 (17.0%)** | **0** |
| **I2** reported net ≠ computed net | **26,276 (13.1%)** | **0** |
| **I3** attendance outside `[0, 26]` | present on every PF-off row | **0** |
| **I4** negative component | 0 | **0** |
| **I5**–**I10** | not enforceable (fields absent) | **0** |
| `unpackable` rate | n/a — silently hidden | 8.47%, all flagged |

The 8.47% `unpackable` rate reflects deliberately absurd fuzz combinations (e.g. ₹20,000
advance plus ₹15,000 other-deduction against a ₹6,000 salary). Real rosters produce zero.

Reproduce with `python3 scripts/reference-oracle.py` (seed 7). That script is the executable
form of this document; where the two disagree, the discrepancy is a bug in one of them and
must be resolved before any ticket is closed.

Three defects were found **in this spec** by the fuzz and corrected before publication:
§2.2.1 (back-fill must be one-time), the Special `M` back-fill, and `officialBonus = 0`
on unpackable rows.

### 10.2 Real rosters — June 2026

| | NKPL | APTUS |
|---|---|---|
| Rows | 49 | 36 |
| `unpackable` | **0** | **0** |
| Net-equality gaps | **0** | **0** |
| Max Official attendance | **26** ✓ | **26** ✓ |
| Rows whose Reference net changes vs the 2026-07-07 export | 38 | 27 |
| Net total change | **−₹2,547.75** | **−₹628.13** |

Largest movers, with attribution:

| Employee | Old net | New net | Δ | Cause |
|---|---|---|---|---|
| PUNIT SODHANI | 45,000.00 | 44,800.00 | −200.00 | P-Tax now charged (T-15 — confirm exemption) |
| Nawneet Sodhani (APTUS) | 79,990.00 | 79,790.00 | −200.00 | P-Tax now charged (T-15 — confirm exemption) |
| S K SAJAMAL | 20,194.18 | 20,155.71 | −38.47 | ESI base moved from Earned Salary to Gross (ADR-0002) |

The long tail of −₹16 to −₹38 deltas is entirely the ESI base correction, which applies to
every ESI-eligible employee. **These deltas do not include the advance-sign correction
(TICKET-06)**, which is computed here against the already-correct 2026-07-07 figures.

> **Reversed 2026-07-29 (issue #24 / ADR-0004).** The ESI base move recorded in the last row above
> has been undone: the Source Workbooks charge ESI on Earned Salary, not Gross, and the workbooks
> are the historical payroll. See §5.1 for the current formulas.

### 10.4 Source Workbook parity — 2026-07-29 (issue #24 / ADR-0004)

Reference statutory arithmetic re-aligned to `data/SALARY OLD NKPL.xlsx` and
`data/SALARY OLD APTUS.xlsx`. Measured against the superseded June goldens:

| | NKPL | APTUS |
|---|---|---|
| Rows whose Reference net changes | 37 of 51 | 29 of 36 |
| Net total change | **+₹452.75** | **+₹418.45** |
| Roster ESI | ₹2,797.48 → **₹2,344** | ₹2,219.78 → **₹1,803** |
| Rows flipping `esiOptIn` | **0** | **0** |
| `unpackable` | **0** | **0** |

Landed alongside it, **TICKET-15 is resolved**: TDS payers are exempt from Professional Tax
(step 21). This restores PUNIT SODHANI to ₹45,000 and Nawneet Sodhani to ₹79,990 — the figures the
2026-07-07 export and the Source Workbooks both show — and reverses the two −₹200 movers in §10.2.
Assumption **A2** above is superseded: Professional Tax applies to Special employees only when they
carry no TDS.

No ESI/PF row moves more than ~₹37. Gross Payable, Professional Tax and Days Worked are unchanged for
every row. The 200k-case fuzz (§10.1) and the net-equality packing fuzz pass unchanged.

### 10.3 What is not yet verified

- The retired attendance checker is intentionally absent; payroll day inputs are covered by the
  manual-input and salary regression tests.
- Whether the deployed build matches `src/HEAD` (TICKET-15).
