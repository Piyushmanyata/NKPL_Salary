# ADR 0023: Flags compare each month with the last one, and a new flag holds the auto-save

## Status

Accepted (2026-11-04).

## Context

Payroll mistakes reached saved months with nothing to catch them: a row with a blank name in
Aptus October 2026 (left off the sheet, so never paid), worked Sundays split into Extra Days
after the rule changed, advances and cuts that moved without anyone noticing. The app shows one
month at a time, so a change against last month is only visible to someone who remembers it.

## Decision

- A **Flags** tab compares the open month with the previous calendar month's saved record
  (`compareMonths` in `src/flags.ts`), person by person: matched by row id, then by name. It
  lists flags in three levels (Must fix, Check, Note) and a table of every person's days, extra
  days, rate and net, last month against now, biggest change first.
- Thresholds: net change counts when it is at least 15% **and** at least ₹1,000, so the one extra
  calendar day of a 31-day month never flags. Rates compare per day for Unskilled and per month
  (Total Salary, else Monthly Salary) for the rest; an Increment logged for this month turns a
  rise into a Note.
- The flag keys present when a month finishes loading are accepted. An edit that adds a Must fix
  or Check flag sets a **Save Hold**: the month and rate auto-saves stop, a bar shows the flag
  with **See flags** and **Save anyway**, the month and company switches are locked, and leaving
  the page asks first. Fixing the value or pressing Save anyway releases it.
- A flag's key carries its level, and for advance, other cut and special bonus the new amount, so
  an accepted note that turns into a Must fix, or a cut retyped to a new amount, holds again.
- A blank-name row can be named or removed from its flag, because the sheets leave it out.

## Rejected

- **A confirm pop-up before every save.** Saves are automatic every 2 s; a pop-up would interrupt
  typing and train the user to click through it.
- **Warn only, never hold.** The warning would arrive after the save, which is what let the
  October mistakes through.
- **Holding for flags already there at load.** Every month with a known, accepted oddity would
  never save again.

## Consequences

- An edit held and left on screen is not saved; the bar says so and the page warns on leave.
- The previous month is read with `getMonthData`, so it can come from this browser's cache when
  the server is down, like every other read.
- Pay rules that need the register (Sunday threshold, sandwich, guards, unapproved absence) cannot
  be checked from totals alone and stay outside the app.
