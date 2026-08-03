# ADR 0008: Security denied the Sunday package in both companies

## Status

Accepted (2026-08-03). See `docs/SPEC-attendance.md` §7–§8.

## Context

Security Employees have never received the automatic Sunday package in this app.
The APTUS Manual Sheet, however, grants guard **Somnath Parui** five Sunday days on a full
31-day month (`P=31 SUN=5 TOT=36`). Reproducing that would pay five Extra Days the business
does not grant on the NKPL security rule.

## Decision

- **Both companies**: Security gets no auto-paid Sunday and no auto-granted Sunday Extra Day.
- App for Somnath: **`Dw=31`, `Xd=0`** — a deliberate **5 day/month divergence** from the APTUS sheet total.
- Double shifts still pay Extra Days for Security (`Xd = doubleShiftDays` only).

## Consequences

- APTUS sheet `TOT` is not authoritative for Security.
- Sync must not hard-zero Security `extraDays` (that wiped the only real doubles — both guards).
