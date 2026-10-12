import { useRef, useState, type FormEvent } from "react";
import { ChevronDown, RefreshCw, X } from "lucide-react";
import type { EditableField, EditValue } from "../editEmployee";
import { incrementMonth, isPositiveMoney } from "../increments";
import { MONTH_NAMES, parseMonthYearString } from "../months";
import {
  clampBasicPercent,
  currency,
  ESI_GROSS_LIMIT,
  MAX_BASIC_PERCENT,
  MIN_BASIC_PERCENT,
  PF_BASIC_LIMIT,
  roundMoney,
} from "../salary";
import type { Increment, SalaryRow } from "../types";
import { NumberInput } from "./NumberInput";
import styles from "./EmployeeSettingsPanel.module.css";

const toMonthInput = (label: string) => {
  const parsed = parseMonthYearString(label);
  return parsed ? `${parsed.year}-${String(parsed.monthIndex + 1).padStart(2, "0")}` : "";
};

const fromMonthInput = (value: string) => {
  const picked = /^(\d{4})-(\d{2})$/.exec(value);
  return picked ? `${MONTH_NAMES[Number(picked[2]) - 1] ?? ""} ${picked[1]}` : value;
};

const shortMonth = (month: string) => `${month.slice(0, 3)} ${month.split(" ")[1] ?? ""}`;

function IncrementsSection({
  increments = [],
  monthLabel,
  onChange,
}: {
  increments?: Increment[];
  monthLabel: string;
  onChange: (next: Increment[]) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [month, setMonth] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [returnFocus, setReturnFocus] = useState(false);
  const recordButton = useRef<HTMLButtonElement>(null);
  const monthInput = useRef<HTMLInputElement>(null);

  const stopRecording = () => {
    setRecording(false);
    setReturnFocus(true);
  };

  const startRecording = () => {
    setMonth(toMonthInput(monthLabel));
    setAmount("");
    setNote("");
    setError("");
    setRecording(true);
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    const label = incrementMonth(fromMonthInput(month));
    const value = Number(amount);
    if (!label) {
      setError("Pick the month the increment started.");
      return;
    }
    if (!isPositiveMoney(roundMoney(value))) {
      setError("Enter an amount above ₹0.");
      return;
    }
    onChange([...increments, { month: label, amount: value, note }]);
    stopRecording();
  };

  const newestFirst = increments.map((entry, index) => ({ entry, index })).reverse();

  return (
    <div className={`${styles.settingsColumn} ${styles.settingsColumnFull} ${styles.increments}`}>
      <span>Increments</span>
      <small>A record only — it never changes pay. Edit Travelling or the salary separately.</small>
      {newestFirst.length ? (
        <ul className={styles.incrementList}>
          {newestFirst.map(({ entry, index }) => {
            const text = [shortMonth(entry.month), `+${currency(entry.amount)}`, entry.note]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={`${entry.month}-${index}`} className={styles.incrementItem}>
                {text}
                <button
                  type="button"
                  className={styles.incrementDelete}
                  aria-label={`Delete increment ${shortMonth(entry.month)} +${currency(entry.amount)}`}
                  title="Delete this increment"
                  onClick={() => {
                    onChange(increments.filter((_, i) => i !== index));
                    (recordButton.current ?? monthInput.current)?.focus();
                  }}
                >
                  <X size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {recording ? (
        <form className={styles.incrementForm} noValidate onSubmit={save}>
          <label className={styles.incrementField}>
            Month
            <input
              ref={monthInput}
              type="month"
              autoFocus
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
          </label>
          <label className={styles.incrementField}>
            Amount (₹)
            <input
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <label className={`${styles.incrementField} ${styles.incrementNote}`}>
            Note (optional)
            <input
              type="text"
              value={note}
              placeholder="e.g. annual, into Travelling"
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <div className={styles.incrementActions}>
            <button type="submit" className={styles.incrementButton}>
              Save
            </button>
            <button type="button" className={styles.incrementButtonQuiet} onClick={stopRecording}>
              Cancel
            </button>
          </div>
          {error ? (
            <small role="alert" className={styles.incrementError}>
              {error}
            </small>
          ) : null}
        </form>
      ) : (
        <button
          ref={recordButton}
          type="button"
          autoFocus={returnFocus}
          className={styles.incrementButton}
          onClick={startRecording}
        >
          Record increment
        </button>
      )}
    </div>
  );
}

export function EmployeeSettingsPanel({
  row,
  isSpecial,
  perDayInput,
  esiOverLimit,
  effectiveMonthDays,
  monthLabel,
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
  monthLabel: string;
  notesOpen: boolean;
  onToggleRateMode: () => void;
  onToggleNotes: () => void;
  onUpdate: (field: EditableField, value: EditValue) => void;
}) {
  const advancedSummary = [
    "Advanced",
    isSpecial ? "PF forced off" : `PF ${row.pfOptIn ? "On" : "Off"}`,
    isSpecial
      ? "ESI forced off"
      : `ESI ${row.esiOptIn ? "On" : "Off"}${esiOverLimit ? ` (above ${currency(ESI_GROSS_LIMIT)})` : ""}`,
    `TDS ${currency(row.otherDeduction)}`,
    `Basic ${row.basicPercent}%`,
    ...(row.fullAttendanceBasic ? [`Fixed Basic ${currency(row.fullAttendanceBasic)}`] : []),
  ].join(" · ");

  return (
    <tr className="settings-row">
      <td colSpan={15}>
        <div className={styles.settingsPanel}>
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
          <IncrementsSection
            increments={row.increments}
            monthLabel={monthLabel}
            onChange={(next) => onUpdate("increments", next)}
          />
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
                placeholder="Anything worth keeping about this employee — ID numbers, remarks."
                value={row.notes ?? ""}
                onChange={(event) => onUpdate("notes", event.target.value)}
              />
              <small>
                Kept with the employee, not the month — the same notes show in every
                month and never affect any calculation.
              </small>
            </div>
          ) : null}
          <details className={`${styles.settingsColumnFull} ${styles.advanced}`}>
            <summary>{advancedSummary}</summary>
            <div className={styles.advancedGrid}>
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
              <div className={styles.settingsColumn}>
                <span>Basic %</span>
                <strong>{row.basicPercent}%</strong>
                <input
                  className={styles.basicSlider}
                  type="range"
                  aria-label="Basic %"
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
                <span>Fixed Main-Sheet Basic</span>
                <NumberInput
                  value={row.fullAttendanceBasic ?? 0}
                  min={0}
                  onChange={(value) => onUpdate("fullAttendanceBasic", value)}
                />
                <small>Main-sheet Basic at 26 days — scales down with attendance. 0 = automatic.</small>
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
              <div className={styles.settingsColumn}>
                <span>TDS</span>
                <NumberInput
                  value={row.otherDeduction}
                  min={0}
                  onChange={(value) => onUpdate("otherDeduction", value)}
                />
              </div>
            </div>
          </details>
        </div>
      </td>
    </tr>
  );
}
