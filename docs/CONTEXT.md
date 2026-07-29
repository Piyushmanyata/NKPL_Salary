# NKPL Salary

Payroll domain for NKPL and APTUS: attendance-derived pay inputs, an internal Reference view, and a formal Official (Main) wage sheet that must match take-home.

**Formulas and calculation order are defined in `docs/SPEC-payroll.md`, which is authoritative where this glossary is ambiguous or conflicts.**

## Language

### Sheets and pay

**Reference Sheet**:
Internal working view of pay for a month. Uses calendar days of the month and the employee's economic package (rates, basic share, allowances, bonuses).
_Avoid_: Main sheet, official register, payslip-only view

**Official Sheet** (also **Main Sheet**):
Formal filed wage presentation for the same people and month. Uses a single 26-day wage-board frame for every employee and may re-split components; it is the formal/paid register view.
_Avoid_: Reference, internal sheet

**Net Payable**:
Amount the employee takes home after statutory and other deductions. Reference Net Payable and Official Net Payable must always be equal for the same employee-month, except on an **Unpackable Row** (where net is still computed honestly and export is blocked).
_Avoid_: Gross, take-home before deductions

**Gross Payable**:
Total earnings before PF, ESI, professional tax, advance, and other deductions. Gross may differ between Reference and Official.
_Avoid_: Net, CTC, total cost

**Total Cost**:
Employer burden: gross plus employer PF and employer ESI where applicable.
_Avoid_: Net payable

### People and classification

**Employee**:
A person on a company roster for a pay month, with rates, attendance inputs, and statutory opt-ins.
_Avoid_: User, staff (as a type name)

**Wage Category** (also **Category**):
Closed four-value set, mutually exclusive: **Unskilled** (Labour), **Semi-skilled**, **Skilled**, or **Special**. Category is stored and never inferred from salary bands. It selects rate anchoring and Official wage-board row (Special uses the Skilled display row only).
_Avoid_: Free-text category, salary-band guessing, treating Special as a separate boolean flag

**Labour**:
Unskilled wage category. Day rate (`r`) is the source of truth; monthly figure is derived as `M = D × r` and therefore changes with calendar days.
_Avoid_: Helper-only, cooly-only (those are employee types under Unskilled)

**Semi-skilled / Skilled**:
Wage categories whose **monthly salary (`M`) is fixed** for the month; wage per day is derived as `r = M / D`. Changing calendar days leaves `M` unchanged and floats `r`.
_Avoid_: Treating them as pure daily-wage like Labour; treating them as the only non-Special categories without naming Special as a peer Category

**Special Employee** (Category = `"Special"`):
A **Category**, not a role flag and not a name list. Mutually exclusive with Unskilled, Semi-skilled, and Skilled. Constraints (SPEC §2.2):
- Anchor is fixed monthly salary `M`; no day rate is stored or used after migration (`r` ignored / discarded).
- Full-month pay invariant to calendar days and attendance; Days Worked forced to `D`; Extra Days forced to 0; absent deduction 0.
- Daily bonus `b` ignored (treated as 0); `specialBonus` is permitted.
- PF and ESI forced off; Professional Tax still applies.
- On the Official sheet, display borrows the Skilled wage-board row; money basic comes from the opt-out formula (PF is always off for Special).
_Avoid_: Director-only, name-list specials, `isSpecial` boolean overlay on another category

**Security Employee**:
Guard/security role controlled by a **persisted** `isSecurity` boolean, **orthogonal to Category**. When true: no **automatic** Sunday package — no auto-paid Sunday and no auto-granted Extra Day. A worked Sunday still counts as a normal Present Day only. **Extra Days remain manually editable** and are paid when typed. Previously inferred from the name string and discarded; the field is now stored.
_Avoid_: Semi-skilled-as-proxy for security rules; deriving security from name alone; treating a typed Extra Day on a guard as invalid

### Time and attendance

