# ADR 0006: Manual Sheet is the presence authority; Biometric is evidence

## Status

Accepted (2026-08-03). See `docs/SPEC-attendance.md` §2–§3.

## Context

Measured on NKPL July 2026 (1,147 joined employee-days):

| | count |
|---|---|
| both sources agree (old bio-present rule) | 1,064 |
| biometric absent, sheet present | **83** |
| biometric present, sheet absent | **0** (under old duration rule) |

A lone `20:02` weekday punch and a lone `08:04` Sunday punch look identical; only the sheet
separates “worked, missing OUT” from “gate scan, did not work.”

## Decision

- **Manual Sheet** decides present vs absent (and double shift via cell `2`).
- **Biometric Export** supplies punches/duration for evidence and conflict flags only.
- Upload slots are explicit; format detection validates slot kind, does not route silently.

## Consequences

- Biometric-only months use R4 (any punch ⇒ present) with a UI warning.
- Conflicts are classified, never auto-paid away.
