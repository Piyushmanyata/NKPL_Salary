# scripts/

## Live (keep)

| Script | Role |
|--------|------|
| `reference-oracle.py` | Python payroll oracle used in CI / verification |
| `gen-golden-fixtures.mjs` | Regenerates golden June fixtures (only when intentional) |
| `apply-workbook-rates.mjs` | Source Workbook rate importer |
| `diff-june-export-vs-golden.py` | Diagnostic: export vs golden diff |

## Removed (issue #26 hygiene)

One-off migrations (`migrate-*`), verifiers (`verify-*`), `seed-june-redis.mjs`, and `create-issues.sh` were deleted; history retains them.
