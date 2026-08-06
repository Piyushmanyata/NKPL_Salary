# Proposed UI improvements (issue #26 Phase 9)

**Status:** proposal only — do not implement until the payroll owner picks items.

These are intentionally deferred so structural commits (#26 phases 1–8) stay reviewable as pure structure.

## Candidates

1. **Sticky column for employee name** on both sheets so horizontal scroll keeps identity visible.
2. **Keyboard shortcut cheat-sheet** (grid arrows already work) — small `?` popover.
3. **Save status chip** in the app bar (`Saving…` / `Saved` / error) driven by `lifecycle.status` instead of only the sticky error banner.
4. **Unpackable-row filter** on the Official sheet (show only rows that block export).
5. **Column density toggle** (comfortable / compact) for laptop vs large monitor.
6. **Month picker as a select** of known months plus free text, reducing label typos.
7. **Confirm before remove employee** (currently toast-only after delete).
8. **Print stylesheet polish** — hide side panel and settings chrome more aggressively (partially done globally).
9. **Accessible table captions** announcing company + month + sheet mode for screen readers.
10. **Rate-card "raise applied" toast** when Rate Card overlay changes a standing package on a new month only (not on filed months).

## Non-goals for this list

- Visual redesign / new color system
- New statutory fields or companies
- DOM test infrastructure
- Any engine money change

## Recommendation

Ship (3) and (4) first if any — they use state already exposed by the lifecycle reducer and Official sheet without new data model.
