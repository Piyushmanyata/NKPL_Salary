import {
  AlertTriangle,
  Calculator,
  FileSpreadsheet,
  Plus,
  Printer,
  Search,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  saveMonthData,
  getMonthData,
  getAllMonthLabels,
  getEmployeeRates,
  saveEmployeeRates,
  EmployeeRateMap
} from "./db";
import {
  ESI_EMPLOYER_RATE,
  alignReferenceEsi,
  calculateSalary,
  clampBasicPercent,
  numberValue,
  roundMoney,
} from "./salary";
import type {
  Category,
  EmployeeInput,
  SalaryRow,
} from "./types";
import { buildOfficialRow } from "./officialSheet";
import { applyEmployeeEdit, type EditableField } from "./editEmployee";
import {
  applyEmployeeRates,
  blankEmployee,
  buildRateMap,
  carryForwardEmployee,
  sanitizeEmployee,
} from "./roster";
import {
  buildOfficialExportRows,
  buildReferenceExportRows,
  serializeCsv,
  serializeSpreadsheetHtml,
} from "./exportSheet";
import { legacyStorageKeys, readStorage, storageKeys, writeStorage } from "./storageKeys";
import {
  initialLifecycleState,
  monthLifecycleReducer,
} from "./monthLifecycle";
import {
  calendarDaysForMonth,
  pickCarrySource,
  sortMonthsChronologically,
} from "./months";
import { AppBar } from "./components/AppBar";
import { DatabaseModal } from "./components/DatabaseModal";
import { NoDataModal } from "./components/NoDataModal";
import { OfficialSheet } from "./components/OfficialSheet";
import { ReferenceSheet } from "./components/ReferenceSheet";
import { RulesDialog } from "./components/RulesDialog";
import { SidePanel } from "./components/SidePanel";
import { Toast } from "./components/Toast";
import { TotalsStrip } from "./components/TotalsStrip";
import { useGridNavigation } from "./hooks/useGridNavigation";
import { useRowSort } from "./hooks/useRowSort";
import { useToast } from "./hooks/useToast";
import styles from "./App.module.css";

const CATEGORIES: Category[] = ["Unskilled", "Semi-skilled", "Skilled", "Special"];

type SheetMode = "reference" | "main";

const COMPANIES = [
  { code: "NKPL", label: "NKPL" },
  { code: "APTUS", label: "APTUS" },
] as const;

type CompanyCode = (typeof COMPANIES)[number]["code"];

const sum = (rows: SalaryRow[], key: keyof SalaryRow) =>
  rows.reduce((total, row) => total + numberValue(row[key]), 0);

const DEFAULT_COMPANY: CompanyCode = "NKPL";

const monthNames = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

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

function normalizeMonthLabel(value: string) {
  const trimmed = value.trim();
  const text = trimmed.toLowerCase();
  const monthIndex = monthNames.findIndex((month) => text.includes(month.slice(0, 3)));
  const year = Number(text.match(/\b(20\d{2}|19\d{2})\b/)?.[1] ?? new Date().getFullYear());

  if (monthIndex < 0 || !Number.isFinite(year)) {
    return trimmed;
  }

  return `${monthNames[monthIndex][0].toUpperCase()}${monthNames[monthIndex].slice(1)} ${year}`;
}

// NKPL is the only company with bundled sample/demo data; a newly added
// company like APTUS starts blank until real employees are entered. Loaded on
// demand so ~30 kB of seed roster stays out of the initial bundle — it is only
// ever needed behind the "Use Default Sample Employees" button.
const defaultEmployeesForCompany = async (
  company: CompanyCode,
  _monthLabel?: string,
): Promise<EmployeeInput[]> => {
  if (company !== "NKPL") {
    return [];
  }
  // Always use the real June 2026 payroll roster as the NKPL seed. The older
  // sampleEmployees list (May-sourced) omitted people still present in the
  // current payroll roster (e.g. UTTAM DAS, PRIYOJIT GHOSH).
  return (await import("./juneEmployees")).juneEmployees;
};

