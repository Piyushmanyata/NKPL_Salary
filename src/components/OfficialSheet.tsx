import { Search, Users } from "lucide-react";
import type { OfficialRow } from "../officialSheet";
import { currency, ESI_GROSS_LIMIT, numberValue, roundMoney } from "../salary";
import styles from "./OfficialSheet.module.css";

const numberFormat = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const num = (value: number) => numberFormat.format(Number.isFinite(value) ? value : 0);

// One source of truth for column order, labels and widths, so a removed column
// cannot strand its width on a neighbour (ADR-0014).
const COLUMNS = [
  { field: "name", label: "Name", width: "19%" },
  { field: "attendance", label: "Attendance", width: "6.5%" },
  { field: "extraDays", label: "Extra Days", width: "6.5%" },
  { field: "monthlyBasic", label: "Official Basic", width: "8%" },
  { field: "monthlyHra", label: "HRA", width: "8%" },
  { field: "monthlyTravelAllowance", label: "TA", width: "8%" },
  { field: "bonus", label: "Bonus", width: "8%" },
  { field: "pf", label: "PF", width: "7%" },
  { field: "esi", label: "ESI", width: "7%" },
  { field: "professionalTax", label: "P-Tax", width: "7%" },
  { field: "advance", label: "Advance", width: "7%" },
  { field: "netPayable", label: "Net Pay", width: "8%" },
] as const;

export function OfficialSheet({
  sortedRows,
  filteredRows,
  allRowsCount,
  query,
  sortField,
  sortDirection,
  onSort,
}: {
  sortedRows: OfficialRow[];
  filteredRows: OfficialRow[];
  allRowsCount: number;
  query: string;
  sortField: string;
  sortDirection: "asc" | "desc";
  onSort: (field: string) => void;
}) {
  const sortMark = (field: string) =>
    sortField === field ? (sortDirection === "asc" ? " ↑" : " ↓") : "";

  const officialSum = (key: keyof OfficialRow) =>
    filteredRows.reduce((total, row) => {
      const value = numberValue(row[key]);
      // Advance is clamped at zero in the body cell, so its total must be too.
      return total + (key === "advance" ? Math.max(0, value) : value);
    }, 0);

  return (
    <table className={styles.officialTable}>
      <colgroup>
        {COLUMNS.map((column) => (
          <col key={column.field} style={{ width: column.width }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {COLUMNS.map((column) => (
            <th key={column.field} onClick={() => onSort(column.field)} className="sortable-th">
              {column.label}
              {sortMark(column.field)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sortedRows.map((row) => {
          const netDelta = roundMoney(row.netPayable - row.referenceNetPayable);
          return (
            <tr key={row.id} className={row.unpackable ? "diff-row" : ""}>
              <td className="name-cell">
                {row.name}
                {row.unpackable ? (
                  <span
                    title={`Unpackable: Official net ${currency(row.netPayable)} ≠ Reference ${currency(row.referenceNetPayable)} (Δ ${currency(netDelta)}). Export blocked.`}
                    style={{
                      marginLeft: 6,
                      fontSize: 10,
                      fontWeight: 700,
                      color: "#b42318",
                      background: "#fef3f2",
                      border: "1px solid #fecdca",
                      borderRadius: 4,
                      padding: "1px 5px",
                      verticalAlign: "middle",
                    }}
                  >
                    unpackable
                  </span>
                ) : null}
                {row.esiSuppressedByPin ? (
                  <span
                    title={`Main Basic pin of ${currency(row.monthlyBasic)} is above the ${currency(ESI_GROSS_LIMIT)} ESI ceiling, so this employee's ESI is not charged. Clear the pin to restore it.`}
                    style={{
                      marginLeft: 6,
                      fontSize: 10,
                      fontWeight: 700,
                      color: "#b54708",
                      background: "#fffaeb",
                      border: "1px solid #fedf89",
                      borderRadius: 4,
                      padding: "1px 5px",
                      verticalAlign: "middle",
                    }}
                  >
                    ESI off (pin)
                  </span>
                ) : null}
              </td>
              <td>{row.attendance}</td>
              <td>{row.extraDays}</td>
              <td>{num(row.monthlyBasic)}</td>
              <td>{num(row.monthlyHra)}</td>
              <td>{num(row.monthlyTravelAllowance)}</td>
              <td>{num(row.bonus)}</td>
              <td>{num(row.pf)}</td>
              <td>{num(row.esi)}</td>
              <td>{num(row.professionalTax)}</td>
              {/* Read-only here — the advance is typed on the reference
                  sheet and already deducted from this net. */}
              <td>{num(Math.max(0, Number(row.advance) || 0))}</td>
              <td className="net-cell">{num(row.netPayable)}</td>
            </tr>
          );
        })}
        {!filteredRows.length ? (
          <tr className="empty-row">
            <td colSpan={COLUMNS.length}>
              <div>
                {query ? <Search size={18} /> : <Users size={18} />}
                <strong>
                  {query ? "No official rows match this search." : "No employees in this month yet."}
                </strong>
                <span>
                  {query
                    ? "Clear the search to restore the main sheet."
                    : "Add employees on the reference sheet to populate the main sheet."}
                </span>
              </div>
            </td>
          </tr>
        ) : null}
      </tbody>
      {filteredRows.length ? (
        <tfoot>
          <tr className="totals-row">
            <th scope="row">
              Total — {filteredRows.length} of {allRowsCount} shown
            </th>
            <td />
            <td>{num(officialSum("extraDays"))}</td>
            <td>{num(officialSum("monthlyBasic"))}</td>
            <td>{num(officialSum("monthlyHra"))}</td>
            <td>{num(officialSum("monthlyTravelAllowance"))}</td>
            <td>{num(officialSum("bonus"))}</td>
            <td>{num(officialSum("pf"))}</td>
            <td>{num(officialSum("esi"))}</td>
            <td>{num(officialSum("professionalTax"))}</td>
            <td>{num(officialSum("advance"))}</td>
            <td className="net-cell">{currency(officialSum("netPayable"))}</td>
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
}