**Calendar Days**:
Number of days in the pay month (28–31). **Derived from the selected month label** (e.g. `"June 2026" → 30`); never independently editable and never a hard-coded constant. Reference full attendance and rate derivation for monthly-paid staff use this.
_Avoid_: Official attendance, working days (ambiguous), editable days-in-month field

**Official Attendance**:
Attendance figure on the Official Sheet. Derived as `clamp(26 − calendar absences, 0, 26)` for **every** employee regardless of PF status (and may be reduced further only to keep net equality packable, down to a minimum of 1 if Days Worked > 0, else 0).
_Avoid_: Days worked (Reference), present days raw, using Reference `Dw` uncapped when PF is off

**Days Worked**:
Reference attendance input: effective present days after short-stay rules, unapproved penalties, and eligible auto-paid Sundays.
_Avoid_: Official attendance, raw punch count

**Extra Days**:
Count of Sunday double-pay units (and any other approved extra-day units). Each unit pays one full day rate of (wage per day + bonus per day) on Reference. **Forced to 0 for Special only.** Security is never *auto-granted* an Extra Day by the attendance layer, but an operator may type one in — approved extra work is a manual decision.
_Avoid_: Overtime hours, present days

**Present Day**:
A calendar day counted as worked: stay of at least five hours between first and last punch, or a manual present override. A single punch alone is not present.
_Avoid_: Short stay, punched-in

**Short Stay**:
Punched day under five hours (or single punch); treated as absent unless overridden.
_Avoid_: Half day (not modeled unless added later)

**Unapproved Absence**:
Uninformed leave day. Costs two days of pay: the day is already unpaid as absent, and one additional present day is removed.
_Avoid_: Approved leave, sandwich

**Month Threshold**:
Minimum effective present days before Sunday benefits apply: 21 if the month has 31 days, 20 if 30, otherwise round(calendarDays × 20/30). Measured before auto-paid Sundays.
_Avoid_: Official 26, full attendance

**Sandwich Rule**:
For a given Sunday, Sunday benefits are denied only when the employee is absent on both the preceding Saturday and the following Monday. Present on Saturday or Monday is enough to keep benefits available (if the month threshold is also met).
_Avoid_: Requiring both Saturday and Monday present

**Sunday Package**:
Benefits available when month threshold is met, sandwich is not violated, and the person is not Security and not Special: (1) auto-paid Sunday if they did not work that Sunday; (2) one Extra Day if they did work that Sunday. Worked Sunday always counts as one Present Day for pay even when double pay is denied.
_Avoid_: Generic OT

**Auto-Paid Sunday**:
A Sunday counted in Days Worked without a qualifying punch, only when the Sunday Package applies and they did not work that day.
_Avoid_: Double pay, Extra Days

### Money components (Reference)

**Salary Per Day / Wage Per Day**:
Primary rate for Labour; derived for Semi-skilled and Skilled from fixed monthly salary ÷ calendar days. Not used for Special after migration.
_Avoid_: Official daily wage-board rate (400/440/484) as the Reference rate

**Monthly Salary**:
Fixed monthly package for Semi-skilled, Skilled, and Special; for Labour, calendar days × salary per day.
_Avoid_: Gross payable, total salary including all bonuses

**Monthly Allowance**:
The Source Workbook's `Increase in Salary Amount` (col `N`). Equals **Total Salary − Monthly Salary**, and is earned pro-rata as **Bonus Per Day** × Days Worked. Typed directly in the settings panel for the fixed-monthly categories, where Total Salary is the computed readout (`J = K + N`). Zero, not blank, when an employee has no allowance. Never negative — Total Salary can never fall below Monthly Salary.
_Avoid_: Special bonus, performance bonus, treating Total Salary as a second independently typed number

**Total Salary**:
Monthly Salary plus the **Monthly Allowance**. The persisted anchor (`totalSalary`), dropped when it does not exceed Monthly Salary. Sets Bonus Per Day, decides Reference **ESI (Reference)** eligibility, and feeds the Official 51% **Opt-Out Basic** floor.
_Avoid_: Gross payable; a duplicate of Monthly Salary

