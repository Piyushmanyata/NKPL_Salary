# NKPL Salary — agent instructions

This repository is a single-app payroll tool. Keep changes small, explicit, and
easy to review; issue #27 is the current lifecycle/write-gate work.

## Repository guidance

- Read `docs/HANDOFF.md`, `docs/SPEC-payroll.md`, and the relevant `docs/adr/*`
  before changing payroll behavior.
- Use GitHub Issues for scope and acceptance criteria; keep the issue number in
  commits and pull requests.
- Prefer the existing patterns and dependencies. Do not add a dependency for a
  local helper or refactor unrelated code.
- Do not edit `src/salary.ts`, `src/officialSheet.ts`, `src/types.ts`, the
  golden fixtures, the payroll spec, or ADRs unless the issue explicitly asks
  for a money-rule or contract change.
- The client uses Redis through `api/db.ts` and `api/rates.ts`; preserve the
  existing Vercel Node handler and API response contracts.
- `loadedScope` and the lifecycle reducer are the write gate: no month or rate
  save may occur before a matching roster is loaded or an explicit create/copy
  choice has completed.

## Workflow

1. Inspect the issue, repository state, relevant docs, and direct dependencies.
2. Define a measurable completion goal and choose the smallest safe change.
3. Make changes in reversible batches; keep implementation seams pure where
   practical and preserve existing UI behavior.
4. Add a focused regression test for changed behavior, then run the full checks.
5. Review the final diff for scope creep, stale imports, debug output, and
   unintended money-engine changes before committing or opening a PR.

## Verification

```powershell
npx tsc --noEmit
npm test
npm run build
python scripts/reference-oracle.py
git diff --check
```

Use LeanCTX (`ctx_read`, `ctx_search`, `ctx_shell`) when available to keep
repository exploration and command output focused. Apply Ponytail principles:
reuse existing code, prefer the smallest correct diff, and avoid speculative
abstractions.

## Delivery

- Keep generated output and local secrets out of commits.
- Do not reset, discard, or overwrite unrelated user changes.
- Commit coherent phases with the issue number, push the feature branch, and
  create a ready-for-review pull request that reports tests and known limits.
