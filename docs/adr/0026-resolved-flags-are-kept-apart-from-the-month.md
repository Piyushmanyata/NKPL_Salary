# ADR 0026: Resolved flags are kept apart from the month, and stay resolved only while their text is the same

## Status

Accepted (2026-11-05).

## Context

The Flags tab (ADR 0024) shows every flag each time a month opens. A flag that was checked and
found fine (a director's advance that cuts net to 0, a blank row that is meant to stay unpaid)
shows again every time, so the list never empties and a new flag is easy to miss. There was no
record of which flags were checked, or when.

## Decision

- Each open flag has **Resolve**. A resolved flag is stored with its key, level, name, title,
  detail, time and device label in a Redis hash per Company and month,
  `salary_flags_resolved/<CO>/<Month>`, through a new route `api/flags.ts` (GET list, POST
  `resolve` / `reopen`). One `HSET` or `HDEL` per action, so two tabs resolving at once both land.
- `splitResolved` in `src/flags.ts` matches a resolved record to a live flag by key **and** detail
  text. A match leaves the Open list, the tab badge and the Save Hold. A key match with new text
  goes back to Open and shows what it said when it was resolved.
- The Flags tab has **Open** and **Resolved** views. Resolved lists every record, newest first,
  with "Same now", "Changed since" or "No longer flagged", and **Undo**.
- If the resolved list cannot be read, every flag shows as open and the panel says so.

## Rejected

- **Store resolved flags inside the month record.** Every resolve would bump the month's version
  and send other open tabs a "newer on server" reload, and a History Restore would silently undo
  resolutions. Pay data and review notes change for different reasons.
- **Match by key only.** "Net went up a lot" keeps its key when the net moves again, so a second,
  bigger change would stay hidden under an old Resolve.
- **A note box on every Resolve.** Extra typing on every flag; the stored detail, time and device
  already say what was checked.

## Consequences

- Resolved records are not copied by the month History and are not in the nightly backup unless
  that backup includes the `salary_flags_resolved/*` keys.
- Resolve never changes pay. Resolving a flag that holds a save releases the hold, like Save
  anyway, and the month saves.
- Any edit that changes a flag's numbers reopens it, even a small one; that is the point.