**Bonus Per Day**:
Standing daily allowance on the rate card, earned proportional to Days Worked on Reference, and included in the pool that feeds HRA/TA after basic. Ignored (0) for Special.
_Avoid_: Performance bonus, special bonus, Extra Days pay

**Basic Share**:
Fraction of earned salary taken as Basic on Reference (configurable per employee, minimum 50%). Remainder of (earned salary + earned daily bonus − basic) splits to HRA and travel.
_Avoid_: Official monthly basic

**HRA / Travel Allowance**:
Reference allowances: 70% and 30% of the post-basic remainder of prorated package (earned salary + earned daily bonus). **Deliberately diverges from the Source Workbooks**, which compute HRA as `earnedSalary × (1 − basicShare)` and pay the earned allowance outright as TA. Gross Payable is the same total under either split, so Net Payable parity is unaffected — only these two displayed component amounts differ (ADR-0004).
_Avoid_: Official HRA/TA packing residual; treating the workbook split difference as a bug

**Performance Bonus**:
Pay for Extra Days: (salary per day + bonus per day) × extra days. Outside the basic/HRA/TA split.
_Avoid_: Special bonus, daily bonus track

**Special Bonus**:
Manual flat amount for the month, outside the basic/HRA/TA split.
_Avoid_: Performance bonus

**Earned Salary**:
Attendance-prorated monthly salary on Reference (full month for Special Employees).
_Avoid_: Gross payable (includes more components)

### Statutory

**PF Opt-In**:
Whether employee PF applies. Forced off for Special Employees and when full-month Reference basic would exceed ₹15,000. When on, contribution is 12% of min(applicable basic, ₹15,000); employer PF mirrors employee PF in this product. The ₹15,000 ceiling is an EPF *contribution* cap, never a cap on displayed Official basic.
_Avoid_: ESI

