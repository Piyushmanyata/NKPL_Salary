# SPEC: Attendance, Reconciliation and Double Shifts

**Status:** authoritative for everything in this document.
Supersedes `CONTEXT.md` where they conflict. Does **not** change `docs/SPEC-payroll.md`
except at the one boundary named in §8 (`extraDays`).

Derived from the grill session of **2026-08-03**, which resolved every ambiguity against
four real files:

| Role | Company | File |
|---|---|---|
| Manual Sheet | NKPL | `ATTANDANCE 2026 (3).xlsx`, sheet `JULY 2026` |
| Biometric Export | NKPL | `31AttendanceRecord.xls`, sheet `AttendanceRecord` |
| Manual Sheet | APTUS | `Attendance sheet Daily Basis 2026-27.xlsx`, sheet `MAY` |
| Biometric Export | APTUS | `001_2026_5_MON.XLS`, sheet `Logs` |

---

## 1. Notation

| Symbol | Meaning |
|---|---|
| `D` | calendar days in the pay month (28–31), from the month label |
| `d` | a day number, `1 ≤ d ≤ D` |
| `sheet[d]` | Manual Sheet verdict for day `d` — one of `-` `0` `1` `2` |
| `punch[d]` | array of `HH:MM` strings from the Biometric Export for day `d` |
| `dec[d]` | human decisions recorded for day `d` |
| `Dw` | Days Worked (Reference attendance input) |
| `Xd` | Extra Days |

---

## 2. The two sources

### 2.1 Manual Sheet — the presence authority

The typed attendance workbook. **It alone decides present vs absent.** (ADR-0006)

Two formats, both already detected in `src/attendance.ts`:

| Format | Detected by | Cell vocabulary |
|---|---|---|
| `double-shift` (NKPL) | row 2 has `A`/`B` at cols 3,4 **and** `Number(row0[3]) === 1` | `1` present · `0` absent · blank absent · **`2` double shift** |
| `aptus-daily` (APTUS) | row 2 `[0]==="S. NO."`, `[1]==="NAME OF EMPLOYEE"`, `Number(row2[4])===1` | `P` present · `A` absent · blank absent · **`2` double shift** |

The `A`/`B` column pair in the NKPL format is a **day/night roster**, not a double-shift
marker. Verified: in `JULY 2026`, **zero** days have both `A` and `B` marked.

**APTUS uses no `2` today** (histogram is exactly `P`×719, `A`×138, blank×135). The `2` rule
is still specified for `aptus-daily` so both companies behave identically the day it is used.

### 2.2 Biometric Export — evidence, never authority

The device punch log. Supplies punch times, shift, duration. **It never decides presence.**

| Format | Detected by |
|---|---|
| `standard` (NKPL) | header row 3 contains `YYYY/MM/DD` date columns from index 4 |
| `repeating-logs` (APTUS) | `rows[0][0] === "List of Logs"` and `rows[4][0] === "No :"` |

**Why it is not the authority.** Measured on NKPL July 2026, 1,147 employee-days:

| | count |
|---|---|
| both sources agree | 1,064 |
| biometric absent, sheet present | **83** |
| biometric present, sheet absent | **0** |

73 of the 83 are **single-punch days** — the device recorded one scan of a normal shift.
Treating them as absences removes 83 days of pay. Treating *any* punch as presence instead
overshoots the sheet by 39 days, creates 49 conflicts the other way (almost all a lone
`08:0x` scan on a **Sunday**), and pushes six people over the Month Threshold into a Sunday
Package they did not earn.

A single punch is not interpretable in isolation:

| Punch | Truth |
|---|---|
| `SISIR HEMRAM d6 ["20:02"]` — weekday, normal shift 08→20 | missing OUT scan; **he worked** |
| `SANJAY DAS d5 ["08:04"]` — **Sunday**, nothing after | gate scan; **he did not work** |

Identical shape, opposite meaning. The distinguishing information is not in the punch data.

---

## 3. Day resolution

For each employee and each day `d`, in this order. **First rule that applies wins.**

```
R1  dec[d] contains "P"          → present = true          (manual override)
R2  sheet[d] is "1" or "2" or "P"→ present = true
R3  sheet[d] is "0" or "A" or "-"→ present = false
R4  no Manual Sheet loaded at all→ present = punch[d].length > 0
```

`R4` is the biometric-only fallback: a month where the operator uploaded only the device
export still produces usable numbers.

**Double shift for day `d`:**

