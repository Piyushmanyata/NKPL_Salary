# ADR 0005: Short Stay no longer forces absence

## Status

Accepted (2026-08-03). Authoritative detail in `docs/SPEC-attendance.md` §4.

## Context

`analyzePunches` treated any stay under 5 hours (including a single punch) as absent.
On NKPL July 2026 that removed **83** sheet-present days that the Manual Sheet counted as worked —
73 of them single-punch normal shifts.

## Decision

- `isShortStay` is **presentational only** (highlight).
- Presence comes from Manual Sheet rules (R1–R4), never from duration.
- `analyzePunches` no longer returns `isPresent`.

## Consequences

- Re-parsing attendance can raise `daysWorked` vs prior short-stay rule; filed months are not backfilled.
- Ambiguous night spans (`ambiguousSpan`) are excluded from `avgHours` only.
