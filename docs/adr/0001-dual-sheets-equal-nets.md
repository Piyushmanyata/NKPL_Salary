# ADR 0001: Dual sheets with equal nets

## Status
Accepted (grill 2026-07-24). **Amended by ADR-0003.**

## Context
The product shows both an internal Reference salary view and a formal Official (Main) wage sheet. Implementation historically derived Official from Reference with inconsistent PF/ESI/net behaviour.

## Decision
- Official Sheet is the formal filed/paid register view; Reference Sheet is internal working view.
- Reference Net Payable and Official Net Payable must always be equal for the same employee-month.
- Gross, basic, PF, and ESI may differ between sheets.
- Reference uses calendar days; Official uses a 26-day wage-board attendance frame (26 minus calendar absences).
- Official recomputes its own PF (from Official basic) and ESI (from Official basic), then packs HRA/TA/bonus so nets match.
- Reference computes ESI on Reference gross; Official computes ESI on Official monthly basic.
- NKPL and APTUS share the same rules; only data differs.

## Consequences
- One money pipeline: attendance → Reference economics → Official presentation with net lock.
- Official cannot independently invent a different take-home.
- Tests must assert net equality even when PF/ESI diverge.
- Reverse-engineering loops that recompute net without a lock are bugs.
