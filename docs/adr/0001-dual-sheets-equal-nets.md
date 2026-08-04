# ADR 0001: Dual sheets with equal nets

## Status
Accepted (grill 2026-07-24). **Amended by ADR-0003.**

## Context
The product shows both an internal Reference salary view and a formal Official (Main) wage sheet. Implementation historically derived Official from Reference with inconsistent PF/ESI/net behaviour.

## Decision
- Official Sheet is the formal filed/paid register view; Reference Sheet is internal working view.
- Reference Net Payable and Official Net Payable must always be equal for the same employee-month.
- Gross, basic, and PF may differ between sheets. Final ESI is synchronized from Official to Reference before net equality packing.
- Reference uses calendar days; Official uses a 26-day wage-board attendance frame (26 minus calendar absences).
- Official recomputes its own PF (from Official basic) and ESI (from Official basic), copies that ESI amount into the final Reference row, then packs HRA/TA/bonus so nets match.
- Reference retains a raw pre-alignment ESI baseline for attendance targeting; its user-facing ESI is the Official amount.
- NKPL and APTUS share the same rules; only data differs.

## Consequences
- One money pipeline: manual day inputs → Reference economics → Official presentation with net lock.
- Official cannot independently invent a different take-home.
- Tests must assert net equality even when PF/ESI diverge.
- Reverse-engineering loops that recompute net without a lock are bugs.
