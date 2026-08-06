# HANDOFF — NKPL Salary (current state)

Last updated: 2026-08-06 after issue #26 App decomposition.

## What this app is

Dual-sheet payroll for NKPL and APTUS: Reference Salary Sheet + Official Main Sheet with Net Equality Packing. Money engine is pure TypeScript (`src/salary.ts`, `src/officialSheet.ts`) covered by golden fixtures, invariant fuzzing, and a Python oracle.

## Layout (post-#26)

| Area | Path |
|------|------|
| Engine (frozen) | `src/salary.ts`, `src/officialSheet.ts`, `src/types.ts`, `src/months.ts` |
| Domain edit rules | `src/editEmployee.ts` |
| Roster / hydrate | `src/roster.ts` |
| Export | `src/exportSheet.ts` |
| Month lifecycle + Scope Guard | `src/monthLifecycle.ts` |
| Client persistence | `src/db.ts`, `src/storageKeys.ts` |
| UI composition | `src/App.tsx` + `src/components/*` + `src/hooks/*` |
| Seed data | `src/data/nkpl-seed-roster.json` (via `src/juneEmployees.ts`) |
| Styles | `src/styles/global.css` + `*.module.css` |
| API | `api/db.ts`, `api/rates.ts`, `api/_lib/*` |
| Spec / ADRs | `docs/SPEC-payroll.md`, `docs/adr/*` (do not edit casually) |

## Tests

```bash
npm test          # vitest — golden, invariants, pipeline characterization, lifecycle
npx tsc --noEmit
```

Suite is **green**. Golden fixtures must stay byte-identical; if a fixture would need regenerating, stop — that is a behavior change.

## Scope Guard

Saves are gated by `loadedScope` in `monthLifecycleReducer`. A save for any company/month other than the loaded roster is rejected. This replaces the old `loadedForRef` comment-enforced guard (the APTUS contamination incident).

## Live scripts

See `scripts/README.md`. Do not reintroduce one-off migration scripts into the tree.

## Out of scope for agents by default

- Changing engine money formulas or regenerating goldens without explicit approval
- Editing SPEC or ADRs
- Adding auth / multi-user
- React context or feature-folder restructure
