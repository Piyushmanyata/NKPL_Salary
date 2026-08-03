# ADR 0009: Roster as join hub via stored Biometric ID

## Status

Accepted (2026-08-03). See `docs/SPEC-attendance.md` §5.

## Context

`namesMatch` clean 1:1 rates: NKPL **23/44**, APTUS **24/32**. Unrecoverable pairs include
truncated APTUS device names (12 chars) and aliases (`SK SAJAMAL(ALI)` ↔ `Ali Da`).

## Decision

- Both files join **to the roster**, never to each other.
- Biometric → roster: stored **Biometric ID** map in `attendance_meta` only (A12).
- Manual → roster: unique name match; fuzzy match is suggestion-only in the mapping UI.
- Soft **exclusions** are per-company name keys; never roster deletes.

## Consequences

- First-time mapping UI is required for unmapped device rows.
- `missing-biometric` is normal (e.g. both NKPL guards) and must not zero Manual Sheet `Dw`.