function App() {
  const [activeCompany, setActiveCompany] = useState<CompanyCode>(loadActiveCompany);
  const initialMonthConfig = useMemo(() => loadMonthConfig(activeCompany), []);
  const [monthLabel, setMonthLabel] = useState(initialMonthConfig.label);
  // Always starts empty: the roster is owned by Redis and arrives from the load
  // effect below. Seeding it here only ever produced a flash of stale rows.
  const [employees, setEmployees] = useState<EmployeeInput[]>([]);
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

  // Database and Month tracking states
  const [dbLoading, setDbLoading] = useState(true);
  const [allMonths, setAllMonths] = useState<string[]>([]);
  const [showNoDataModal, setShowNoDataModal] = useState(false);
  const [noDataMonth, setNoDataMonth] = useState("");
  const [copySourceMonth, setCopySourceMonth] = useState("");
  const prevMonthRef = useRef(monthLabel);
  const prevCompanyRef = useRef(activeCompany);
  const justLoadedRef = useRef(false);
  // Scope Guard lives in monthLifecycleReducer (loadedScope), not a ref racing
  // beside state. Saves are only legal when canSaveForScope matches.
  const [lifecycle, dispatchLifecycle] = useReducer(
    monthLifecycleReducer,
    monthLabel,
    initialLifecycleState,
  );
  const lastMonthPayloadRef = useRef<string>("");
  const saveError = lifecycle.saveError;
  const saveRetryToken = lifecycle.retryToken;
  const setSaveRetryToken = () => {
    dispatchLifecycle({ type: "RETRY" });
  };

  // Shared salary/day + bonus/day rates for the active company, kept in sync
  // with the cloud store (see api/rates.ts) independently of month records.
  const [employeeRates, setEmployeeRates] = useState<EmployeeRateMap>({});
  const ratesSignatureRef = useRef<string>("");

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

  const sortedFilteredRows = useMemo(() => {
    const sorted = [...filteredRows];
    sorted.sort((a, b) => {
      if (a.id === newlyAddedId) return -1;
      if (b.id === newlyAddedId) return 1;
      let valA = a[refSortField as keyof typeof a];
      let valB = b[refSortField as keyof typeof b];

      if (valA === undefined || valA === null) valA = 0 as any;
      if (valB === undefined || valB === null) valB = 0 as any;

      if (typeof valA === "string") {
        return refSortDirection === "asc"
          ? valA.localeCompare(valB as string)
          : (valB as string).localeCompare(valA);
      } else {
        return refSortDirection === "asc"
          ? (valA as number) - (valB as number)
          : (valB as number) - (valA as number);
      }
    });
    return sorted;
  }, [filteredRows, refSortField, refSortDirection, newlyAddedId]);

  const sortedFilteredOfficialRows = useMemo(() => {
    const sorted = [...filteredOfficialRows];
    sorted.sort((a, b) => {
      if (a.id === newlyAddedId) return -1;
      if (b.id === newlyAddedId) return 1;
      let valA = a[officialSortField as keyof typeof a];
      let valB = b[officialSortField as keyof typeof b];

      if (valA === undefined || valA === null) valA = 0 as any;
      if (valB === undefined || valB === null) valB = 0 as any;

      if (typeof valA === "string") {
        return officialSortDirection === "asc"
          ? valA.localeCompare(valB as string)
          : (valB as string).localeCompare(valA);
      } else {
        return officialSortDirection === "asc"
          ? (valA as number) - (valB as number)
          : (valB as number) - (valA as number);
      }
    });
    return sorted;
  }, [filteredOfficialRows, officialSortField, officialSortDirection, newlyAddedId]);

  const totals = useMemo(() => {
    if (sheetMode === "main") {
      // Reconciliation summary excludes unpackable rows (TICKET-09); sheet still lists them.
      const packable = officialRows.filter((row) => !row.unpackable);
      const unpackableCount = officialRows.length - packable.length;
      const gross = packable.reduce((total, row) => total + row.grossPayable, 0);
      const net = packable.reduce((total, row) => total + row.netPayable, 0);
      const pf = packable.reduce((total, row) => total + row.pf, 0);
      // Employer PF mirrors employee PF in this model (both 12% of basic, capped
      // at PF_BASIC_LIMIT) -- see calculateSalary. Reusing `pf` here (instead of
      // recomputing from monthlyBasic without the cap) keeps this in sync with
      // that formula and avoids overstating employer cost for high-basic rows.
      const employerPf = pf;
      const esi = packable.reduce((total, row) => total + row.esi, 0);
      const professionalTax = packable.reduce((total, row) => total + row.professionalTax, 0);
      const employerEsi = packable.reduce((total, row) => total + (row.esi > 0 ? roundMoney(row.monthlyBasic * ESI_EMPLOYER_RATE) : 0), 0);
      const deductions =
        pf +
        esi +
        professionalTax +
        packable.reduce((total, row) => total + (row.advance || 0) + row.otherDeduction, 0);
      const cost = gross + employerPf + employerEsi;
      return {
        employees: officialRows.length,
        unpackableCount,
        gross,
        net,
        pf,
        employerPf,
        employerEsi,
        esi,
        professionalTax,
        deductions,
        cost,
      };
    } else {
      const gross = sum(salaryRows, "grossPayable");
      const net = sum(salaryRows, "netPayable");
      const pf = sum(salaryRows, "employeePf");
      const employerPf = sum(salaryRows, "employerPf");
      const employerEsi = sum(salaryRows, "employerEsi");
      const esi = sum(salaryRows, "esi");
      const professionalTax = sum(salaryRows, "professionalTax");
      const deductions =
        pf +
        esi +
        professionalTax +
        sum(salaryRows, "advance") +
        sum(salaryRows, "otherDeduction");
      const cost = sum(salaryRows, "totalCost");
      return {
        employees: salaryRows.length,
        unpackableCount: 0,
        gross,
        net,
        pf,
        employerPf,
        employerEsi,
        esi,
        professionalTax,
        deductions,
        cost,
      };
    }
  }, [sheetMode, salaryRows, officialRows]);

  const categoryTotals = useMemo(() => {
    const grouped = salaryRows.reduce<Record<string, number>>((acc, row) => {
      const category = row.category.trim() || "Staff";
      acc[category] = (acc[category] || 0) + row.netPayable;
      return acc;
    }, {});

    return Object.entries(grouped)
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);
  }, [salaryRows]);

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

  // Initialize / fetch month labels for the active company on mount and on company switch
  useEffect(() => {
    getAllMonthLabels(activeCompany).then((months) => {
      setAllMonths(sortMonthsChronologically(months));
    }).catch(console.error);
  }, [activeCompany]);

  // Update previous active month/company tracker when data is loaded successfully
  useEffect(() => {
    const normalized = normalizeMonthLabel(monthLabel);
    if (normalized === monthLabel && !showNoDataModal && !dbLoading) {
      prevMonthRef.current = monthLabel;
      prevCompanyRef.current = activeCompany;
    }
  }, [monthLabel, activeCompany, showNoDataModal, dbLoading]);

  // Remember the last-viewed month per company so switching companies restores it
  useEffect(() => {
    if (dbLoading || showNoDataModal) return;
    const normalized = normalizeMonthLabel(monthLabel);
    if (normalized !== monthLabel) return;
    // Persist label only — days are always recomputed from the label (TICKET-03).
    writeStorage(storageKeys.monthConfig(activeCompany), JSON.stringify({ label: normalized }));
  }, [activeCompany, monthLabel, dbLoading, showNoDataModal]);

  // Load selected company + month payroll data from DB
  useEffect(() => {
    let active = true;
    async function loadData() {
      const normalized = normalizeMonthLabel(monthLabel);
      if (normalized !== monthLabel) {
        return; // wait until committed/normalized
      }

      setDbLoading(true);
      // Nothing may be written for this scope until its own data has landed.
      dispatchLifecycle({
        type: "SELECT_SCOPE",
        company: activeCompany,
        monthLabel: normalized,
      });
      try {
        const [data, rates] = await Promise.all([
          getMonthData(activeCompany, normalized),
          getEmployeeRates(activeCompany),
        ]);
        if (!active) return;
        setEmployeeRates(rates);
        ratesSignatureRef.current = JSON.stringify(rates);
        if (data) {
          justLoadedRef.current = true;
          // Ignore stored data.days — calendar days come from the month label.
          const days = calendarDaysForMonth(normalized);
          // A month that already has data keeps the salaries it was saved with.
          // The shared rate card seeds NEW months (see carryMonthInto); applying
          // it here too would let today's raise retroactively rewrite a filed
          // month's payroll, which is the opposite of "carry it forward".
          const roster = data.employees
              .map((emp, index) => sanitizeEmployee(emp, index, days))
              .filter((emp): emp is EmployeeInput => Boolean(emp));
          setEmployees(roster);
          dispatchLifecycle({
            type: "LOAD_SUCCESS",
            company: activeCompany,
            monthLabel: normalized,
          });
        } else {
          // No data saved for this company + month yet. The roster and every
          // rate carry forward from the previous month automatically — the user
          // should never have to copy a month by hand. Only when there is no
          // earlier month at all is there a genuine choice to make.
          const months = sortMonthsChronologically(await getAllMonthLabels(activeCompany));
          if (!active) return;
          setAllMonths(months);
          setNoDataMonth(normalized);
          const source = pickCarrySource(months, normalized);
          if (source) {
            justLoadedRef.current = true;
            const carried = await carryMonthInto(source, normalized, rates);
            if (!active) return;
            if (carried) {
              showToast(`${normalized} started from ${source} — salaries kept, manual days reset`);
              return;
            }
          }
          setCopySourceMonth(source);
          setShowNoDataModal(true);
        }
      } catch (err) {
        console.error("Failed to load month data from database:", err);
      } finally {
        if (active) setDbLoading(false);
      }
    }
    loadData();
    return () => {
      active = false;
    };
  }, [monthLabel, activeCompany]);

  // Auto-save changes to the database (2000ms debounce; skip identical payloads).
  useEffect(() => {
    if (dbLoading || showNoDataModal) return;
    // Skip the save that would otherwise immediately follow a fresh load --
    // there's nothing new to persist, and it just costs a redundant write.
    if (justLoadedRef.current) {
      justLoadedRef.current = false;
      return;
    }
    const normalized = normalizeMonthLabel(monthLabel);
    if (normalized !== monthLabel) return;
    // Never write a roster into a scope it was not loaded for (company switch).
    const payload = JSON.stringify({
      company: activeCompany,
      monthLabel: normalized,
      days: effectiveMonthDays,
      employees,
    });
    if (payload === lastMonthPayloadRef.current) return;

    // Only enter "saving" when a real write is scheduled (after payload check).
    dispatchLifecycle({
      type: "SAVE_REQUEST",
      company: activeCompany,
      monthLabel: normalized,
      signature: payload,
    });

    const delayDebounce = setTimeout(async () => {
      try {
        const result = await saveMonthData(
          activeCompany,
          normalized,
          effectiveMonthDays,
          employees
        );
        if (result.ok) {
          lastMonthPayloadRef.current = payload;
          dispatchLifecycle({ type: "SAVE_SUCCESS" });
        } else {
          dispatchLifecycle({
            type: "SAVE_ERROR",
            error: result.error || "Failed to save month data to the database.",
          });
        }
      } catch (err: any) {
        console.error("Failed to save month data:", err);
        dispatchLifecycle({
          type: "SAVE_ERROR",
          error: err?.message || "Failed to save month data to the database.",
        });
      }
    }, 2000);

    return () => clearTimeout(delayDebounce);
  }, [employees, effectiveMonthDays, monthLabel, activeCompany, dbLoading, showNoDataModal, saveRetryToken, lifecycle.loadedScope]);

  // Auto-save salary/day + bonus/day rates to the shared cloud store whenever
  // they change, so every month and every visitor picks up the new rate.
  // Debounced and skipped when unchanged so unrelated edits (manual days,
  // deductions, etc.) don't trigger redundant writes.
  useEffect(() => {
    if (dbLoading || showNoDataModal) return;
    const nextRates = buildRateMap(employees);
    const signature = JSON.stringify(nextRates);
    if (signature === ratesSignatureRef.current) return;

    const delayDebounce = setTimeout(async () => {
      try {
        const result = await saveEmployeeRates(activeCompany, nextRates);
        if (result.ok) {
          ratesSignatureRef.current = signature;
          setEmployeeRates(nextRates);
        } else {
          dispatchLifecycle({
            type: "SAVE_ERROR",
            error: result.error || "Failed to save employee rates.",
          });
        }
      } catch (err: any) {
        console.error("Failed to save employee rates:", err);
        dispatchLifecycle({
          type: "SAVE_ERROR",
          error: err?.message || "Failed to save employee rates.",
        });
      }
    }, 2000);

    return () => clearTimeout(delayDebounce);
  }, [employees, activeCompany, monthLabel, dbLoading, showNoDataModal, saveRetryToken, lifecycle.loadedScope]);

  // A month that was just written exists; record it locally rather than paying
  // for another Redis SCAN to be told what we already know.
  const rememberMonth = (label: string) =>
    setAllMonths((current) =>
      current.includes(label) ? current : sortMonthsChronologically([...current, label]),
    );

  // Month initialization methods
  const handleCreateBlankMonth = async () => {
    setShowNoDataModal(false);
    setEmployees([]);
    dispatchLifecycle({
      type: "LOAD_SUCCESS",
      company: activeCompany,
      monthLabel: noDataMonth,
    });
    try {
      await saveMonthData(activeCompany, noDataMonth, effectiveMonthDays, []);
      rememberMonth(noDataMonth);
      showToast(`Created blank payroll sheet for ${noDataMonth}`);
    } catch (err) {
      console.error(err);
      showToast("Error creating month", "error");
    }
  };

  const handleCreateSampleMonth = async () => {
    setShowNoDataModal(false);
    const defaults = await defaultEmployeesForCompany(activeCompany, noDataMonth);
    const sanitized = applyEmployeeRates(
      defaults.map((emp, index) => sanitizeEmployee(emp, index, effectiveMonthDays)!),
      employeeRates,
    );
    setEmployees(sanitized);
    dispatchLifecycle({
      type: "LOAD_SUCCESS",
      company: activeCompany,
      monthLabel: noDataMonth,
    });
    try {
      await saveMonthData(activeCompany, noDataMonth, effectiveMonthDays, sanitized);
      rememberMonth(noDataMonth);
      showToast(`Initialized ${noDataMonth} with sample employees`);
    } catch (err) {
      console.error(err);
      showToast("Error initializing month", "error");
    }
  };

  // Carry a month's roster forward into `target`, resetting the manual
  // days/extra inputs. Shared by the automatic carry on opening a new month and
  // by the explicit picker, so both behave identically.
  const carryMonthInto = async (
    source: string,
    target: string,
    rates: EmployeeRateMap,
  ): Promise<boolean> => {
    const sourceData = await getMonthData(activeCompany, source);
    if (!sourceData) return false;
    const targetDays = calendarDaysForMonth(target);
    const carried = applyEmployeeRates(
      sourceData.employees
        .map((emp, index) => sanitizeEmployee(emp, index, targetDays))
        .filter((emp): emp is EmployeeInput => Boolean(emp))
        .map((emp) => carryForwardEmployee(emp, targetDays)),
      rates,
    );
    setEmployees(carried);
    dispatchLifecycle({
      type: "LOAD_SUCCESS",
      company: activeCompany,
      monthLabel: target,
    });
    await saveMonthData(activeCompany, target, targetDays, carried);
    rememberMonth(target);
    return true;
  };

  const handleCopyMonth = async (source: string) => {
    if (!source) return;
    setDbLoading(true);
    setShowNoDataModal(false);
    try {
      const targetDays = calendarDaysForMonth(noDataMonth);
      if (await carryMonthInto(source, noDataMonth, employeeRates)) {
        showToast(`Carried ${source} forward to ${noDataMonth} (${targetDays} days, manual days reset)`);
      } else {
        showToast(`Failed to copy: source month ${source} has no data`, "error");
      }
    } catch (err) {
      console.error(err);
      showToast("Error copying month data", "error");
    } finally {
      setDbLoading(false);
    }
  };

  const handleCancelNoData = () => {
    setShowNoDataModal(false);
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

  const exportRows =
    sheetMode === "main"
      ? buildOfficialExportRows(officialRows)
      : buildReferenceExportRows(salaryRows);

  /** Block Official export when any row cannot pack net equality (TICKET-09). */
  const assertOfficialExportAllowed = (): boolean => {
    if (sheetMode !== "main") return true;
    const blocked = officialRows.filter((row) => row.unpackable);
    if (!blocked.length) return true;
    const names = blocked.map((row) => row.name).join(", ");
    showToast(
      `Cannot export Official sheet: unpackable net for ${blocked.length} employee(s): ${names}`,
      "error",
    );
    return false;
  };

  const exportWorkbook = () => {
    if (!assertOfficialExportAllowed()) return;
    downloadBlob(
      serializeSpreadsheetHtml(exportRows),
      `${companyName || "Company"} ${sheetMode === "main" ? "Official Main Sheet" : "Reference Salary Sheet"} ${monthLabel}.xls`,
      "application/vnd.ms-excel;charset=utf-8;",
    );
  };

  const exportCsv = () => {
    if (!assertOfficialExportAllowed()) return;
    downloadBlob(
      serializeCsv(exportRows),
      `${companyName || "Company"} ${sheetMode === "main" ? "Official Main Sheet" : "Reference Salary Sheet"} ${monthLabel}.csv`,
      "text/csv;charset=utf-8;",
    );
  };

  const downloadBlob = (content: string, fileName: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <>
      {saveError && (
        <div
          role="alert"
          style={{
            position: "sticky",
            top: 0,
            zIndex: 1000,
            background: "#fef2f2",
            borderBottom: "1px solid #fecaca",
            color: "#991b1b",
            padding: "10px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <span>
            <AlertTriangle size={14} style={{ verticalAlign: "middle", marginRight: 6 }} />
            Database save failed: {saveError}
          </span>
          <button
            type="button"
            className="primary-button"
            style={{ minHeight: 32, height: 32, padding: "0 12px", fontSize: 12 }}
            onClick={() => {
              lastMonthPayloadRef.current = "";
              ratesSignatureRef.current = "";
              setSaveRetryToken();
            }}
          >
            Retry save
          </button>
        </div>
      )}
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
              className={`${styles.tableWrap} ${sheetMode === "main" ? styles.tableWrapOfficial : ""}`}
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
