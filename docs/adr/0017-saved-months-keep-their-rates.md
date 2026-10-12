# ADR 0017: A saved month keeps the rates it was saved with; only notes come from the Rate Card

## Status

Accepted (2026-10-12). Corrects ADR-0012 §4 and its retroactive-PF consequence, which described
an overlay the code never applied.

## Context

A month reaches the screen one of two ways. **Month Carry-Forward** seeds a new month from the
nearest earlier one with the Rate Card overlaid: salary/day, bonus/day, Monthly Salary, Total
Salary, Full Attendance Basic and notes. A month with its own saved record loaded with **no**
overlay — deliberately, so a raise typed today does not rewrite what a filed month paid.
`CONTEXT.md` and ADR-0012 nonetheless said the card "is overlaid onto every month as it loads".

The missing overlay also dropped notes. `sanitizeEmployee` never copied `notes`, and the
saved-month path did not take them from the card either. The Rate Card is rebuilt from the
loaded roster and auto-saved whenever it differs from the stored card, so opening any saved
month erased every employee's notes from `employee_rates/<COMPANY>`.

## Decision

- `sanitizeEmployee` keeps `notes`.
- `hydrateSavedMonth` loads a saved month without the rate overlay and takes only `notes` from the
  card. The card is authoritative for every employee it holds — its notes, or none — on saved and
  new months alike (`applyEmployeeRates`); a month record's notes count only for an employee the
  card does not hold.
- A saved month's salaries, totals and Full Attendance Basic stay as saved. Only a new month picks
  up the card's figures.

## Consequences

- Opening the month the card was last built from rebuilds an identical card, so the load writes
  nothing and notes survive.
- A note cleared on the card stays cleared in every month, like the Full Attendance Basic pin.
- Notes the bug already wiped from the card stay hidden. Month records may still hold them, but
  the card wins, so they must be re-typed.
- A Full Attendance Basic pin reaches the month it was typed in and every month created after it,
  not months already saved. ADR-0012's "Uttam Das's PF rises retroactively for every stored month"
  does not happen; to pin a filed month, open it and set the pin there.
- Not fixed here: opening an older saved month rebuilds the whole card from that month's roster
  and `/api/rates` replaces the stored value, reverting standing salaries and dropping employees
  absent from that month (issue #35).

## Alternatives rejected

**Overlay the whole card on every month as it loads**, as the docs claimed. A raise or a typo
entered today would silently rewrite the pay of months already paid and filed.

**Overlay notes and the Full Attendance Basic.** Matches ADR-0012's intent, but the pin moves
Official PF, so it would retroactively change statutory remittance on filed months.

**Card notes first, month record as fallback.** Would recover notes the bug wiped from the card,
but carry-forward copies notes into every month record, so a cleared note would return the next
time any other month — older or newer — was opened.

**Recover once, then the card.** Store a cleared note as `""` and fall back to the month record
only for card entries written before this fix. Recovers wiped notes only from whichever month is
opened first, and changes the card's shape for every employee.
