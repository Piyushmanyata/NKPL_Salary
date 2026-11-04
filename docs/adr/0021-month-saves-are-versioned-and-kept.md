# ADR 0021: Month saves are versioned, refused when out of date, and the replaced copy is kept

## Status

Accepted (2026-11-04).

## Context

The auto-save posts the **whole month** 2 s after an edit and `POST /api/db` replaced
`monthly_salary/<COMPANY>/<Month>` blindly: last write wins, and the replaced copy was gone. The
Redis store is the Free plan with no persistence and no backup.

On 2026-11-04 Aptus October was overwritten several times by a tab left open on older figures:
any edit there sent its whole stale roster over the newer one saved from another tab. Nothing
told either tab, and nothing could bring the newer figures back.

## Decision

- Each month carries a **Month Version** in `salary_meta/<COMPANY>/<Month>` (a hash: `version`,
  `tab`, `pushedAt`), also written into the record so `GET` returns it. A month saved before this
  change reads as version 1; a month never saved is 0.
- A save sends `baseVersion` (the version its copy came from) and a per-page-load `tabId`. One Lua
  script checks `baseVersion` against the stored version, copies the replaced record into
  `salary_history/<COMPANY>/<Month>`, writes the new record and bumps the version, so two saves
  cannot interleave. A mismatch is `409` with when and from which device the newer save came; a
  save without `baseVersion` (an app tab opened before this change) is refused the same way.
  One exception: when the stored version is one ahead and the last writer is the same tab, that
  tab's previous write landed but its reply was lost, so the save is rebased and accepted.
- A month the server answers 404 for but the browser still has cached is treated as never saved
  (version 0), so saving it recreates it rather than being refused forever.
- The lifecycle keeps the version in state, puts it on the pending month write, and moves it on
  success. A `409` sets `stale`, which blocks every month and Rate Card write until a reload; the
  banner's button becomes **Reload**. A tab that regains focus fetches the month and goes stale the
  same way when the server is ahead (unless the newer record is its own write), before anything is
  typed in it. A save error only applies to the write it belongs to, so a late failure from the
  month just left cannot mark the new month stale.
- History keeps the replaced copy when the save comes from another tab, when 10 minutes have passed
  since the last kept copy, or when the save is a **Restore**; it holds the last 40 per month
  (~13 KB each, so at most ~0.5 MB per month).
- **History** in the app bar lists the current record and the kept copies with time, device, people,
  Net Payable and the field changes between neighbours; **Restore** puts a copy back on screen and
  the normal auto-save writes it.
- `DELETE /api/db` is removed: nothing in the app called it, and it erased a month with no copy.

## Consequences

- An out-of-date tab loses the one edit it was refused for; the banner says so. Retyping it after a
  reload is the price of never overwriting newer figures.
- Anything that posts to `/api/db` outside the app (a one-off script) must first `GET` the month and
  send its `version` as `baseVersion`, plus any `tabId` string.
- Restoring an old copy also patches the Rate Card to that copy's figures, as any edit of those
  fields in the month would.
- History lives in the same Redis as the data, so it undoes mistakes but is not a backup.

## Alternatives rejected

**A Save button with a draft.** A stale tab can still press Save, so it does not stop the
4 Nov overwrite on its own, and it adds a step staff can forget. The version check stops it with no
extra step.

**`WATCH`/`MULTI` in TypeScript.** Needs a dedicated connection per save on a shared serverless
client; the Lua script is atomic on the existing connection.

**Comparing `updatedAt` instead of a counter.** Two saves in the same millisecond, or clock skew
between function instances, would let a stale write through; a counter cannot.

**Keeping a copy on every save.** The auto-save runs every 2 s of typing, so 40 copies would cover
a minute or two of work. Keeping one per other tab and per 10 minutes makes 40 copies span days.
