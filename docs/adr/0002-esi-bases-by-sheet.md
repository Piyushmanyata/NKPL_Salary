# ADR 0002: ESI bases by sheet

## Status
Accepted (grill 2026-07-24)

## Context
Reference and Official use different component structures. A single ESI base produced wrong register lines on one side or the other.

## Decision
- **Reference ESI**: 0.75% of Reference Gross Payable if gross ≤ ₹21,000 (and not special / not opted out). Employer 3.25% on the same base when employee ESI applies.
- **Official ESI**: 0.75% of Official Monthly Basic if basic ≤ ₹21,000 (and not opted out). Do not force ESI on solely because PF is on.
- ESI rupee amounts may differ across sheets; Net Payable must still match (ADR 0001).

## Consequences
- Dual ESI helpers or one function parameterized by base.
- Gross↔ESI consistency on Reference may need a two-pass or closed-form solve when ESI is on gross.
- Official packing must use Official ESI, not copied Reference ESI.
