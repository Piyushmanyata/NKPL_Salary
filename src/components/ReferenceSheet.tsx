import { Fragment } from "react";
import { Search, Settings2, Trash2, Users } from "lucide-react";
import type { EditableField } from "../editEmployee";
import {
  currency,
  ESI_GROSS_LIMIT,
  isSpecialCategory,
  numberValue,
} from "../salary";
import type { Category, SalaryRow } from "../types";
import { EmployeeSettingsPanel } from "./EmployeeSettingsPanel";
import { NumberInput } from "./NumberInput";
import styles from "./ReferenceSheet.module.css";

const numberFormat = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const num = (value: number) => numberFormat.format(Number.isFinite(value) ? value : 0);

const sum = (rows: SalaryRow[], key: keyof SalaryRow) =>
  rows.reduce((total, row) => total + numberValue(row[key]), 0);

export function ReferenceSheet({
  sortedRows,
  filteredRows,
  allRowsCount,
  categories,
  query,
  sortField,
  sortDirection,
  openSettingsId,
  rateMode,
  notesOpen,
  effectiveMonthDays,
  onSort,
  onUpdateEmployee,
  onOpenSettings,
  onRemoveEmployee,
  onToggleRateMode,
  onToggleNotes,
}: {
  sortedRows: SalaryRow[];
  filteredRows: SalaryRow[];
  allRowsCount: number;
  categories: Category[];
  query: string;
  sortField: string;
  sortDirection: "asc" | "desc";
  openSettingsId: string | null;
  rateMode: "perDay" | "perMonth" | null;
  notesOpen: boolean;
  effectiveMonthDays: number;
  onSort: (field: string) => void;
  onUpdateEmployee: (id: string, field: EditableField, value: string | number | boolean | undefined) => void;
  onOpenSettings: (id: string) => void;
  onRemoveEmployee: (id: string) => void;
  onToggleRateMode: (perDayInput: boolean) => void;
  onToggleNotes: () => void;
}) {
  const sortMark = (field: string) =>
    sortField === field ? (sortDirection === "asc" ? " ↑" : " ↓") : "";

  return (
    <table className={styles.referenceTable}>
      <thead>
        <tr>
          <th onClick={() => onSort("name")} className="sortable-th">
            Name{sortMark("name")}
          </th>
          <th onClick={() => onSort("category")} className="sortable-th">
            Category{sortMark("category")}
          </th>
          {/* Days and Extra are always read together and are the two
              narrowest inputs on the sheet, so they share one cell
              rather than each paying for a column of padding. */}
          <th
            onClick={() => onSort("daysWorked")}
            className="sortable-th"
            title="Days worked + extra days. Sorts by days worked."
          >
            Days + Extra{sortMark("daysWorked")}
          </th>
          <th onClick={() => onSort("earnedSalary")} className="sortable-th">
            Earned{sortMark("earnedSalary")}
          </th>
          <th onClick={() => onSort("basicSalary")} className="sortable-th">
            Basic{sortMark("basicSalary")}
          </th>
          <th onClick={() => onSort("hra")} className="sortable-th">
            HRA{sortMark("hra")}
          </th>
          <th onClick={() => onSort("travelAllowance")} className="sortable-th">
            TA{sortMark("travelAllowance")}
          </th>
          <th onClick={() => onSort("performanceBonus")} className="sortable-th">
            Bonus{sortMark("performanceBonus")}
          </th>
          <th onClick={() => onSort("specialBonus")} className="sortable-th">
            Sp Bonus{sortMark("specialBonus")}
          </th>
          <th onClick={() => onSort("employeePf")} className="sortable-th">
            PF{sortMark("employeePf")}
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
          <th aria-label="Actions" />
        </tr>
      </thead>
      <tbody>
        {sortedRows.map((row) => {
          const isSpecial = isSpecialCategory(row.category);
          const missingRate = row.missingRate === true;
          // Special is paid a flat package and has no day rate, so it is
          // always typed per month regardless of the toggle.
          const perDayInput =
            !isSpecial && (rateMode ?? (row.category === "Unskilled" ? "perDay" : "perMonth")) === "perDay";
          // Above a 21,000 package the ESI toggle is opt-IN: off until
          // switched on, and the click is recorded as esiOverLimitOptIn
          // so an untouched row is never mistaken for consent (ADR-0011).
          const esiOverLimit = !isSpecial && row.totalSalary > ESI_GROSS_LIMIT;
          return (
            <Fragment key={row.id}>
              <tr className={missingRate ? "row-missing-rate" : undefined}>
                <td className="name-cell">
                  <input
                    value={row.name}
                    data-cell="name"
                    onChange={(event) => onUpdateEmployee(row.id, "name", event.target.value)}
                  />
                  {missingRate ? (
                    <span className="missing-rate-badge" title="No day rate or monthly salary — set a rate in Settings">
                      Missing rate
                    </span>
                  ) : null}
                </td>
                <td>
                  <select
                    className="select-input"
                    value={row.category}
                    title={
                      isSpecial
                        ? "Special: full pay, no day rate, no PF/ESI"
                        : "Set by hand — never inferred from salary"
                    }
                    onChange={(event) => onUpdateEmployee(row.id, "category", event.target.value)}
                  >
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </td>
                {/* The flex row lives in a div, not on the td: a
                    display:flex table cell drops out of the fixed
                    table layout and collapses to nothing. */}
                <td className="days-cell">
                  <div className="cell-row">
                    <NumberInput
                      className="number-input number-input--compact"
                      value={row.daysWorked}
                      min={0}
                      max={effectiveMonthDays}
                      disabled={isSpecial}
                      dataCell="daysWorked"
                      title="Days worked"
                      onChange={(value) => onUpdateEmployee(row.id, "daysWorked", value)}
                    />
                    <span className="days-plus">+</span>
                    <NumberInput
                      className="number-input number-input--compact"
                      value={row.extraDays}
                      min={0}
                      disabled={isSpecial}
                      dataCell="extraDays"
                      title="Extra days"
                      onChange={(value) => onUpdateEmployee(row.id, "extraDays", value)}
                    />
                  </div>
                </td>
                <td>{num(row.earnedSalary)}</td>
                <td>{num(row.basicSalary)}</td>
                <td>{num(row.hra)}</td>
                <td>{num(row.travelAllowance)}</td>
                <td>{num(row.performanceBonus)}</td>
                <td>
                  <NumberInput
                    className="number-input number-input--compact"
                    value={row.specialBonus ?? undefined}
                    allowBlank={true}
                    min={0}
                    dataCell="specialBonus"
                    onChange={(value) => onUpdateEmployee(row.id, "specialBonus", value)}
                  />
                </td>
                <td>{num(row.employeePf)}</td>
                <td>{num(row.esi)}</td>
                <td>{num(row.professionalTax)}</td>
                <td>
                  <NumberInput
                    className="number-input number-input--compact"
                    value={row.advance ?? undefined}
                    allowBlank={true}
                    dataCell="advance"
                    onChange={(value) => onUpdateEmployee(row.id, "advance", value)}
                  />
                </td>
                <td className="net-cell">{num(row.netPayable)}</td>
                <td className="actions-cell">
                  <div className="cell-row cell-row--end">
                    <button
                      className={row.notes?.trim() ? "icon-button has-notes" : "icon-button"}
                      title={row.notes?.trim() ? `Employee settings — notes:\n${row.notes}` : "Employee settings"}
                      type="button"
                      onClick={() => onOpenSettings(row.id)}
                    >
                      <Settings2 size={16} />
                    </button>
                    <button
                      className="delete-button"
                      title="Remove employee"
                      type="button"
                      onClick={() => onRemoveEmployee(row.id)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
              {openSettingsId === row.id ? (
                <EmployeeSettingsPanel
                  row={row}
                  isSpecial={isSpecial}
                  perDayInput={perDayInput}
                  esiOverLimit={esiOverLimit}
                  effectiveMonthDays={effectiveMonthDays}
                  notesOpen={notesOpen}
                  onToggleRateMode={() => onToggleRateMode(perDayInput)}
                  onToggleNotes={onToggleNotes}
                  onUpdate={(field, value) => onUpdateEmployee(row.id, field, value)}
                />
              ) : null}
            </Fragment>
          );
        })}
        {!filteredRows.length ? (
          <tr className="empty-row">
            <td colSpan={15}>
              <div>
                {query ? <Search size={18} /> : <Users size={18} />}
                <strong>
                  {query ? "No employees match this search." : "No employees in this month yet."}
                </strong>
                <span>
                  {query
                    ? "Clear the search or add a new employee to continue."
                    : "Use “Add” above to start building this sheet."}
                </span>
              </div>
            </td>
          </tr>
        ) : null}
      </tbody>
      {/* Column totals, pinned to the foot of the scroll area. They
          follow the current filter, not the whole month — searching
          for one employee should total that employee — so the label
          always states how many rows are counted. */}
      {filteredRows.length ? (
        <tfoot>
          <tr className="totals-row">
            <th scope="row" colSpan={2}>
              Total — {filteredRows.length} of {allRowsCount} shown
            </th>
            <td />
            <td>{num(sum(filteredRows, "earnedSalary"))}</td>
            <td>{num(sum(filteredRows, "basicSalary"))}</td>
            <td>{num(sum(filteredRows, "hra"))}</td>
            <td>{num(sum(filteredRows, "travelAllowance"))}</td>
            <td>{num(sum(filteredRows, "performanceBonus"))}</td>
            <td>{num(sum(filteredRows, "specialBonus"))}</td>
            <td>{num(sum(filteredRows, "employeePf"))}</td>
            <td>{num(sum(filteredRows, "esi"))}</td>
            <td>{num(sum(filteredRows, "professionalTax"))}</td>
            <td>{num(sum(filteredRows, "advance"))}</td>
            <td className="net-cell">{currency(sum(filteredRows, "netPayable"))}</td>
            <td />
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
}
