# ADR 0019: A load seeds the write gate; no save is suppressed

## Status

Accepted (2026-10-12).

## Context

After a load, `monthLifecycleReducer` set `suppressNextSave`, and the first month or rates save
request was dropped without a write whatever it carried. The save effect debounces requests by
`SAVE_DEBOUNCE_MS`, so an edit made within that window (Days Worked, say) rode on the first
request and was dropped. Nothing re-sent it until a later edit.

A saved-month load already records the loaded payload as `lastMonthSignature`, and every load
records the loaded Rate Card as `lastRatesSignature`. A request with the loaded signature is
rejected by the signature check, so the flag only ever changed the outcome for a request that
carried an edit.

## Decision

Remove `suppressNextSave`. The signature check, seeded by the load, is the only thing that
turns a save request away:

- Saved month: `monthSignature` is the loaded roster with the month's calendar days, which is
  the live payload until something is edited.
- Carry-forward, blank and sample: no `monthSignature`, so the first request writes the new
  month, as it did before (those paths already turned suppression off).

## Consequences

- An edit made right after a load is saved on the first debounced request.
- A load with no edit still writes nothing.
- If the loaded signature and the live payload ever stop matching for an unedited month (for
  example the month days start to come from somewhere other than the calendar), opening a saved
  month writes it once.

## Alternatives rejected

**Let suppression drop only a request equal to the loaded signature.** The signature check
already drops those, so the flag would do nothing but still need maintaining.

**Re-arm the save effect when suppression is consumed.** Writes the edit 2 s late, and keeps a
flag whose only job is to undo itself.
