# ADR 0014: The Main sheet is a data-entry surface, not a reconciliation view

## Status

Accepted (2026-09-03). Changes what the Main (Official) sheet *displays* and *exports*, on screen,
in print, and in the `.xls`. No money rule moves: `salary.ts` and `officialSheet.ts` are untouched,
`OfficialRow` keeps every field it had, and net equality (ADR-0001), the ESI base (ADR-0005), the
ADR-0012 pin and the ADR-0013 ratio ceiling all behave exactly as before.

## Context

The Main sheet grew as a *reconciliation* view. It was built while the packer was being proved, so
it carries the evidence of that proof beside every row: a **Reference Net** column to eyeball
against **Net Pay**, and a **Category** column showing the wage category with the source category
underneath it when the two differ.

That job is finished. Net equality is now a machine-checked invariant, not something a human
audits column-by-column:

- `net_equality_packing.test.ts` and the 200,000-case `invariants.test.ts` fuzz both enforce
  `unpackable === false ⇒ |officialNet − referenceNet| ≤ 0.01`, with zero violations.
- `createExportDownload` refuses to export a sheet containing any `unpackable` row.

The sheet's actual daily job is different: it is read **row by row, left to right, while the
figures are keyed into Tally**. For that job the reconciliation columns are not neutral — 14
columns of 11.5px text with no vertical rules is a sheet the eye slips lines on, and two of those
columns are ones the operator never keys.

## Decision

**Print what gets keyed; keep only the columns that justify a filed figure; rule every row.**

1. **Reference Net is removed from both the screen and the export.**
   On screen it is redundant: whenever it differs from Net Pay the row is `unpackable`, which is
   already flagged with a red row and a badge. In the export it is strictly worse than redundant —
   because export is blocked on any unpackable row, every row that *reaches* the file is packable,
   therefore net-equal. **The exported `Reference Net Payable` column was always a verbatim copy
   of `Net Payable`.**

   The `referenceNetPayable` *field* stays on `OfficialRow`. It still feeds the unpackable badge's
   tooltip, which is where the number is actually wanted — on the one row where it differs.

2. **The `hasDiff` test collapses to `row.unpackable`.**
   It read `row.unpackable || Math.abs(row.netPayable - row.referenceNetPayable) > 5`. Given the
   invariant above, the second branch cannot fire unless the first already has. It was dead, and a
   dead tolerance is worse than no tolerance: it implies a ₹5 drift is expected somewhere.

3. **Category is removed from the screen, and `Source Category` from the export.**
   Both are roster facts, already visible and editable on the Reference sheet.

4. **`Wage Category` stays in the export.** This is the asymmetry, and it is deliberate. The
   `.xls` is a filed statutory register: a basic of ₹12,584 is only defensible next to the word
   "Skilled", which is what makes it `484 × 26`. Dropping it would leave the wage-board rate
   unexplained in the filed document. On screen no one is defending anything, so it goes.

5. **Every row is ruled on all three surfaces** — a full grid on screen, the same grid forced
   through `@media print` with `print-color-adjust: exact`, and real border styling in the
   exported HTML, which previously carried none at all and printed from Excel as bare text.

6. **Column widths become declarative.** The widths were positional CSS (`nth-child(1)` …
   `nth-child(14)`), so removing a column silently slid every width onto its neighbour. They move
   to a `<colgroup>`, where a column carries its own width and deleting one cannot corrupt the
   rest.

## Consequences

- **The only remaining net-equality signal on the Main sheet is the `unpackable` badge plus the
  export block.** This is sufficient and is the point: an invariant proven over 200k cases and
  enforced at the export boundary is a stronger guarantee than a column a human might scan. But
  it is now the *sole* signal, so the badge and the export block must not be weakened without
  revisiting this ADR.

- **Export bytes change, so the `pipeline_characterization` snapshot changes.** That snapshot
  exists (issue #26) to catch unintended export drift. This drift is intended. Its companion
  assertion is re-pointed from `"Source Category"` to `"Wage Category"` rather than deleted, so
  the guard still proves the statutory column survives.

- **Anyone reconciling sheet-against-sheet loses the side-by-side.** They compare the Reference
  sheet's Net Pay against the Main sheet's, or read the tooltip on a flagged row. Accepted: that
  is a rare, deliberate act, and it should not cost a column on every row of every month.

- **The Main sheet narrows from 14 columns to 12** and its `min-width` drops, so it fits without
  horizontal scrolling at more window sizes — which is the same win as the rules, by another route.

## Alternatives rejected

**Drop `Wage Category` from the export too**, for symmetry with the screen. Rejected: the screen
and the filed register have different readers. Symmetry between them is not a value; a defensible
register is.

**Keep Reference Net, just hide it behind a toggle.** Rejected: a toggle is a config for one call
site, and the column has no reader now that the invariant is machine-checked. Something with no
reader should be deleted, not made optional.

**Rule the screen only.** Rejected: the printed sheet and the exported `.xls` are both keyed from,
and the export is the surface with *no* borders at all today — the one where the change is worth
most.

**Delete `referenceNetPayable` from `OfficialRow` entirely.** Rejected: the unpackable tooltip is
the one place the comparison genuinely earns its keep, and removing the field would mean
recomputing it there from the Reference row.
