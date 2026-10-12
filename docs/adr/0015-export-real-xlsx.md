# ADR 0015: The workbook export is a real `.xlsx`, not HTML named `.xls`

## Status

Accepted (2026-10-12). Amends the export surface of ADR-0014; its ruled-cell decision is kept.

## Context

The "Excel" download was an HTML `<table>` saved with an `.xls` extension and the
`application/vnd.ms-excel` type. Desktop Excel on Windows opens such a file only after a
"file format and extension don't match" warning, and refuses it outright when extension
hardening or Protected View blocks mismatched files. Excel for Mac and mobile, Numbers and
Google Sheets fail to read it as a workbook at all. Users reported the downloaded file would not
open.

## Decision

`serializeXlsx` writes an Office Open XML workbook (`.xlsx`, one sheet named after the export)
and `zipStored` packs it as an uncompressed zip. Numbers are numeric cells; text is inline
strings. Every cell keeps the thin black rule from ADR-0014, the header row is bold on a light
grey fill, and column widths fit the longest value.

## Consequences

- The file opens natively, with no warning, in every spreadsheet app.
- The characterization snapshot now locks the workbook's cell values, read back through SheetJS,
  instead of the HTML bytes.
- Uncompressed zip makes the file a few times larger than it could be; a payroll month is tens of
  kilobytes, so this is not worth a compression step.

## Alternatives rejected

**SheetJS `XLSX.write`.** Already a dev dependency, but the community build does not write cell
styles, so the export would lose the borders ADR-0014 requires, and it would add ~400 kB to the
client bundle.

**SpreadsheetML 2003 (`.xml`).** Keeps styles with plain text, but Excel for Mac, mobile and
Google Sheets do not open it reliably — the same failure this ADR fixes.
