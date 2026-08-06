import {
  Calculator,
  FileSpreadsheet,
  Plus,
  Printer,
  Search,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  alignReferenceEsi,
  calculateSalary,
  clampBasicPercent,
} from "./salary";
import type {
  Category,
  SalaryRow,
} from "./types";
import { buildOfficialRow } from "./officialSheet";
import { applyEmployeeEdit, type EditableField } from "./editEmployee";
import { blankEmployee } from "./roster";
import { createExportDownload, downloadBlob } from "./exportActions";
import { legacyStorageKeys, readStorage, storageKeys, writeStorage } from "./storageKeys";
import {
  calendarDaysForMonth,
  normalizeMonthLabel,
} from "./months";
import { AppBar } from "./components/AppBar";
import { DatabaseModal } from "./components/DatabaseModal";
import { NoDataModal } from "./components/NoDataModal";
import { OfficialSheet } from "./components/OfficialSheet";
import { ReferenceSheet } from "./components/ReferenceSheet";
import { RulesDialog } from "./components/RulesDialog";
import { SidePanel } from "./components/SidePanel";
import { LifecycleErrorBanner } from "./components/LifecycleErrorBanner";
import { Toast } from "./components/Toast";
import { TotalsStrip } from "./components/TotalsStrip";
import { useGridNavigation } from "./hooks/useGridNavigation";
import { useMonthLifecycle } from "./hooks/useMonthLifecycle";
import { useRowSort } from "./hooks/useRowSort";
import { useToast } from "./hooks/useToast";
import { calculateCategoryTotals, calculateMonthTotals } from "./totals";
import { sortRows } from "./sortRows";
import styles from "./App.module.css";

const CATEGORIES: Category[] = ["Unskilled", "Semi-skilled", "Skilled", "Special"];

type SheetMode = "reference" | "main";

const COMPANIES = [
  { code: "NKPL", label: "NKPL" },
  { code: "APTUS", label: "APTUS" },
] as const;

type CompanyCode = (typeof COMPANIES)[number]["code"];

const DEFAULT_COMPANY: CompanyCode = "NKPL";

function loadActiveCompany(): CompanyCode {
  const stored = readStorage(storageKeys.activeCompany, legacyStorageKeys.activeCompany);
  if (stored && COMPANIES.some((company) => company.code === stored)) {
    return stored as CompanyCode;
  }
  return DEFAULT_COMPANY;
}

function loadCompanyLabel(company: CompanyCode): string {
  return (
    readStorage(storageKeys.companyLabel(company), legacyStorageKeys.companyLabel(company)) ||
    company
  );
}

function loadMonthConfig(company: CompanyCode) {
  try {
    const legacy =
      company === DEFAULT_COMPANY
        ? [legacyStorageKeys.monthConfig(company), legacyStorageKeys.monthConfigFlat]
        : [legacyStorageKeys.monthConfig(company)];
    const raw = readStorage(storageKeys.monthConfig(company), ...legacy) ?? "{}";
    const parsed = JSON.parse(raw) as {
      label?: unknown;
      days?: unknown;
    };
    const label = String(parsed.label || "May 2026");
    return {
      label,
      days: calendarDaysForMonth(label),
    };
  } catch {
    return { label: "May 2026", days: calendarDaysForMonth("May 2026") };
  }
}

