# ADR 0010: Manual day inputs replace the attendance checker

## Status

Accepted (2026-08-04).

## Context

The application had accumulated biometric imports, manual attendance workbooks, punch-to-roster
mapping, reconciliation, Sunday and double-shift rules, and a separate attendance persistence
layer. That system made payroll behavior difficult to audit and was no longer the desired workflow.

## Decision

- Remove the attendance checker UI, imports, parsers, reconciliation, attendance APIs, attendance
  cache functions, and attendance-only tests and fixtures.
- Keep `Days Worked` and `Extra Days` as ordinary manually editable employee-month payroll inputs.
- Keep the computed Official-sheet `attendance` field because it is part of the statutory wage-sheet
  presentation, not an attendance checker.
- Preserve existing monthly salary records; old attendance-only storage is ignored and is not read or
  deleted by the payroll app.
- New months carry the roster forward and reset only the manual day inputs to Calendar Days and zero.

## Consequences

Payroll no longer changes from punch files, attendance workbooks, Sundays, double shifts, or
reconciliation results. Operators enter and review the two day fields directly, while the existing
salary calculations, month history, and Official-sheet export remain available.
