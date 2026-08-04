# ADR 0005: Main ESI drives final Reference ESI and net equality

## Status

Accepted (grill 2026-08-04). Supersedes the user-facing Reference ESI behavior in ADR-0004.

## Context

The Reference calculation and Main/Official sheet used different ESI bases. That made the ESI
amount visible to payroll users differ between the two sheets, even though the product requires a
single take-home amount for the employee-month.

## Decision

1. Build Main/Official ESI from Official Monthly Basic using the existing Official eligibility rule.
2. Put that Main/Official ESI amount into the final Reference row, and apply the matching employer ESI
   basis for the Reference total-cost view.
3. Recalculate Reference Net Payable from its own gross, PF, aligned ESI, tax, and other deductions.
4. Repack Main/Official HRA, travel, and bonus from its own components so Main Net Payable equals
   the recalculated Reference Net Payable; never copy a net value.

Attendance packing uses Reference net before ESI, so moving the ESI amount between sheets does not
change the gross target or introduce a circular dependency.

## Consequences

- Reference and Main show the same employee ESI amount for packable rows.
- PF, gross, basic, and allowance components may still differ between sheets.
- Source Workbook Earned Salary ESI remains available as an internal parity baseline, not the final
  Reference display amount.
- Golden fixtures and net-equality/invariant tests must use the aligned Reference row.