function App() {
  const [activeCompany, setActiveCompany] = useState<CompanyCode>(loadActiveCompany);
  const initialMonthConfig = useMemo(() => loadMonthConfig(activeCompany), []);
  const [monthLabel, setMonthLabel] = useState(initialMonthConfig.label);
  const [query, setQuery] = useState("");
  const [newlyAddedId, setNewlyAddedId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState(() => loadCompanyLabel(activeCompany));
  const [openSettingsId, setOpenSettingsId] = useState<string | null>(null);
  // How salary is typed in the open Settings panel. null = follow the category
  // default (Unskilled per day, everything else per month); the toggle button
  // overrides it. Only one panel is open at a time, so one value is enough, and
  // it resets naturally when a different row is opened.
  const [rateMode, setRateMode] = useState<"perDay" | "perMonth" | null>(null);
  const [sheetMode, setSheetMode] = useState<SheetMode>("reference");
  // D is a pure function of the month label — never independently editable (TICKET-03).
  const effectiveMonthDays = useMemo(
    () => calendarDaysForMonth(monthLabel),
    [monthLabel],
  );

  const { toast, showToast, dismissToast } = useToast();

  const {
    lifecycle,
    employees,
    setEmployees,
    allMonths,
    copySourceMonth,
    setCopySourceMonth,
    showNoDataModal,
    dbLoading,
    retry,
    cancelNoData,
    createBlankMonth,
    createSampleMonth,
    copyMonth,
  } = useMonthLifecycle(activeCompany, monthLabel, effectiveMonthDays);
  const saveError = lifecycle.saveError;
  const noDataMonth = monthLabel;
  const prevMonthRef = useRef(monthLabel);
  const prevCompanyRef = useRef(activeCompany);

  // Cloud Database Sync settings
  const [isDbModalOpen, setIsDbModalOpen] = useState(false);
  // The calculation rules are reference material: read once while learning the
  // sheet, never again. They live in a dialog so they cost no scroll depth.
  const [isRulesOpen, setIsRulesOpen] = useState(false);
  // Notes needs real height and is untouched most months, so it stays folded
  // inside the settings panel until asked for.
  const [notesOpen, setNotesOpen] = useState(false);
  const tableWrapRef = useRef<HTMLDivElement>(null);

  const calculatedSalaryRows = useMemo(
    () =>
      employees
        .filter((employee) => employee.name.trim())
        .map((employee) =>
          calculateSalary(employee, {
            basicShare: clampBasicPercent(employee.basicPercent) / 100,
            workingDays: effectiveMonthDays,
          }),
        ),
    [employees, effectiveMonthDays],
  );

  const officialRows = useMemo(
    () => calculatedSalaryRows.map((row) => buildOfficialRow(row, effectiveMonthDays)),
    [calculatedSalaryRows, effectiveMonthDays],
  );

  const salaryRows = useMemo(
    () =>
      calculatedSalaryRows.map((row, index) => {
        const official = officialRows[index];
        return official
          ? alignReferenceEsi(row, official.esi, official.employerEsi)
          : row;
      }),
    [calculatedSalaryRows, officialRows],
  );

  const filteredRows = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) {
      return salaryRows;
    }

    return salaryRows.filter((row) =>
      `${row.name} ${row.category}`.toLowerCase().includes(search),
    );
  }, [query, salaryRows]);

  const filteredOfficialRows = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) {
      return officialRows;
    }

    return officialRows.filter((row) =>
      `${row.name} ${row.sourceCategory} ${row.wageCategory}`.toLowerCase().includes(search),
    );
  }, [officialRows, query]);

  const {
    sortField: refSortField,
    sortDirection: refSortDirection,
    handleSort: handleRefSort,
  } = useRowSort("name");
  const {
    sortField: officialSortField,
    sortDirection: officialSortDirection,
    handleSort: handleOfficialSort,
  } = useRowSort("name");
  const { handleGridKey } = useGridNavigation(tableWrapRef);

  const sortedFilteredRows = useMemo(
    () => sortRows(filteredRows, refSortField as keyof SalaryRow, refSortDirection, newlyAddedId),
    [filteredRows, refSortField, refSortDirection, newlyAddedId],
  );

  const sortedFilteredOfficialRows = useMemo(
    () => sortRows(
      filteredOfficialRows,
      officialSortField as keyof (typeof filteredOfficialRows)[number],
      officialSortDirection,
      newlyAddedId,
    ),
    [filteredOfficialRows, officialSortField, officialSortDirection, newlyAddedId],
  );

  const totals = useMemo(
    () => calculateMonthTotals(sheetMode, salaryRows, officialRows),
    [sheetMode, salaryRows, officialRows],
  );

  const categoryTotals = useMemo(() => calculateCategoryTotals(salaryRows), [salaryRows]);

  const updateMonthLabel = (value: string) => {
    setMonthLabel(value);
  };

  const commitMonthLabel = () => {
    setMonthLabel((current) => normalizeMonthLabel(current));
  };

  const updateEmployee = (
    id: string,
    field: EditableField,
    value: string | number | boolean | undefined,
  ) => {
    if (id === newlyAddedId && field === "name") {
      setNewlyAddedId(null);
    }
    setEmployees((current) =>
      current.map((employee) =>
        employee.id !== id
          ? employee
          : applyEmployeeEdit(employee, field, value, effectiveMonthDays),
      ),
    );
  };

  const addEmployee = () => {
    setQuery("");
    const newEmp = blankEmployee(effectiveMonthDays);
    setNewlyAddedId(newEmp.id);
    setEmployees((current) => [newEmp, ...current]);
    showToast("Added new employee successfully!");
  };

  const removeEmployee = (id: string) => {
    const emp = employees.find((e) => e.id === id);
    setEmployees((current) => current.filter((employee) => employee.id !== id));
    setOpenSettingsId((current) => (current === id ? null : current));
    if (emp) {
      showToast(`Removed employee "${emp.name}"`);
    }
  };


  const handleSwitchCompany = (next: CompanyCode) => {
    if (next === activeCompany) return;
    const cfg = loadMonthConfig(next);
    setQuery("");
    setOpenSettingsId(null);
    setActiveCompany(next);
    setCompanyName(loadCompanyLabel(next));
    setMonthLabel(cfg.label);
  };

  // Persist the active company selection and its display label
  useEffect(() => {
    writeStorage(storageKeys.activeCompany, activeCompany);
  }, [activeCompany]);

  useEffect(() => {
    writeStorage(storageKeys.companyLabel(activeCompany), companyName);
  }, [companyName, activeCompany]);

  // Track the last scope the lifecycle actually loaded, not the selection that
  // briefly renders before its async load has started.
  useEffect(() => {
    if (!lifecycle.loadedScope || lifecycle.awaitingChoice || lifecycle.status === "loading") {
      return;
    }
    prevMonthRef.current = lifecycle.loadedScope.monthLabel;
    prevCompanyRef.current = lifecycle.loadedScope.company as CompanyCode;
  }, [lifecycle.loadedScope, lifecycle.awaitingChoice, lifecycle.status]);

  // Remember the last-viewed month per company so switching companies restores it
  useEffect(() => {
    if (dbLoading || showNoDataModal) return;
    const normalized = normalizeMonthLabel(monthLabel);
    if (normalized !== monthLabel) return;
    // Persist label only — days are always recomputed from the label (TICKET-03).
    writeStorage(storageKeys.monthConfig(activeCompany), JSON.stringify({ label: normalized }));
  }, [activeCompany, monthLabel, dbLoading, showNoDataModal]);

  // Month initialization methods
  const handleCreateBlankMonth = () => {
    createBlankMonth();
    showToast(`Created blank payroll sheet for ${noDataMonth}`);
  };

  const handleCreateSampleMonth = async () => {
    await createSampleMonth();
    showToast(`Initialized ${noDataMonth} with sample employees`);
  };

  const handleCopyMonth = async (source: string) => {
    if (!source) return;
    const result = await copyMonth(source);
    if (result === "copied") {
      const targetDays = calendarDaysForMonth(noDataMonth);
      showToast(`Carried ${source} forward to ${noDataMonth} (${targetDays} days, manual days reset)`);
    } else if (result === "unavailable") {
      showToast("Unable to read the source month", "error");
    } else if (result === "cancelled") {
      return;
    } else {
      showToast(`Failed to copy: source month ${source} has no data`, "error");
    }
  };

  const handleCancelNoData = () => {
    cancelNoData();
    setActiveCompany(prevCompanyRef.current);
    setMonthLabel(prevMonthRef.current);
  };

  // Close whichever modal is open on Escape, matching the explicit close/cancel
  // action each modal already exposes via its own button.
  useEffect(() => {
    if (!isDbModalOpen && !showNoDataModal && !isRulesOpen && !openSettingsId) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (isDbModalOpen) {
        setIsDbModalOpen(false);
      } else if (showNoDataModal) {
        handleCancelNoData();
      } else if (isRulesOpen) {
        setIsRulesOpen(false);
      } else if (openSettingsId) {
        // Escape gets you out of an open settings row without reaching for the
        // gear again, which matters when you are working down the sheet.
        setOpenSettingsId(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDbModalOpen, showNoDataModal, isRulesOpen, openSettingsId]);

  const createDownload = (format: "csv" | "workbook") =>
    createExportDownload({
      mode: sheetMode,
      companyName,
      monthLabel,
      salaryRows,
      officialRows,
      format,
    });

  const exportFile = (format: "csv" | "workbook") => {
    const result = createDownload(format);
    if (!("download" in result)) {
      showToast(
        `Cannot export Official sheet: unpackable net for ${result.blocked.length} employee(s): ${result.blocked.join(", ")}`,
        "error",
      );
      return;
    }
    downloadBlob(result.download);
  };

  const exportWorkbook = () => exportFile("workbook");
  const exportCsv = () => exportFile("csv");

  return (
    <>
      {saveError && <LifecycleErrorBanner error={saveError} onRetry={retry} />}
      <main className={styles.appShell}>
        {/* One compact bar: identity, month, and the four actions. The old
            eyebrow and hero paragraph told a daily user nothing and cost ~90px
            of permanent scroll depth, so the company and month became inline
            editable fields here instead of a separate control strip. */}
        <AppBar
          companies={COMPANIES}
          activeCompany={activeCompany}
          companyName={companyName}
          monthLabel={monthLabel}
          effectiveMonthDays={effectiveMonthDays}
          dbLoading={dbLoading}
          onSwitchCompany={(code) => handleSwitchCompany(code as CompanyCode)}
          onCompanyNameChange={setCompanyName}
          onMonthLabelChange={updateMonthLabel}
          onMonthLabelBlur={commitMonthLabel}
          onOpenRules={() => setIsRulesOpen(true)}
          onExportCsv={exportCsv}
          onOpenDb={() => setIsDbModalOpen(true)}
          onExportWorkbook={exportWorkbook}
        />

        {/* The four totals that used to be 118px-tall cards. Net Payable stays
            emphasized and on screen at every scroll position; the sticky totals
            row at the foot of the table is its filtered counterpart. */}
        <TotalsStrip totals={totals} />

        <section className={styles.workspaceGrid}>
          <article className={`panel ${styles.tablePanel}`}>
            {/* Tabs, not a label-flipping toggle. The old button read "Show Main
                Sheet" while you were on Reference, so the control announced the
                opposite of the current state — and the two sheets differ in
                columns, ESI treatment and whether export is allowed. */}
            <div className="panel-heading">
              <div className={styles.sheetTabs} role="tablist" aria-label="Select sheet">
                <button
                  type="button"
                  role="tab"
                  aria-selected={sheetMode === "reference"}
                  className={`${styles.sheetTab} ${sheetMode === "reference" ? styles.active : ""}`}
                  onClick={() => setSheetMode("reference")}
                >
                  <Calculator size={15} />
                  Reference
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={sheetMode === "main"}
                  className={`${styles.sheetTab} ${sheetMode === "main" ? styles.active : ""}`}
                  onClick={() => setSheetMode("main")}
                >
                  <FileSpreadsheet size={15} />
                  Main Sheet
                  {totals.unpackableCount > 0 ? (
                    <span
                      className={styles.tabBadge}
                      title={`${totals.unpackableCount} unpackable row(s) — Excel export is blocked`}
                    >
                      {totals.unpackableCount}
                    </span>
                  ) : null}
                </button>
              </div>
              <div className="panel-actions">
                <span className={styles.searchBox}>
                  <Search size={16} />
                  <input
                    value={query}
                    aria-label="Search employee"
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search name or category"
                  />
                </span>
                <button className="quiet-button" type="button" onClick={addEmployee}>
                  <Plus size={16} />
                  Add
                </button>
                <button className="icon-button" title="Print salary sheet" type="button" onClick={() => window.print()}>
                  <Printer size={17} />
                </button>
              </div>
            </div>

            <div
              ref={tableWrapRef}
              onKeyDown={handleGridKey}
              className={styles.tableWrap}
            >
              {sheetMode === "reference" ? (
                <ReferenceSheet
                  sortedRows={sortedFilteredRows}
                  filteredRows={filteredRows}
                  allRowsCount={salaryRows.length}
                  categories={CATEGORIES}
                  query={query}
                  sortField={refSortField}
                  sortDirection={refSortDirection}
                  openSettingsId={openSettingsId}
                  rateMode={rateMode}
                  notesOpen={notesOpen}
                  effectiveMonthDays={effectiveMonthDays}
                  onSort={handleRefSort}
                  onUpdateEmployee={updateEmployee}
                  onOpenSettings={(id) => {
                    setRateMode(null);
                    setNotesOpen(false);
                    setOpenSettingsId((current) => (current === id ? null : id));
                  }}
                  onRemoveEmployee={removeEmployee}
                  onToggleRateMode={(perDayInput) =>
                    setRateMode(perDayInput ? "perMonth" : "perDay")
                  }
                  onToggleNotes={() => setNotesOpen((open) => !open)}
                />
              ) : (
                <OfficialSheet
                  sortedRows={sortedFilteredOfficialRows}
                  filteredRows={filteredOfficialRows}
                  allRowsCount={officialRows.length}
                  query={query}
                  sortField={officialSortField}
                  sortDirection={officialSortDirection}
                  onSort={handleOfficialSort}
                />
              )}
            </div>
          </article>

          {/* The Rules wall of text moved into a dialog and the "Ready to Pay"
              panel was deleted — it was the fourth copy of Net Payable, which
              the totals strip and the sticky totals row now cover. The chart
              stays: it is the only thing here you cannot read off the table. */}
          <SidePanel categoryTotals={categoryTotals} netTotal={totals.net} />
        </section>
      </main>

      {isRulesOpen && (
        <RulesDialog
          effectiveMonthDays={effectiveMonthDays}
          monthLabel={monthLabel}
          onClose={() => setIsRulesOpen(false)}
        />
      )}

      {showNoDataModal && (
        <NoDataModal
          activeCompany={activeCompany}
          companyName={companyName}
          noDataMonth={noDataMonth}
          allMonths={allMonths}
          copySourceMonth={copySourceMonth}
          onCopySourceMonthChange={setCopySourceMonth}
          onCopyMonth={handleCopyMonth}
          onCreateSampleMonth={handleCreateSampleMonth}
          onCreateBlankMonth={handleCreateBlankMonth}
          onCancel={handleCancelNoData}
        />
      )}

      {isDbModalOpen && <DatabaseModal onClose={() => setIsDbModalOpen(false)} />}

      {toast && <Toast toast={toast} onDismiss={dismissToast} />}
    </>
  );
}

export default App;
