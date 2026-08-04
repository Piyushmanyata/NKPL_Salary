# ADR 0002: ESI bases by sheet

## Status
Accepted (grill 2026-07-24). **Reference clause superseded by [ADR-0004](0004-reference-statutory-matches-source-workbooks.md), then by [ADR-0005](0005-main-esi-drives-reference.md)**: the raw Reference baseline follows the Source Workbooks, while the final user-facing Reference ESI is aligned to Official ESI. The Official clause below still stands.

## Context
Reference and Official use different component structures. A single ESI base produced wrong register lines on one side or the other.

## Decision
<!-- Superseded: base by ADR-0004/0005, eligibility by ADR-0011 (Basic ≤ ₹21,000 on both sheets). -->
- **Reference ESI**: 0.75% of Reference Gross Payable if gross ≤ ₹21,000 (and not special / not opted out). Employer 3.25% on the same base when employee ESI applies.
- **Official ESI**: 0.75% of Official Monthly Basic if basic ≤ ₹21,000 (and not opted out). Do not force ESI on solely because PF is on.
- ESI rupee amounts may differ across sheets; Net Payable must still match (ADR 0001).

## Consequences
- Dual ESI helpers or one function parameterized by base.
- Gross↔ESI consistency on Reference may need a two-pass or closed-form solve when ESI is on gross.
- Official packing must use Official ESI, not copied Reference ESI.
