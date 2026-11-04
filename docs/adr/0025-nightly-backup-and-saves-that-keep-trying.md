# ADR 0025: A nightly backup outside Redis, and saves that keep trying

## Status

Accepted (2026-11-04).

## Context

The 4 Nov deep scan found two ways to lose payroll work:

- The Redis store is the Free plan, memory only, with no backup. History (ADR 0021) lives in the
  same store, so a restart loses it too. The only outside copy was a one-time file from 2 Nov.
- One failed save put the lifecycle in `error`, and nothing saved again until **Retry** was
  clicked. Edits after that lived only in the open tab; closing it lost them without a warning.
  There was no sign of whether work was saved, no time limit on any call, and the banner showed
  raw JSON. When the server did not answer, the app opened this browser's cached copy as if it
  were live.

## Decision

- **Nightly backup.** `api/backup.ts` copies every `monthly_salary/*`, `employee_rates/*` and
  `salary_meta/*` key into a Postgres table `salary_backups` (Neon, `SALARY_BACKUP_DATABASE_URL`).
  A Vercel cron calls it daily at 20:30 UTC (02:00 IST) with `CRON_SECRET`; the app also asks for
  one once per page load (`POST`), so copies still happen on any day the app is used if the cron
  is ever stopped by Deployment Protection or a missing secret. Either way a copy is taken only when
  the last is over 20 hours old. Copies older than 180 days are deleted, except the first copy of each month. History lists
  are left out: the daily copies are themselves a history, and leaving them out keeps a copy near
  200 KB instead of several MB.
- **Download backup** in the Cloud box returns every key, History included, as one JSON file.
  It needs no backup store, so it works before the nightly copy is switched on.
- **Saves keep trying.** A failed load or save retries by itself after 2, 5, 15, then every 30 s
  (`retryDelay`); a stale tab never retries, it must reload. The page warns before closing while
  anything is unsaved. Unsaved edits are kept in this browser (`nkpl:draft:<CO>::<Month>`) and put
  back on the next open only when the server version still equals the one they were made on;
  otherwise they are dropped and the app says so, since putting them back would undo a newer save.
- A **save chip** in the app bar says Loading, Saving, Saved with the time, Not saved, Out of date,
  or Offline copy (the cached copy shown because the server did not answer).
- Every browser call has a 15 s limit and every Redis command 5 s. Errors are shown in plain words.

## Rejected alternatives

- **Upgrade Redis to a plan with persistence.** Persistence protects against a restart but not
  against a bad save or a deleted store, and it costs a monthly fee. A copy in a second system
  covers all three.
- **Vercel Blob for the copies.** Blob files are reached by URL; a payroll copy belongs behind a
  database login.
- **Commit the copies to GitHub.** Puts every salary into git history for good.
- **Retry forever without the browser draft.** A closed tab or a crash would still lose the edits.

## Consequences

- The backup store and two env vars (`SALARY_BACKUP_DATABASE_URL`, `CRON_SECRET`) must be set in
  Vercel production. Until then the Cloud box says the nightly backup is not on.
- Restore = read a row's `data` and write each month back through `POST /api/db` with the live
  `baseVersion`, as the 2 Nov backup README describes.
- `@neondatabase/serverless` is a new runtime dependency, used only by `api/backup.ts`.
