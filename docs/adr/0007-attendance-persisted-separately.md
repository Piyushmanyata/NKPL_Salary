# ADR 0007: Attendance persisted as inputs and decisions in a separate key

## Status

Accepted (2026-08-03). See `docs/SPEC-attendance.md` §9.

## Context

Storing full `AttendanceEmployee[]` is ~182 KB/month (mostly repeated keys). The salary month
record is already rewritten on every debounced keystroke; folding attendance in would balloon
every payroll save.

## Decision

- Keys: `attendance/<COMPANY>/<Month Label>` and `attendance_meta/<COMPANY>`.
- Store compact V1 rows (`p`, `s`, sparse `o`) — inputs and decisions only; recompute on load.
- Do **not** merge into `monthly_salary/...`.

## Consequences

- New API routes `api/attendance` and `api/attendance-meta`.
- Encoded NKPL July fits under 20 KB.
- Re-upload of a saved month requires confirmation (A10).
