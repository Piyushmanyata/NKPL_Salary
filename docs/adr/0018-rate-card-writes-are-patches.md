# ADR 0018: Rate Card writes are field patches merged on the server

## Status

Accepted (2026-10-12). Issue #35.

## Context

`useMonthLifecycle` rebuilt the whole **Rate Card** from the open month's roster and saved it
whenever it differed from the stored card, and `POST /api/rates` replaced
`employee_rates/<COMPANY>` wholesale. A saved month keeps the figures it was saved with, so
merely opening an older month:

- reverted every employee in it to that month's salary, totals and Full Attendance Basic on the
  card, which the next Month Carry-Forward then copied into new months;
- deleted the card entry, notes and pin of every employee absent from that month.

Creating a blank month wrote `{}` to the card, and a failed card read (returned as `{}`) was
followed by the same full rewrite.

## Decision

- The rates write gate starts from the loaded roster's own card entries, so a load with no edit
  writes nothing.
- A write sends a patch: per employee, only the fields that changed since the load or the last
  write, with `null` removing a field (notes or increments cleared).
- `POST /api/rates` accepts only `{ company, patch }`, reads the stored card, merges the patch and
  writes the result. A whole-card body is rejected.
- No write removes an employee's entry. Removing someone from a month leaves their card entry,
  notes, pin and increments in place.

## Consequences

- An edit in an older month touches only the fields edited, for the employee edited. Changing a
  salary there still moves the card's standing salary, which seeds the next new month.
- A failed card read can no longer wipe the card. A client that loaded a stale card (from the
  local cache) can still replace a whole increments list when it edits that list.
- The card keeps entries for employees who left. They are applied by id only, so they never show
  up in a month that does not list that employee.
- A browser tab running the old code gets a 400 on its next rates save until it reloads.

## Alternatives rejected

**Seed the gate from the roster, keep full writes.** Stops the write on load, but the first edit
in an older month would still revert and delete the same entries.

**Merge whole entries on the client** (`{ ...loadedCard, ...buildRateMap(roster) }`). Keeps
absent employees, but adding an increment in an older month would write that month's old salary
back for the employee, and the merge base is whatever card the client read — `{}` after a failed
read, or another device's edits lost.

**Refuse rates writes after a failed card read.** Needed only while writes replace the card;
with server-side patches it would block legitimate edits for no gain.

**Delete an employee's entry when they are removed from the open month.** Removing someone from
an older month would erase the standing data of a current employee.
