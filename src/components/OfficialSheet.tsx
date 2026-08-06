import { Search, Users } from "lucide-react";
import type { OfficialRow } from "../officialSheet";
import { currency, numberValue, roundMoney } from "../salary";
import styles from "./OfficialSheet.module.css";

const numberFormat = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const num = (value: number) => numberFormat.format(Number.isFinite(value) ? value : 0);

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
      <thead>
        <tr>
          <th onClick={() => onSort("name")} className="sortable-th">
            Name{sortMark("name")}
          </th>
          <th onClick={() => onSort("wageCategory")} className="sortable-th">
            Category{sortMark("wageCategory")}
          </th>
          <th onClick={() => onSort("attendance")} className="sortable-th">
            Attendance{sortMark("attendance")}
          </th>
          <th onClick={() => onSort("extraDays")} className="sortable-th">
            Extra Days{sortMark("extraDays")}
          </th>
          <th onClick={() => onSort("monthlyBasic")} className="sortable-th">
            Official Basic{sortMark("monthlyBasic")}
          </th>
          <th onClick={() => onSort("monthlyHra")} className="sortable-th">
            HRA{sortMark("monthlyHra")}
          </th>
          <th onClick={() => onSort("monthlyTravelAllowance")} className="sortable-th">
            TA{sortMark("monthlyTravelAllowance")}
          </th>
          <th onClick={() => onSort("bonus")} className="sortable-th">
            Bonus{sortMark("bonus")}
          </th>
          <th onClick={() => onSort("pf")} className="sortable-th">
            PF{sortMark("pf")}
          </th>
          <th onClick={() => onSort("esi")} className="sortable-th">
            ESI{sortMark("esi")}
          </th>
          <th onClick={() => onSort("professionalTax")} className="sortable-th">
            P-Tax{sortMark("professionalTax")}
          </th>
          <th onClick={() => onSort("advance")} className="sortable-th">
            Advance{sortMark("advance")}
          </th>
          <th onClick={() => onSort("netPayable")} className="sortable-th">
            Net Pay{sortMark("netPayable")}
          </th>
          <th onClick={() => onSort("referenceNetPayable")} className="sortable-th">
            Reference Net{sortMark("referenceNetPayable")}
          </th>
        </tr>
      </thead>
      <tbody>
        {sortedRows.map((row) => {
          const hasDiff =
            row.unpackable || Math.abs(row.netPayable - row.referenceNetPayable) > 5;
          const netDelta = roundMoney(row.netPayable - row.referenceNetPayable);
          return (
            <tr key={row.id} className={hasDiff ? "diff-row" : ""}>
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
              </td>
              <td>
                <span style={{ fontWeight: 600 }}>{row.wageCategory}</span>
                {row.sourceCategory !== row.wageCategory && (
                  <div style={{ fontSize: "10px", color: "#667085", marginTop: "2px" }}>
                    (from {row.sourceCategory})
                  </div>
                )}
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
              <td>{num(row.referenceNetPayable)}</td>
            </tr>
          );
        })}
        {!filteredRows.length ? (
          <tr className="empty-row">
            <td colSpan={14}>
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
            <th scope="row" colSpan={2}>
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
            <td>{num(officialSum("referenceNetPayable"))}</td>
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
}
