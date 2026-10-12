# ADR 0016: Increments are history, not effective-dated rates

## Status

Accepted (2026-10-12). Issue #34.

## Context

Pay rises — almost always added to **Travelling** — were tracked as free text in the employee's
notes. Notes show on no sheet, so nobody could see who got a rise or when.

The **Rate Card** holds one current figure per employee. It seeds every new month through Month
Carry-Forward, and a saved month keeps the standing figures it was saved with. Nothing in the app
records what an employee earned in a given month except the month records themselves.

## Decision

An **Increment** is a record only: the month it began, the rupee amount, an optional note. It is
entered by hand with "Record increment" and never changes pay — the operator still edits
Travelling or the salary.

The list belongs to the employee, not the month. It lives on the Rate Card next to the notes,
and every month overlays it from the card as it loads. Saved months take only the increments
from the card and keep their own saved salaries.

Increments surface as a `↑ ₹1,000` badge on the Reference sheet in the month they start, and as
an "Increment" column after "Total Salary" in the Reference export. The Official export does not
change.

## Consequences

- Who got a rise, when and by how much is readable per employee and per month.
- A backdated increment never double-counts a rise already in the salary, because recording one
  writes nothing else.
- Increments do not make salaries historical. A month still shows the salary it was saved with;
  exported files remain the record of what was paid.
- The history and the salary can disagree — an increment recorded but Travelling not raised, or
  the reverse. The app does not reconcile them.
- Loading a saved month now overlays one Rate Card field. Without it, opening an older month would
  auto-save that month's stale list back to the card and erase newer entries.
- Month records still store the list, as a backup the overlay falls back to when the card has no
  entry for the employee.
- Because the card wins, the card write now follows a finished month write at once instead of
  after a second 2-second wait. A month switch during the month write itself can still leave the
  card one edit behind.
- Merging the month's list into the card's was rejected: a deleted increment would come back from
  any older month record that still holds it.

## Alternatives rejected

**Effective-dated Rate Card.** Every rate change carries a start month, so past months keep the
salary they were paid. Correct, but every read of the card becomes a date lookup, every stored
record needs a migration, and the operator rejected it during design.

**Logging every salary edit automatically.** Typos and corrections would be logged as raises, and
a rise recorded after the fact, or split across two entries, could not be entered at all.
