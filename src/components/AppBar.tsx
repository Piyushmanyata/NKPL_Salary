import {
  BookOpen,
  Building2,
  Cloud,
  FileDown,
  FileSpreadsheet,
  RefreshCw,
} from "lucide-react";

export type CompanyOption = { code: string; label: string };

export function AppBar({
  companies,
  activeCompany,
  companyName,
  monthLabel,
  effectiveMonthDays,
  dbLoading,
  onSwitchCompany,
  onCompanyNameChange,
  onMonthLabelChange,
  onMonthLabelBlur,
  onOpenRules,
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
  onSwitchCompany: (code: string) => void;
  onCompanyNameChange: (name: string) => void;
  onMonthLabelChange: (label: string) => void;
  onMonthLabelBlur: () => void;
  onOpenRules: () => void;
  onExportCsv: () => void;
  onOpenDb: () => void;
  onExportWorkbook: () => void;
}) {
  return (
    <section className="appbar">
      <div className="appbar-identity">
        <div className="company-switch" role="tablist" aria-label="Select company">
          {companies.map((company) => (
            <button
              key={company.code}
              type="button"
              role="tab"
              aria-selected={activeCompany === company.code}
              className={`company-tab ${activeCompany === company.code ? "active" : ""}`}
              onClick={() => onSwitchCompany(company.code)}
            >
              <Building2 size={14} />
              {company.code}
            </button>
          ))}
        </div>
        <input
          className="title-input"
          value={companyName}
          aria-label="Company name"
          title="Company name"
          onChange={(event) => onCompanyNameChange(event.target.value)}
        />
        <span className="title-suffix">Payroll</span>
        <input
          className="month-input"
          value={monthLabel}
          aria-label="Month"
          title="Month"
          onBlur={onMonthLabelBlur}
          onChange={(event) => onMonthLabelChange(event.target.value)}
        />
        <span
          className="days-chip"
          title="Calendar days, derived from the month label (not editable)"
        >
          {effectiveMonthDays} days
        </span>
      </div>
      <div className="appbar-actions">
        <button
          className="ghost-button"
          type="button"
          onClick={onOpenRules}
          title="Calculation rules applied to this sheet"
        >
          <BookOpen size={17} />
          Rules
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
