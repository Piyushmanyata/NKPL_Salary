import {
  BookOpen,
  Building2,
  ChevronLeft,
  ChevronRight,
  Cloud,
  FileDown,
  FileSpreadsheet,
  History,
  RefreshCw,
} from "lucide-react";
import { formatSavedAt } from "../hooks/useMonthLifecycle";
import type { SaveStatus } from "../monthLifecycle";
import { MONTH_NAMES, parseMonthYearString, pickerYears, shiftMonth } from "../months";
import styles from "./AppBar.module.css";

const SAVE_CHIP: Record<SaveStatus["kind"], { text: string; tone: string; hint: string }> = {
  loading: { text: "Loading…", tone: "saveBusy", hint: "Reading this month from the server" },
  saving: { text: "Saving…", tone: "saveBusy", hint: "Your last change is on its way to the server" },
  held: { text: "Save held", tone: "saveWarn", hint: "A change added a flag, so saving waits. Fix it, or press Save anyway" },
  saved: { text: "Saved", tone: "saveDone", hint: "Every change in this tab is on the server" },
  retrying: { text: "Not saved", tone: "saveBad", hint: "The last save failed. The app keeps trying by itself" },
  stale: { text: "Out of date", tone: "saveBad", hint: "Newer data was saved elsewhere. Reload this tab" },
  offline: {
    text: "Offline copy",
    tone: "saveWarn",
    hint: "The server did not answer, so this is the copy last saved in this browser. Changes save when the server is back",
  },
};

function SaveChip({ status }: { status: SaveStatus }) {
  const chip = SAVE_CHIP[status.kind];
  const text = status.kind === "saved" && status.at ? `Saved ${formatSavedAt(status.at)}` : chip.text;
  return (
    <span className={`${styles.saveChip} ${styles[chip.tone]}`} title={chip.hint} role="status" aria-live="polite">
      {text}
    </span>
  );
}

export type CompanyOption = { code: string; label: string };

export function AppBar({
  companies,
  activeCompany,
  companyName,
  monthLabel,
  effectiveMonthDays,
  dbLoading,
  saveStatus,
  locked,
  onSwitchCompany,
  onCompanyNameChange,
  onMonthChange,
  onOpenRules,
  onOpenHistory,
  onExportCsv,
  onOpenDb,
  onExportWorkbook,
}: {
  companies: readonly CompanyOption[];
  activeCompany: string;
  companyName: string;
  monthLabel: string;
  effectiveMonthDays: number;
  dbLoading: boolean;
  saveStatus: SaveStatus;
  locked: boolean;
  onSwitchCompany: (code: string) => void;
  onCompanyNameChange: (name: string) => void;
  onMonthChange: (label: string) => void;
  onOpenRules: () => void;
  onOpenHistory: () => void;
  onExportCsv: () => void;
  onOpenDb: () => void;
  onExportWorkbook: () => void;
}) {
  const today = new Date();
  const shown = parseMonthYearString(monthLabel) ?? {
    monthIndex: today.getMonth(),
    year: today.getFullYear(),
  };
  const shownLabel = `${MONTH_NAMES[shown.monthIndex]} ${shown.year}`;

  return (
    <section className={styles.appbar}>
      <div className={styles.appbarIdentity}>
        <div className={styles.companySwitch} role="tablist" aria-label="Select company">
          {companies.map((company) => (
            <button
              key={company.code}
              type="button"
              role="tab"
              aria-selected={activeCompany === company.code}
              disabled={locked && activeCompany !== company.code}
              title={locked ? "Save or fix the held change first" : undefined}
              className={`${styles.companyTab} ${activeCompany === company.code ? styles.active : ""}`}
              onClick={() => onSwitchCompany(company.code)}
            >
              <Building2 size={14} />
              {company.code}
            </button>
          ))}
        </div>
        <input
          className={styles.titleInput}
          value={companyName}
          aria-label="Company name"
          title="Company name"
          onChange={(event) => onCompanyNameChange(event.target.value)}
        />
        <span className={styles.titleSuffix}>Payroll</span>
        <div
          className={styles.monthPicker}
          role="group"
          aria-label="Month"
          title={locked ? "Save or fix the held change first" : undefined}
        >
          <button
            type="button"
            className={styles.monthStep}
            aria-label="Previous month"
            disabled={locked}
            title="Previous month"
            onClick={() => onMonthChange(shiftMonth(shownLabel, -1))}
          >
            <ChevronLeft size={18} />
          </button>
          <select
            className={styles.monthSelect}
            aria-label="Month name"
            disabled={locked}
            value={shown.monthIndex}
            onChange={(event) =>
              onMonthChange(`${MONTH_NAMES[Number(event.target.value)]} ${shown.year}`)
            }
          >
            {MONTH_NAMES.map((name, index) => (
              <option key={name} value={index}>
                {name}
              </option>
            ))}
          </select>
          <select
            className={styles.monthSelect}
            aria-label="Year"
            disabled={locked}
            value={shown.year}
            onChange={(event) =>
              onMonthChange(`${MONTH_NAMES[shown.monthIndex]} ${event.target.value}`)
            }
          >
            {pickerYears(shown.year, today.getFullYear()).map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={styles.monthStep}
            aria-label="Next month"
            disabled={locked}
            title="Next month"
            onClick={() => onMonthChange(shiftMonth(shownLabel, 1))}
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <span
          className={styles.daysChip}
          title="Calendar days, derived from the month label (not editable)"
        >
          {effectiveMonthDays} days
        </span>
        <SaveChip status={saveStatus} />
      </div>
      <div className={styles.appbarActions}>
        <button
          className="ghost-button"
          type="button"
          onClick={onOpenRules}
          title="Calculation rules applied to this sheet"
        >
          <BookOpen size={17} />
          Rules
        </button>
        <button
          className="ghost-button"
          type="button"
          onClick={onOpenHistory}
          title="Saved versions of this month, with restore"
        >
          <History size={17} />
          History
        </button>
        <button className="ghost-button" type="button" onClick={onExportCsv}>
          <FileDown size={17} />
          CSV
        </button>
        <button
          className="ghost-button"
          type="button"
          onClick={onOpenDb}
          title={dbLoading ? "Syncing with cloud database..." : "Cloud database connected"}
        >
          {dbLoading ? (
            <RefreshCw size={17} className="spin-icon" style={{ color: "#2563eb" }} />
          ) : (
            <Cloud size={17} style={{ color: "#2563eb" }} />
          )}
          {dbLoading ? "Syncing" : "Cloud"}
        </button>
        <button className="primary-button" type="button" onClick={onExportWorkbook}>
          <FileSpreadsheet size={17} />
          Excel
        </button>
      </div>
    </section>
  );
}
