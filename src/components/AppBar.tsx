import {
  BookOpen,
  Building2,
  Cloud,
  FileDown,
  FileSpreadsheet,
  History,
  RefreshCw,
} from "lucide-react";
import { formatSavedAt } from "../hooks/useMonthLifecycle";
import type { SaveStatus } from "../monthLifecycle";
import styles from "./AppBar.module.css";

const SAVE_CHIP: Record<SaveStatus["kind"], { text: string; tone: string; hint: string }> = {
  loading: { text: "Loading…", tone: "saveBusy", hint: "Reading this month from the server" },
  saving: { text: "Saving…", tone: "saveBusy", hint: "Your last change is on its way to the server" },
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
  onSwitchCompany,
  onCompanyNameChange,
  onMonthLabelChange,
  onMonthLabelBlur,
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
  onSwitchCompany: (code: string) => void;
  onCompanyNameChange: (name: string) => void;
  onMonthLabelChange: (label: string) => void;
  onMonthLabelBlur: () => void;
  onOpenRules: () => void;
  onOpenHistory: () => void;
  onExportCsv: () => void;
  onOpenDb: () => void;
  onExportWorkbook: () => void;
}) {
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
        <input
          className={styles.monthInput}
          value={monthLabel}
          aria-label="Month"
          title="Month"
          onBlur={onMonthLabelBlur}
          onChange={(event) => onMonthLabelChange(event.target.value)}
        />
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
