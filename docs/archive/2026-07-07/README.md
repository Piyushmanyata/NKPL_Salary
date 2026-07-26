# Archive — 2026-07-07 reference salary exports

**These files are historical. They are not an oracle for the current payroll engine.**

## What is here

| File | Source |
|---|---|
| `NKPL Reference Salary Sheet June 2026.xls` | Root export dated 2026-07-07 |
| `APTUS Reference Salary Sheet June 2026.xls` | Root export dated 2026-07-07 |
| `APTUS Reference Salary Sheet June 2026 (June-folder-copy).xls` | Copy found under `June/` |

## Why they are wrong for current code

The files predate the 2026-07-24 statutory rework (`d06dae4` … `9425051`). Two concrete divergences from HEAD:

1. **ESI base.** Exports compute employee ESI on **Earned Salary**. Current code (and ADR-0002) uses **Gross Payable** on the Reference sheet.
2. **Professional Tax.** Exports show ₹0 P-Tax for PUNIT SODHANI (NKPL) and Nawneet Sodhani (APTUS) at grosses that must slab to ₹200. Current `calculateSalary` has no exemption path.

See `docs/tickets/TICKET-15-stale-exports-build-divergence.md` and `docs/SPEC-payroll.md` §9 assumption A2.

## Do not use for

- Golden-master fixtures (`TICKET-14`)
- Regression baselines that treat deltas as bugs
- Seeding Redis / localStorage rosters without re-deriving through the current engine

## Do use for

- Historical record of what the business was shown on 2026-07-07
- Diffing against re-exports after TICKETS 01–12 land (every rupee delta must map to a ticket)

## Deployed build at investigation time (2026-07-26)

- Production project: `nawkiran-salary` → https://nawkiran-salary.vercel.app
- Latest GitHub Production deployment SHA: **`9425051`** (`feat(db): update db api endpoints and local storage sync`, 2026-07-24)
- Vercel production deployment created: 2026-07-24 ~16:23 IST
- Conclusion: the July 24 rework **is** live. ESI-on-gross is production behaviour. The 2026-07-07 sheets still must not be treated as the production oracle because they predate that rework.

## Open business questions (still need a human)

1. Are **PUNIT SODHANI** and **Nawneet Sodhani** intentionally professional-tax exempt?
   - Yes → add `professionalTaxExempt` and a follow-up ticket.
   - No → each owes ₹200; record as arrears when corrected sheets issue.
2. Communicate the **advance sign correction** (`TICKET-06` / #14) to payroll sign-off before corrected sheets issue.
