# ADR 0012: A per-employee Full Attendance Basic overrides both Official basic formulas

## Status

Accepted (2026-09-02). Adds a branch ahead of both SPEC §6.3 basic rules — the wage board of
TICKET-12 and the opt-out floor of TICKET-08 — and qualifies the ESI clamp of ADR-0011.
Reference construction, net equality (ADR-0001) and the ESI base (ADR-0002, ADR-0005) are
unchanged. Issue #29.

## Context

Nine NKPL employees have an agreed Official Monthly Basic that no formula in §6.3 produces.
The previous month's accounting was already filed on those figures, so the Main sheet has to
show them rather than derive them.

The gap is not a rounding difference. Bindu Chirania's agreed basic is ₹42,000 against a
`0.51 × 60,000 = 30,600` opt-out floor; Guru Prasad Patra's is ₹21,500 against a ₹21,100 floor
that his package plays no part in; Uttam Das's is ₹21,500 against a Skilled wage board of
`484 × 26 = 12,584`. The numbers are negotiated, not computed, and they differ per person
within the same category and the same PF status. No parameterisation of §6.3 reaches them.

Three properties of the existing engine shaped the decision:

- **Basic does not determine take-home.** Net equality packing (ADR-0001) chooses HRA, TA and
  bonus so Official net equals Reference net whatever the basic is. Moving basic is a
  presentation change, not a pay change.
- **Basic does determine PF.** `officialPf = 0.12 × min(basic, 15000)`, so raising a PF-on
  employee's basic above ₹12,584 raises the PF actually remitted.
- **Basic does determine ESI.** `officialEsi` returns 0 above a ₹21,000 basic. ADR-0011 added
  a clamp precisely so an enabled ESI could not be silently zeroed by an elevated basic.

## Decision

**1. A `fullAttendanceBasic` on the employee record wins over both §6.3 branches.**

```
officialBasic(A) =
    fullAttendanceBasic > 0   → (fullAttendanceBasic / 26) × A
    else if pfEligible        → A × wageBoardDaily[wageCategory]
    else if !esiEligible      → (max(21100, 0.51 × totalSalary) / 26) × A
    else                      → (min(21000, max(15100, 0.51 × totalSalary)) / 26) × A
```

Absent, `0` or negative means no pin. An explicit per-person figure outranks a general formula.

**2. It is a 26-day anchor that prorates, not a flat amount.** The pin is the basic at full
attendance; below that it prorates on the Official frame like every other basic. The
alternative — applying the pin only at `A = 26` and falling back to §6.3 otherwise — puts a
discontinuity at exactly the attendance boundary, where losing one day costs the proration
*plus* the gap between the pin and the floor.

**3. It beats the wage board when PF is on, and PF follows it.** Declaring a ₹21,500 basic
while remitting PF computed on ₹12,584 would be internally inconsistent on a filed register.
For Uttam Das this moves employee PF from ₹1,510 to ₹1,800, and employer PF likewise.

**4. It lives on the Rate Card, so it reaches every month.** It is standing package data, not a
monthly input. The Rate Card is overlaid on every month as it loads, so the pin applies to
already-filed months — which is the point, since their accounting was done on these figures.
This is safe in a way a retroactive *raise* is not: the pin cannot move net, so no past payment
changes.

**5. It may suppress ESI, and says so.** A pin above ₹21,000 zeroes ESI for an otherwise-eligible
employee. The pin still wins, but the row is flagged `esiSuppressedByPin` and badged on the
sheet. ADR-0011's clamp is not extended to the pin: clamping would print a number other than the
one that was agreed, which is the failure this change exists to fix.

**6. The packer is unchanged.** A pin exceeding the row's target gross is rescued by walking `A`
down, not blocked. A row only becomes `unpackable` when the pin exceeds `26 × targetGross`,
since `A_min` is 1 for anyone who worked.

## Consequences

- Nine NKPL rows print their agreed basic; APTUS needs data entry only, no code change.
- **Uttam Das's PF rises ₹580/month across employee and employer**, retroactively for every
  stored month he was PF-on. This is the only real money the change moves.
- **A pin the row cannot afford degrades quietly.** The packer lowers attendance until the
  prorated pin fits, so an over-large pin prints a basic *below* the agreed figure and an
  attendance below the days actually worked, with no flag. "Guru shows 21,500" holds only while
  his row has gross headroom. Accepted deliberately: failing the row instead would block export
  of an otherwise-correct sheet.
- **`allowedBasic` is left alone.** Every pin exceeds the wage-board allowance printed beside
  it — Bindu's ₹42,000 against a Skilled ₹12,584. That column is the statutory reference the row
  is measured against, not a ceiling on it, and overwriting it would erase the comparison. The
  divergence predates this change: Bindu already printed ₹30,600 against the same ₹12,584.
- Net Payable, Reference construction, Professional Tax and the export contract are untouched.

## Alternatives rejected

**A hard-coded map of employee ids in code.** Fastest to write, and wrong for this domain:
`CONTEXT.md` already names "name-list specials" as an anti-pattern, the codebase having
deliberately moved identity out of code and into Category. It also fails silently when an id
changes, and needs a deploy to fix a typo in a number.

**A per-employee-month input.** Would need re-entering every month, and Month Carry-Forward
seeds only *new* months, so an already-opened month would miss it.

**Clamping the pin to ₹21,000 when ESI is on**, mirroring ADR-0011. Rejected: it prints a basic
nobody agreed to, silently, on a sheet whose accounting is already filed. The flag reports the
same fact without falsifying the number.

**Holding pinned rows at `A_max` and letting them go `unpackable`.** Stricter and arguably more
honest about an unaffordable pin, but it converts a row the packer could file into a blocked
export, with no gain in correctness.