```
doubleShift[d] = (sheet[d] === "2" || dec[d] contains "D") && !(dec[d] contains "d")
```

`D` = set by hand in the UI. `d` = cleared by hand, overriding a `2` in the sheet.
A double shift **requires presence** — if `present === false`, `doubleShift` is forced false.

**Leave type** is unchanged from today: `dec[d]` may contain `a` (approved) or `u`
(unapproved). Unapproved absence still costs two days (`CONTEXT.md` → Unapproved Absence).

---

## 4. Short Stay — no longer an absence

**Changed rule.** (ADR-0005) `CONTEXT.md` currently says a short stay is *"treated as absent
unless overridden"* and that *"a single punch alone is not present."* Both clauses are
withdrawn.

```
isShortStay[d] = punch[d].length > 0 && duration[d] < 5
```

`isShortStay` is now **presentational only** — a highlight, never an input to presence,
`Dw`, the Month Threshold, or any money. Presence comes from §3.

### 4.1 Duration and the ambiguous span

`analyzePunches` currently mis-computes days holding two *different* shifts' edges.
`ANUPAM MAHESH d8 ["00:21","23:19"]` → first hour `0` ⇒ Night ⇒ raw span 22.97h ⇒ `>12` ⇒
`24 − 22.97` = **1.03 h**. Those are the tail of d7's night shift and the start of d9's.

No two-punch model can resolve this. Therefore:

```
raw = (max(minutes) - min(minutes)) / 60
if (shift === "Night" && raw > 12) {
  duration = 24 - raw
  ambiguousSpan = (duration < 5)     // a wrap this extreme is not distinguishable
                                     // from two separate shift edges
} else {
  duration = raw
  ambiguousSpan = false
}
```

`ambiguousSpan` days are **excluded from the `avgHours` average** and shown with a distinct
marker. They cost no money, because presence no longer depends on duration.

---

## 5. Reconciliation

### 5.1 The join — roster as hub

Both files join **to the roster**, never to each other. (ADR-0009)

- **Biometric → roster:** by stored **Biometric ID**, the device's `Employee ID`
  (NKPL: `3, 4, 5, 7, …`; APTUS: `1, 4, 5, 7, 11, …`). Exact, permanent, stored once.
- **Manual Sheet → roster:** by name, as today.

Name matching cannot carry this. Measured with the current `namesMatch`:

| | clean 1:1 |
|---|---|
| NKPL | 23 / 44 |
| APTUS | 24 / 32 |

Unrecoverable by any string algorithm — `SK SAJAMAL(ALI)` ↔ `Ali Da`, `NITISH KUMAR` ↔
`Nitish Yadab`, `MIRA DI` ↔ `MIRA PRASAD`, `Chapa Patra` ↔ `champapatra`. The APTUS device
also **truncates names to 12 characters** (`HIMANGSHU KA`, `RAJESH KUMAR`, `AYODHYA DE`).

Fuzzy matching is demoted to a **suggestion engine** inside the mapping UI. It never
silently establishes a join.

### 5.2 Conflict classes

Every disagreement is classified and surfaced. Nothing is auto-applied to pay.

| Kind | Condition | July 2026 NKPL count |
|---|---|---|
| `sheet-present-no-punch` | present per §3, `punch[d].length === 0` | 10 |
| `sheet-present-short-stay` | present per §3, `isShortStay[d]` | 73 |
| `punched-sheet-absent` | absent per §3, `punch[d].length > 0` | 49 |
| `double-no-corroboration` | `doubleShift[d]`, biometric span < 16 h or no punches | 4 |
| `missing-biometric` | roster person with no mapped biometric row | 7 |
| `unmapped-biometric` | biometric row mapped to nobody | 1 |

`missing-biometric` is **normal, not an error** — NKPL's two guards, the cook and three cash
workers have no device row at all. It must never zero anyone.

`double-no-corroboration` fires on all four real doubles, because both NKPL guards are
absent from the device. It is informational.

---

## 6. Exclusions

Some people appear in the Manual Sheet but are not paid through this app — NKPL's
`GOUTAM MALIK`, `PINTU POREL`, `PANCHA MALIK` (CASH WORKER).

An exclusion is:

- **per company**, not per month
- **persisted**, so it applies to every future upload without re-doing it
- **soft and reversible** — shown in a collapsed `Excluded (n)` section with a Restore action
- **never a roster change.** Excluding someone in the attendance checker must not delete,
  modify or hide their payroll record. Roster deletion stays on the payroll screen.

