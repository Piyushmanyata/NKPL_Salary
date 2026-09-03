import { ChevronDown, RefreshCw } from "lucide-react";
import type { EditableField } from "../editEmployee";
import {
  clampBasicPercent,
  currency,
  ESI_GROSS_LIMIT,
  MAX_BASIC_PERCENT,
  MIN_BASIC_PERCENT,
  PF_BASIC_LIMIT,
  roundMoney,
} from "../salary";
import type { SalaryRow } from "../types";
import { NumberInput } from "./NumberInput";
import styles from "./EmployeeSettingsPanel.module.css";

export function EmployeeSettingsPanel({
  row,
  isSpecial,
  perDayInput,
  esiOverLimit,
  effectiveMonthDays,
  notesOpen,
  onToggleRateMode,
  onToggleNotes,
  onUpdate,
}: {
  row: SalaryRow;
  isSpecial: boolean;
  perDayInput: boolean;
  esiOverLimit: boolean;
  effectiveMonthDays: number;
  notesOpen: boolean;
  onToggleRateMode: () => void;
  onToggleNotes: () => void;
  onUpdate: (field: EditableField, value: string | number | boolean | undefined) => void;
}) {
  return (
    <tr className="settings-row">
      <td colSpan={15}>
        <div className={styles.settingsPanel}>
          {/* Salary can be typed either way round — the button
              switches the input mode and converts (M = D × r).
              The stored anchor still follows Category (SPEC §2.2):
              Unskilled keeps the day rate, the rest keep the
              monthly package. Special has no day rate at all. */}
          {!isSpecial ? (
            <div className={styles.settingsColumn}>
              <span>Salary Input</span>
              <button
                type="button"
                className={styles.rateModeToggle}
                aria-pressed={perDayInput}
                title="Switch between typing salary per day and per month"
                onClick={onToggleRateMode}
              >
                <RefreshCw size={13} />
                {perDayInput ? "Per Day" : "Per Month"}
              </button>
              <small>
                Tap to type the {perDayInput ? "monthly package" : "day rate"} instead —{" "}
                {effectiveMonthDays} days &times; day rate = month.
              </small>
            </div>
          ) : null}
          {perDayInput ? (
            <>
              <div className={styles.settingsColumn}>
                <span>Salary per Day</span>
                <NumberInput
                  value={row.salaryPerDay}
                  min={0}
                  onChange={(value) => onUpdate("salaryPerDay", value)}
                />
                <small>Applies to every month for this employee</small>
              </div>
              <div className={styles.settingsColumn}>
                <span>Bonus per Day</span>
                <NumberInput
                  value={row.bonusPerDay}
                  min={0}
                  onChange={(value) => onUpdate("bonusPerDay", value)}
                />
                <small>Applies to every month for this employee</small>
              </div>
              <div className={styles.settingsColumn}>
                <span>Salary per Month</span>
                <strong>{currency(row.monthlySalary)}</strong>
                <small>{effectiveMonthDays} days &times; {currency(row.salaryPerDay)}</small>
              </div>
              <div className={styles.settingsColumn}>
                <span>Total Salary</span>
                <strong>{currency(row.totalSalary)}</strong>
                <small>{effectiveMonthDays} days &times; ({currency(row.salaryPerDay)} + {currency(row.bonusPerDay)})</small>
              </div>
            </>
          ) : (
            <>
              <div className={styles.settingsColumn}>
                <span>Salary per Month</span>
                <NumberInput
                  value={row.monthlySalary}
                  min={0}
                  onChange={(value) => onUpdate("monthlySalary", value)}
                />
                <small>
                  {isSpecial
                    ? "Fixed package — paid in full every month"
                    : `Day rate ${currency(row.salaryPerDay)} is derived from it`}
                </small>
              </div>
              <div className={styles.settingsColumn}>
                <span>Travelling / Month</span>
                <NumberInput
                  value={Math.max(0, roundMoney(row.totalSalary - row.monthlySalary))}
                  min={0}
                  onChange={(value) => onUpdate("allowance", value)}
                />
                <small>
                  Total Salary <strong>{currency(row.totalSalary)}</strong> = monthly + travelling
                  {row.totalSalary > row.monthlySalary
                    ? ` — sets bonus/day ${currency(row.bonusPerDay)} and the Official 51% basic floor`
                    : " — 0 means none"}
                </small>
              </div>
            </>
          )}
          <div className={styles.settingsColumn}>
            <span>Main Basic</span>
            <NumberInput
              value={row.fullAttendanceBasic ?? 0}
              min={0}
              onChange={(value) => onUpdate("fullAttendanceBasic", value)}
            />
            <small>
              {row.fullAttendanceBasic
                ? `Main-sheet Basic at 26 days — prorates below that. Overrides the wage board and the 51% floor.`
                : "0 = automatic. Set it to pin this employee's Main-sheet Basic at full attendance."}
            </small>
          </div>
          <div className={styles.settingsColumn}>
            <span>TDS</span>
            <NumberInput
              value={row.otherDeduction}
              min={0}
              onChange={(value) => onUpdate("otherDeduction", value)}
            />
          </div>
          <div className={styles.settingsColumn}>
            <span>Basic %</span>
            <strong>{row.basicPercent}%</strong>
            <input
              className={styles.basicSlider}
              type="range"
              min={MIN_BASIC_PERCENT}
              max={MAX_BASIC_PERCENT}
              step="1"
              value={clampBasicPercent(row.basicPercent)}
              onChange={(event) =>
                onUpdate("basicPercent", Number(event.target.value))
              }
            />
          </div>
          <div className={styles.settingsColumn}>
            <span>PF</span>
            <strong>{row.pfOptIn ? "On" : "Off"}</strong>
            <small>{row.monthlySalary * (row.basicPercent / 100) > PF_BASIC_LIMIT ? `PF is off automatically above ${currency(PF_BASIC_LIMIT)} Basic` : "Toggle controls employee PF choice"}</small>
            <button
              type="button"
              className={row.pfOptIn ? styles.toggleOn : styles.toggleOff}
              disabled={isSpecial}
              onClick={() => onUpdate("pfOptIn", !row.pfOptIn)}
            >
              {row.pfOptIn ? "Turn Off" : "Turn On"}
            </button>
          </div>
          <div className={styles.settingsColumn}>
            <span>ESI</span>
            <strong>{row.esiOptIn ? "On" : "Off"}</strong>
            {/* Clamped to two lines in CSS, so the full
                over-limit wording (ADR-0011) is kept on
                hover rather than truncated away. */}
            <small
              title={
                esiOverLimit
                  ? row.esiOptIn
                    ? `Enabled by hand above ${currency(ESI_GROSS_LIMIT)} Total Salary — main-sheet Basic is held under ${currency(ESI_GROSS_LIMIT)} so the ESI applies`
                    : `Off by default above ${currency(ESI_GROSS_LIMIT)} Total Salary — turn it on here if this employee is covered`
                  : "Toggle controls employee ESI choice"
              }
            >
              {esiOverLimit
                ? row.esiOptIn
                  ? `Enabled by hand above ${currency(ESI_GROSS_LIMIT)} Total Salary — main-sheet Basic is held under ${currency(ESI_GROSS_LIMIT)} so the ESI applies`
                  : `Off by default above ${currency(ESI_GROSS_LIMIT)} Total Salary — turn it on here if this employee is covered`
                : "Toggle controls employee ESI choice"}
            </small>
            <button
              type="button"
              className={row.esiOptIn ? styles.toggleOn : styles.toggleOff}
              disabled={isSpecial}
              onClick={() =>
                esiOverLimit
                  ? onUpdate("esiOverLimitOptIn", !row.esiOptIn)
                  : onUpdate("esiOptIn", !row.esiOptIn)
              }
            >
              {row.esiOptIn ? "Turn Off" : "Turn On"}
            </button>
          </div>
          {/* Category used to be repeated here as read-only
              text; it is already an editable dropdown in
              the row itself, and its Special explanation
              now lives on that dropdown's tooltip. */}
          <div className={styles.settingsColumn}>
            <span>Notes</span>
            <button
              type="button"
              className={styles.notesToggle}
              aria-expanded={notesOpen}
              onClick={onToggleNotes}
            >
              <ChevronDown size={13} className={notesOpen ? styles.rot : undefined} />
              {row.notes?.trim() ? "Edit notes" : "Add notes"}
            </button>
          </div>
          {notesOpen ? (
            <div className={`${styles.settingsColumn} ${styles.settingsColumnFull}`}>
              <textarea
                className={styles.notesInput}
                rows={3}
                placeholder={"Increments and anything else worth keeping.\nApr-26 +500 allowance (now 1500)"}
                value={row.notes ?? ""}
                onChange={(event) => onUpdate("notes", event.target.value)}
              />
              <small>
                Kept with the employee, not the month — the same notes show in every
                month and never affect any calculation.
              </small>
            </div>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