**ESI (Reference)**:
Employee state insurance on Reference: 0.75% of **Earned Salary**, **rounded up to the whole rupee**, only if **Total Salary** is at most ₹21,000 and the employee is not excluded (special / opted out). Eligibility is a property of the package, so it does not flip because someone missed days this month. Employer ESI is 3.25% of the same base, rounded up the same way, when employee ESI applies. Reproduces the **Source Workbook** formula `=IF(J<=21000, ROUNDUP(O*0.75%, 0), 0)` (ADR-0004, superseding ADR-0002's Reference clause).
_Avoid_: ESI on Gross Payable, ESI eligibility on this month's gross, ESI on Official basic, sub-rupee ESI

**ESI (Official)**:
Employee state insurance on Official: 0.75% of Official **Monthly Basic**, only if that basic is at most ₹21,000 and not opted out. Must not be forced on merely because PF is on. Employer ESI follows the same Official base when employee ESI applies.
_Avoid_: Using Reference gross for Official ESI

**Professional Tax**:
Slab tax computed from Reference Gross Payable and shown as the same rupee amount on both sheets. **Waived entirely for TDS payers** — any employee with a non-zero TDS (stored as `otherDeduction`) pays ₹0 Professional Tax (TICKET-15, resolved 2026-07-29). This restores the ₹0 P-Tax the **Source Workbooks** show for PUNIT SODHANI and Nawneet Sodhani.
_Avoid_: PF, ESI; charging P-Tax on a row that already carries TDS

**Advance / Other Deduction**:
Non-statutory deductions. Both are **stored positive** (`≥ 0`) and **always subtracted** from net; a negative input is clamped to 0 at the boundary. Same inputs on both sheets when nets are aligned. The UI may show a leading minus for presentation only.
_Avoid_: Absent deduction (that is a gross-side proration concept); storing a negative advance that increases pay

### Official construction

**Wage-Board Daily**:
Statutory Official daily basic rates: Unskilled ₹400, Semi-skilled ₹440, Skilled ₹484, over a 26-day month (allowed full basics 10400 / 11440 / 12584). Used for Official basic whenever PF is on (for the employee's wage category). Special has no wage-board basic; display uses the Skilled row.
_Avoid_: Reference salary per day

**Opt-Out Basic**:
Elevated Official basic used **only when PF is off**. When PF is on, Official basic is the wage-board daily rate × Official attendance, **uncapped** (no ₹15,000 cap on the displayed basic). When PF is off: if ESI is also off, max(₹21,100, 51% of total salary) attendance-prorated on the Official frame; if ESI is on (and PF off), max(₹15,100, 51% of total salary) attendance-prorated. Special always uses this path (PF forced off).
_Avoid_: Applying opt-out elevation when PF is on; capping displayed basic at ₹15,000

**Net Equality Packing**:
Process of choosing Official attendance (from A_max down to A_min) and setting Official gross components (HRA, travel, bonus residual) after Official basic, PF, and ESI so Official Net Payable equals Reference Net Payable. PF and ESI may differ between sheets; net must not for packable rows. Official net is **always computed**, never copied from Reference.
_Avoid_: Copying every statutory rupee from Reference onto Official; assigning `netPayable` from Reference

**Unpackable Row**:
A row for which no Official attendance in `[A_min, A_max]` produces `targetGross ≥ officialBasic`. Flagged `unpackable: true` in the UI, assembled with `officialBonus = 0` at `A = A_min`, and **blocks export** of the sheet. Official net is still computed from its own components and may differ from Reference net — that difference is the warning.
_Avoid_: Hiding the mismatch by copying Reference net; allowing negative components to force a pack

### Companies

**Company**:
Legal payroll entity in this app (NKPL or APTUS). Same pay language and rules; separate rosters and rates only.
_Avoid_: Different rule engines per company without an explicit decision

### Month lifecycle

**Rate Card** (`employee_rates/<COMPANY>`):
Per-company store of each employee's standing `salaryPerDay`, `bonusPerDay`, **Monthly Salary** and **Total Salary**, saved automatically whenever the user edits them. It **seeds new months** via Month Carry-Forward; it is deliberately **not** re-applied to a month that already has its own saved data, so a raise entered today cannot retroactively rewrite a filed month. Belongs to exactly one company — a rate card must never contain another company's employee IDs.
_Avoid_: Treating it as a per-month record; overlaying it onto closed months

**Month Carry-Forward**:
Opening a month with no saved data automatically copies the roster from the nearest earlier month for that company — every employee, salary, allowance, category, PF/ESI choice and TDS carries over. Only the per-month inputs reset: **Days Worked** to full attendance, **Extra Days** to 0, and advance and special bonus cleared. The user is never asked to pick a month to copy from; the picker survives only for the genuine first month of a company, where there is nothing to carry.
_Avoid_: Copying last month's attendance forward; prompting the user to copy a month by hand

**Scope Guard**:
The rule that a roster may only be written to the company+month it was loaded for. Switching company changes the active company a render before the new roster arrives, so without this guard the debounced auto-save writes the previous company's employees under the new company's key. This is not hypothetical — it put all 51 NKPL employees into `monthly_salary/APTUS/July 2026` and `employee_rates/APTUS` on 2026-07-29.
_Avoid_: Keying an auto-save on the active company alone

### Sources

**Source Workbook**:
The historical Excel payroll files under `data/` — `SALARY OLD NKPL.xlsx` (sheets `ACTUAL`, `ACTUAL (2..4)`) and `SALARY OLD APTUS.xlsx` (sheets `ACTUALL`, `ACTUALL (2..4)`) — which still carry their live formulas. The **Reference Sheet** reproduces their statutory arithmetic; where it deliberately does not (HRA/TA split, PF eligibility base), the divergence is recorded in ADR-0004.
_Avoid_: The stale `.xls` exports under `data/`; treating a workbook column as authoritative for Official construction