Excluded people are omitted from all stats, all conflict counts and the sync.

---

## 7. Sunday Package and Security

**Unchanged and reaffirmed:** Security Employees receive **no automatic Sunday package** —
no auto-paid Sunday, no auto-granted Extra Day. This applies to **both companies**. (ADR-0008)

This deliberately diverges from the APTUS Manual Sheet, which grants its guard
`Somnath Parui` five Sunday days on top of a full 31-day month (`P=31 SUN=5 TOT=36`). The app
computes **31**. The divergence is surfaced, not reproduced.

The app already reproduces APTUS's arithmetic for ordinary workers
(`Rajesh Kr Singh: P=25 SUN=5 TOT=30` → app 30 ✓; `Debnath pal: P=17 SUN=0 TOT=17` → app 17 ✓).

Also unresolved in the source data, treated as a **sheet error and not modelled**:
`Gopal Ghosh: P=1, A=1, SUN=5, TOT=6` — one present day, five Sunday days.

---

## 8. Extra Days — the payroll boundary

This is the **only** change to `docs/SPEC-payroll.md` behaviour.

A double shift pays exactly one Extra Day: `(salaryPerDay + bonusPerDay) × 1`, i.e. it flows
through the existing `performanceBonus` term. **No new money field is introduced.**

Extra Days granted at sync:

```
Special           → 0
Security          → doubleShiftDays
everyone else     → sundaysEligible + doubleShiftDays
```

The Security line is a **change**: today `src/App.tsx` hard-zeros `extraDays` for Security at
sync, which would wipe every double shift, since in the real data **only guards do doubles**.

Consequences, both intended:

- A **non-Security** person working a double on a Sunday gets **2** Extra Days — one for the
  Sunday double-pay entitlement, one for the second shift. They are separate entitlements.
- A **Security** person working a double on a Sunday gets **1** — the double only, since the
  Sunday Package is denied (§7).

Worked example, NKPL July 2026 — the two guards run a Sunday rota, each covering both shifts
when it is their turn:

| Guard | present | doubles | Sundays worked | `Dw` | `Xd` |
|---|---|---|---|---|---|
| MONAJ CHATTERJEE | 29 | 2 (d12, d26) | 2 | 29 | 2 |
| PARIMAL GHOSH | 29 | 2 (d5, d19) | 2 | 29 | 2 |

`daysWorked` is still clamped to `D` by `clampDays`. A double **must not** be added to
`daysWorked` — day 32 in a 31-day month silently vanishes and breaks the absent-deduction
arithmetic.

---

## 9. Persistence

### 9.1 Why, and the size budget

Today nothing about attendance survives a page refresh — the grid, every override, every
leave call, all of it. Only `daysWorked` and `extraDays` persist. The evidence is discarded
and the conclusion kept.

Storing `AttendanceEmployee[]` verbatim costs **182.5 KB/month** — of which **95.5 KB is
repeated JSON key names** and 10.5 KB is repeated Sunday reason sentences. Nearly all of it
is derived data.

Store **inputs and decisions only**; recompute the rest on load. (ADR-0007)

| | per month | both companies / year | 10 years |
|---|---|---|---|
| verbatim | 182.5 KB | 5.0 MB | 49.5 MB |
| **this spec** | **11.4 KB** | **316 KB** | **3.1 MB** |

11.4 KB is the same order as the existing 12 KB salary record.

### 9.2 Keys

| Key | Holds | Write cadence |
|---|---|---|
| `attendance/<COMPANY>/<Month Label>` | one month's attendance record | on upload / on decision |
| `attendance_meta/<COMPANY>` | biometric-ID map + exclusions | rarely |

**Attendance must not be merged into `monthly_salary/...`.** That record is rewritten by a
debounced auto-save on every salary keystroke; folding attendance in would push 223 KB per
flush instead of 12 KB.

### 9.3 Record shapes

```ts
/** attendance/<COMPANY>/<Month Label> */
export type AttendanceRecordV1 = {
  v: 1;
  c: string;              // company, e.g. "NKPL"
  m: string;              // month label, e.g. "July 2026"
  u: string;              // updatedAt, ISO
  e: AttendanceRowV1[];
};

export type AttendanceRowV1 = {
  i: string;              // roster employee id when mapped, else a stable synthetic key
  b?: string;             // biometric device id, when mapped
  n: string;              // name as it appeared in the source, for display
  d?: string;             // department as it appeared
  sec?: 1;                // isSecurity at parse time
  /**
   * Punches. D slots joined by ";". Each slot is "HHMM" values joined by "-",
   * empty string for a day with no punches.
   *   "0805-2009;;0802-2004"  = d1 two punches, d2 none, d3 two punches
   */
  p: string;
  /**
   * Manual Sheet verdicts. Exactly D characters, one per day:
   *   "-" no manual sheet / blank cell   "0" absent   "1" present   "2" double shift
   */
  s: string;
  /**
   * Human decisions, sparse. Key is the day number as a string. Value is a
   * concatenation of flag characters:
   *   "P" manual present override   "a" leave approved   "u" leave unapproved
   *   "D" double shift set by hand  "d" double shift cleared by hand
   *   "R" conflict reviewed and accepted
   */
  o?: Record<string, string>;
};

/** attendance_meta/<COMPANY> */
export type AttendanceMetaV1 = {
  v: 1;
  c: string;
  u: string;                       // updatedAt, ISO
  map: Record<string, string>;     // biometric device id -> roster employee id
  excluded: string[];              // normalizeKey(name) values
};
```

Rules:
- `p` and `s` are always exactly `D` slots / `D` characters. Pad, never truncate.
- `o` omits any day with no decisions. An empty `o` is omitted entirely.
- Unknown `v` values load as "no saved attendance"; never crash, never guess.

### 9.4 A saved month is a record, not a cache

Re-uploading a file for a month that already has saved attendance **must ask for
confirmation** before overwriting resolved conflicts and manual decisions. Same principle as
the Rate Card deliberately not re-applying to a month that already has data.

---

## 10. Upload

Two **explicit slots**: `Biometric Export` and `Manual Sheet`. Format detection runs as a
**validator**, not a router — a file whose detected format's kind disagrees with its slot is
rejected with a message naming both.

```
standard, repeating-logs   → kind "biometric"
double-shift, aptus-daily  → kind "manual"
```

Either slot may be empty:

| Biometric | Manual | Result |
|---|---|---|
| yes | yes | full reconciliation |
| no | yes | presence from sheet, no evidence layer, no conflicts |
| yes | no | `R4` fallback — presence from punches, banner warning |
| no | no | nothing to do |

### 10.1 Worksheet selection must not guess

`getBestWorksheet` currently falls back to `SheetNames[0]`. The NKPL manual workbook has four
month tabs (`JULY 2026`, `JUN 2026`, `MAY 2026`, `APRIL 2026`); a label that fails to parse
silently imports **July's attendance into whatever month is being edited**.

New behaviour: month-label match → `Logs`/`Attendance` by name → **throw**, with a message
listing the workbook's sheet names. Never index `[0]` blindly. The chosen sheet name is
returned and displayed.

---

## 11. Invariants

Testable statements. A violation is a bug.

| | Invariant |
|---|---|
| **A1** | `isShortStay` never changes `isPresent`, `Dw`, `meetsMonthThreshold` or any money figure. |
| **A2** | Removing a Manual Sheet from an upload never *increases* anyone's `Dw`. |
| **A3** | `doubleShift[d] === true` implies `present[d] === true`. |
| **A4** | Security never receives an auto-paid Sunday or an auto-granted Sunday Extra Day, in either company. |
| **A5** | `Xd` = `sundaysEligible + doubleShiftDays` for non-Security non-Special; `doubleShiftDays` for Security; `0` for Special. |
| **A6** | `Dw ≤ D` always. A double shift never increments `Dw`. |
| **A7** | An excluded employee contributes to no stat, no conflict count and no sync. |
| **A8** | A person with `missing-biometric` keeps the Manual Sheet's `Dw` in full. |
| **A9** | `encode(decode(x)) === x` for every `AttendanceRecordV1`. |
| **A10** | A month with saved attendance is never silently overwritten by an upload. |
| **A11** | `p` and `s` always have exactly `D` slots / characters after decode. |
| **A12** | A biometric row whose device id is unmapped is never joined to a roster row by name. |

---

## 12. Out of scope

Explicitly **not** part of this work:

- Decomposing `src/App.tsx`. Separate change, after this lands.
- Any change to `salary.ts` arithmetic beyond the `extraDays` value fed to it.
- Backfilling or recomputing already-filed months. Removing the 5-hour rule changes numbers
  only when attendance is **re-parsed**; stored `daysWorked`/`extraDays` do not move.
- Modelling APTUS's `SUNDAY` / `TOTAL PRESENT` columns as authoritative.
- Punch-based inference that *pays*. Punch evidence may only ever raise a flag.
