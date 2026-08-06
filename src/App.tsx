import {
  BarChart3,
  BookOpen,
  Calculator,
  ChevronDown,
  FileDown,
  FileSpreadsheet,
  IndianRupee,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  Users,
  AlertTriangle,
  X,
  Check,
  Cloud,
  Wifi,
  Building2,
} from "lucide-react";
import {
  Fragment,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
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
  ESI_GROSS_LIMIT,
  ESI_RATE,
  HRA_SHARE_OF_BALANCE,
  MAX_BASIC_PERCENT,
  MIN_BASIC_PERCENT,
  PF_BASIC_LIMIT,
  PF_RATE,
  TA_SHARE_OF_BALANCE,
  alignReferenceEsi,
  calculateSalary,
  clampBasicPercent,
  currency,
  isSpecialCategory,
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

const CATEGORIES: Category[] = ["Unskilled", "Semi-skilled", "Skilled", "Special"];
import {
  calendarDaysForMonth,
  pickCarrySource,
  sortMonthsChronologically,
} from "./months";

type SheetMode = "reference" | "main";

const COMPANIES = [
  { code: "NKPL", label: "NKPL" },
  { code: "APTUS", label: "APTUS" },
] as const;

type CompanyCode = (typeof COMPANIES)[number]["code"];

const sum = (rows: SalaryRow[], key: keyof SalaryRow) =>
  rows.reduce((total, row) => total + numberValue(row[key]), 0);

// Table bodies drop the rupee sign: every money column here is rupees, so
// repeating the symbol eleven times a row buys nothing and costs the width we
// need to fit on a laptop. Headers and the totals row keep it.
const numberFormat = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const num = (value: number) => numberFormat.format(Number.isFinite(value) ? value : 0);

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

  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);

  // Database and Month tracking states
  const [dbLoading, setDbLoading] = useState(true);
  const [allMonths, setAllMonths] = useState<string[]>([]);
  const [showNoDataModal, setShowNoDataModal] = useState(false);
  const [noDataMonth, setNoDataMonth] = useState("");
  const [copySourceMonth, setCopySourceMonth] = useState("");
  const prevMonthRef = useRef(monthLabel);
  const prevCompanyRef = useRef(activeCompany);
  const justLoadedRef = useRef(false);
  // Which company+month the `employees` state actually belongs to. Switching
  // company flips `activeCompany` a render before the new roster arrives, and
  // without this guard the debounced auto-saves below write the OLD company's
  // roster under the NEW company's key. That is how NKPL's 51 employees once
  // landed in monthly_salary/APTUS/July 2026 and employee_rates/APTUS.
  const loadedForRef = useRef("");
  const scopeOf = (company: string, month: string) => `${company}::${normalizeMonthLabel(month)}`;
  const lastMonthPayloadRef = useRef<string>("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveRetryToken, setSaveRetryToken] = useState(0);

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

  const showToast = (message: string, type: "success" | "error" = "success") => {
    if (toastTimeoutRef.current) {
      window.clearTimeout(toastTimeoutRef.current);
    }
    setToast({ message, type });
    toastTimeoutRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimeoutRef.current = null;
    }, 4000);
  };

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

  // Column totals for the main sheet's footer. Kept beside filteredOfficialRows
  // so the totals can never drift from the rows actually on screen.
  type OfficialRow = (typeof officialRows)[number];
  const officialSum = (key: keyof OfficialRow) =>
    filteredOfficialRows.reduce((total, row) => {
      const value = numberValue(row[key]);
      // Advance is clamped at zero in the body cell, so its total must be too.
      return total + (key === "advance" ? Math.max(0, value) : value);
    }, 0);

  const [refSortField, setRefSortField] = useState<string>("name");
  const [refSortDirection, setRefSortDirection] = useState<"asc" | "desc">("asc");

  const [officialSortField, setOfficialSortField] = useState<string>("name");
  const [officialSortDirection, setOfficialSortDirection] = useState<"asc" | "desc">("asc");

  const handleRefSort = (field: string) => {
    if (refSortField === field) {
      setRefSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setRefSortField(field);
      setRefSortDirection("asc");
    }
  };

  const handleOfficialSort = (field: string) => {
    if (officialSortField === field) {
      setOfficialSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setOfficialSortField(field);
      setOfficialSortDirection("asc");
    }
  };

  // Spreadsheet-style column movement. Typing a month means walking one column
  // down 51 rows, which with native tab order costs eight keystrokes per
  // employee; here it costs one. Cells opt in with data-cell, so the read-only
  // currency columns and the open settings panel are skipped for free.
  //
  // Horizontal movement is deliberately left to Tab: arrow left/right has to
  // keep moving the caret inside a text field, and stealing it would break
  // ordinary editing to save a keystroke that Tab already provides.
  const handleGridKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const { key } = event;
    if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Enter") {
      return;
    }

    const target = event.target as HTMLElement;
    const cell = target.dataset?.cell;
    if (!cell || !tableWrapRef.current) {
      return;
    }

    // Arrow keys on a number input otherwise increment the value — on a Days
    // Worked field that is a silent data change, so it is always suppressed.
    event.preventDefault();

    const peers = Array.from(
      tableWrapRef.current.querySelectorAll<HTMLElement>(`[data-cell="${cell}"]`),
    );
    const index = peers.indexOf(target);
    const next = peers[index + (key === "ArrowUp" ? -1 : 1)];
    if (index < 0 || !next) {
      return;
    }

    next.focus();
    if (next instanceof HTMLInputElement) {
      next.select();
    }
  };

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
      loadedForRef.current = "";
      try {
        const [data, rates] = await Promise.all([
          getMonthData(activeCompany, normalized),
          getEmployeeRates(activeCompany),
        ]);
        if (!active) return;
        loadedForRef.current = scopeOf(activeCompany, normalized);
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
          setEmployees(
            data.employees
              .map((emp, index) => sanitizeEmployee(emp, index, days))
              .filter((emp): emp is EmployeeInput => Boolean(emp)),
          );
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
    if (loadedForRef.current !== scopeOf(activeCompany, normalized)) return;

    const payload = JSON.stringify({
      company: activeCompany,
      monthLabel: normalized,
      days: effectiveMonthDays,
      employees,
    });
    if (payload === lastMonthPayloadRef.current) return;

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
          setSaveError(null);
        } else {
          setSaveError(result.error || "Failed to save month data to the database.");
        }
      } catch (err: any) {
        console.error("Failed to save month data:", err);
        setSaveError(err?.message || "Failed to save month data to the database.");
      }
    }, 2000);

    return () => clearTimeout(delayDebounce);
  }, [employees, effectiveMonthDays, monthLabel, activeCompany, dbLoading, showNoDataModal, saveRetryToken]);

  // Auto-save salary/day + bonus/day rates to the shared cloud store whenever
  // they change, so every month and every visitor picks up the new rate.
  // Debounced and skipped when unchanged so unrelated edits (manual days,
  // deductions, etc.) don't trigger redundant writes.
  useEffect(() => {
    if (dbLoading || showNoDataModal) return;
    // Same scope guard as the month save: a company switch must not push the
    // previous company's people into the new company's shared rate card.
    if (loadedForRef.current !== scopeOf(activeCompany, monthLabel)) return;
    const nextRates = buildRateMap(employees);
    const signature = JSON.stringify(nextRates);
    if (signature === ratesSignatureRef.current) return;

    const delayDebounce = setTimeout(async () => {
      try {
        const result = await saveEmployeeRates(activeCompany, nextRates);
        if (result.ok) {
          ratesSignatureRef.current = signature;
          setEmployeeRates(nextRates);
          setSaveError(null);
        } else {
          setSaveError(result.error || "Failed to save employee rates.");
        }
      } catch (err: any) {
        console.error("Failed to save employee rates:", err);
        setSaveError(err?.message || "Failed to save employee rates.");
      }
    }, 2000);

    return () => clearTimeout(delayDebounce);
  }, [employees, activeCompany, monthLabel, dbLoading, showNoDataModal, saveRetryToken]);

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
              setSaveRetryToken((n) => n + 1);
            }}
          >
            Retry save
          </button>
        </div>
      )}
      <main className="app-shell">
        {/* One compact bar: identity, month, and the four actions. The old
            eyebrow and hero paragraph told a daily user nothing and cost ~90px
            of permanent scroll depth, so the company and month became inline
            editable fields here instead of a separate control strip. */}
        <section className="appbar">
          <div className="appbar-identity">
            <div className="company-switch" role="tablist" aria-label="Select company">
              {COMPANIES.map((company) => (
                <button
                  key={company.code}
                  type="button"
                  role="tab"
                  aria-selected={activeCompany === company.code}
                  className={`company-tab ${activeCompany === company.code ? "active" : ""}`}
                  onClick={() => handleSwitchCompany(company.code)}
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
              onChange={(event) => setCompanyName(event.target.value)}
            />
            <span className="title-suffix">Payroll</span>
            <input
              className="month-input"
              value={monthLabel}
              aria-label="Month"
              title="Month"
              onBlur={commitMonthLabel}
              onChange={(event) => updateMonthLabel(event.target.value)}
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
              onClick={() => setIsRulesOpen(true)}
              title="Calculation rules applied to this sheet"
            >
              <BookOpen size={17} />
              Rules
            </button>
            <button className="ghost-button" type="button" onClick={exportCsv}>
              <FileDown size={17} />
              CSV
            </button>
            <button
              className="ghost-button"
              type="button"
              onClick={() => setIsDbModalOpen(true)}
              title={dbLoading ? "Syncing with cloud database..." : "Cloud database connected"}
            >
              {dbLoading ? (
                <RefreshCw size={17} className="spin-icon" style={{ color: "#2563eb" }} />
              ) : (
                <Cloud size={17} style={{ color: "#2563eb" }} />
              )}
              {dbLoading ? "Syncing" : "Cloud"}
            </button>
            <button className="primary-button" type="button" onClick={exportWorkbook}>
              <FileSpreadsheet size={17} />
              Excel
            </button>
          </div>
        </section>

        {/* The four totals that used to be 118px-tall cards. Net Payable stays
            emphasized and on screen at every scroll position; the sticky totals
            row at the foot of the table is its filtered counterpart. */}
        <section className="totals-strip" aria-label="Month totals">
          <div className="totals-net">
            <IndianRupee size={18} />
            <span>Net Payable</span>
            <strong>{currency(totals.net)}</strong>
          </div>
          <div className="totals-item" title={`${currency(totals.deductions)} total deductions`}>
            <span>Gross</span>
            <strong>{currency(totals.gross)}</strong>
          </div>
          <div
            className="totals-item"
            title={`${currency(totals.employerPf)} PF + ${currency(totals.employerEsi)} ESI (Employer)`}
          >
            <span>PF + ESI + P-Tax</span>
            <strong>{currency(totals.pf + totals.esi + totals.professionalTax)}</strong>
          </div>
          <div className="totals-item">
            <span>Employer Cost</span>
            <strong>{currency(totals.cost)}</strong>
          </div>
          <div className="totals-item">
            <span>Employees</span>
            <strong>{totals.employees}</strong>
          </div>
        </section>

        <section className="workspace-grid">
          <article className="panel table-panel">
            {/* Tabs, not a label-flipping toggle. The old button read "Show Main
                Sheet" while you were on Reference, so the control announced the
                opposite of the current state — and the two sheets differ in
                columns, ESI treatment and whether export is allowed. */}
            <div className="panel-heading">
              <div className="sheet-tabs" role="tablist" aria-label="Select sheet">
                <button
                  type="button"
                  role="tab"
                  aria-selected={sheetMode === "reference"}
                  className={`sheet-tab ${sheetMode === "reference" ? "active" : ""}`}
                  onClick={() => setSheetMode("reference")}
                >
                  <Calculator size={15} />
                  Reference
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={sheetMode === "main"}
                  className={`sheet-tab ${sheetMode === "main" ? "active" : ""}`}
                  onClick={() => setSheetMode("main")}
                >
                  <FileSpreadsheet size={15} />
                  Main Sheet
                  {totals.unpackableCount > 0 ? (
                    <span
                      className="tab-badge"
                      title={`${totals.unpackableCount} unpackable row(s) — Excel export is blocked`}
                    >
                      {totals.unpackableCount}
                    </span>
                  ) : null}
                </button>
              </div>
              <div className="panel-actions">
                <span className="search-box">
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
              className={`table-wrap ${sheetMode === "main" ? "table-wrap--official" : ""}`}
            >
              {sheetMode === "reference" ? (
                <table>
                  <thead>
                    <tr>
                      <th onClick={() => handleRefSort("name")} className="sortable-th">
                        Name {refSortField === "name" && (refSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleRefSort("category")} className="sortable-th">
                        Category {refSortField === "category" && (refSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      {/* Days and Extra are always read together and are the two
                          narrowest inputs on the sheet, so they share one cell
                          rather than each paying for a column of padding. */}
                      <th
                        onClick={() => handleRefSort("daysWorked")}
                        className="sortable-th"
                        title="Days worked + extra days. Sorts by days worked."
                      >
                        Days + Extra {refSortField === "daysWorked" && (refSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleRefSort("earnedSalary")} className="sortable-th">
                        Earned {refSortField === "earnedSalary" && (refSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleRefSort("basicSalary")} className="sortable-th">
                        Basic {refSortField === "basicSalary" && (refSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleRefSort("hra")} className="sortable-th">
                        HRA {refSortField === "hra" && (refSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleRefSort("travelAllowance")} className="sortable-th">
                        TA {refSortField === "travelAllowance" && (refSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleRefSort("performanceBonus")} className="sortable-th">
                        Bonus {refSortField === "performanceBonus" && (refSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleRefSort("specialBonus")} className="sortable-th">
                        Sp Bonus {refSortField === "specialBonus" && (refSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleRefSort("employeePf")} className="sortable-th">
                        PF {refSortField === "employeePf" && (refSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleRefSort("esi")} className="sortable-th">
                        ESI {refSortField === "esi" && (refSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleRefSort("professionalTax")} className="sortable-th">
                        P-Tax {refSortField === "professionalTax" && (refSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleRefSort("advance")} className="sortable-th">
                        Advance {refSortField === "advance" && (refSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleRefSort("netPayable")} className="sortable-th">
                        Net Pay {refSortField === "netPayable" && (refSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedFilteredRows.map((row) => {
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
                                onChange={(event) => updateEmployee(row.id, "name", event.target.value)}
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
                                onChange={(event) => updateEmployee(row.id, "category", event.target.value)}
                              >
                                {CATEGORIES.map((c) => (
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
                                  onChange={(value) => updateEmployee(row.id, "daysWorked", value)}
                                />
                                <span className="days-plus">+</span>
                                <NumberInput
                                  className="number-input number-input--compact"
                                  value={row.extraDays}
                                  min={0}
                                  disabled={isSpecial}
                                  dataCell="extraDays"
                                  title="Extra days"
                                  onChange={(value) => updateEmployee(row.id, "extraDays", value)}
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
                                onChange={(value) => updateEmployee(row.id, "specialBonus", value)}
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
                                onChange={(value) => updateEmployee(row.id, "advance", value)}
                              />
                            </td>
                            <td className="net-cell">{num(row.netPayable)}</td>
                            <td className="actions-cell">
                              <div className="cell-row cell-row--end">
                              <button
                                className={row.notes?.trim() ? "icon-button has-notes" : "icon-button"}
                                title={row.notes?.trim() ? `Employee settings — notes:\n${row.notes}` : "Employee settings"}
                                type="button"
                                onClick={() => {
                                  setRateMode(null);
                                  setNotesOpen(false);
                                  setOpenSettingsId((current) => (current === row.id ? null : row.id));
                                }}
                              >
                                <Settings2 size={16} />
                              </button>
                              <button
                                className="delete-button"
                                title="Remove employee"
                                type="button"
                                onClick={() => removeEmployee(row.id)}
                              >
                                <Trash2 size={16} />
                              </button>
                              </div>
                            </td>
                          </tr>
                          {openSettingsId === row.id ? (
                            <tr className="settings-row">
                              <td colSpan={15}>
                                <div className="settings-panel">
                                  {/* Salary can be typed either way round — the button
                                      switches the input mode and converts (M = D × r).
                                      The stored anchor still follows Category (SPEC §2.2):
                                      Unskilled keeps the day rate, the rest keep the
                                      monthly package. Special has no day rate at all. */}
                                  {!isSpecial ? (
                                    <div className="settings-column">
                                      <span>Salary Input</span>
                                      <button
                                        type="button"
                                        className="rate-mode-toggle"
                                        aria-pressed={perDayInput}
                                        title="Switch between typing salary per day and per month"
                                        onClick={() => setRateMode(perDayInput ? "perMonth" : "perDay")}
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
                                      <div className="settings-column">
                                        <span>Salary per Day</span>
                                        <NumberInput
                                          value={row.salaryPerDay}
                                          min={0}
                                          onChange={(value) => updateEmployee(row.id, "salaryPerDay", value)}
                                        />
                                        <small>Applies to every month for this employee</small>
                                      </div>
                                      <div className="settings-column">
                                        <span>Bonus per Day</span>
                                        <NumberInput
                                          value={row.bonusPerDay}
                                          min={0}
                                          onChange={(value) => updateEmployee(row.id, "bonusPerDay", value)}
                                        />
                                        <small>Applies to every month for this employee</small>
                                      </div>
                                      <div className="settings-column">
                                        <span>Salary per Month</span>
                                        <strong>{currency(row.monthlySalary)}</strong>
                                        <small>{effectiveMonthDays} days &times; {currency(row.salaryPerDay)}</small>
                                      </div>
                                      <div className="settings-column">
                                        <span>Total Salary</span>
                                        <strong>{currency(row.totalSalary)}</strong>
                                        <small>{effectiveMonthDays} days &times; ({currency(row.salaryPerDay)} + {currency(row.bonusPerDay)})</small>
                                      </div>
                                    </>
                                  ) : (
                                    <>
                                      <div className="settings-column">
                                        <span>Salary per Month</span>
                                        <NumberInput
                                          value={row.monthlySalary}
                                          min={0}
                                          onChange={(value) => updateEmployee(row.id, "monthlySalary", value)}
                                        />
                                        <small>
                                          {isSpecial
                                            ? "Fixed package — paid in full every month"
                                            : `Day rate ${currency(row.salaryPerDay)} is derived from it`}
                                        </small>
                                      </div>
                                      <div className="settings-column">
                                        <span>Allowance / Month</span>
                                        <NumberInput
                                          value={Math.max(0, roundMoney(row.totalSalary - row.monthlySalary))}
                                          min={0}
                                          onChange={(value) => updateEmployee(row.id, "allowance", value)}
                                        />
                                        <small>
                                          Total Salary <strong>{currency(row.totalSalary)}</strong> = monthly + allowance
                                          {row.totalSalary > row.monthlySalary
                                            ? ` — sets bonus/day ${currency(row.bonusPerDay)} and the Official 51% basic floor`
                                            : " — 0 means no allowance"}
                                        </small>
                                      </div>
                                    </>
                                  )}
                                  <div className="settings-column">
                                    <span>TDS</span>
                                    <NumberInput
                                      value={row.otherDeduction}
                                      min={0}
                                      onChange={(value) => updateEmployee(row.id, "otherDeduction", value)}
                                    />
                                  </div>
                                  <div className="settings-column">
                                    <span>Basic %</span>
                                    <strong>{row.basicPercent}%</strong>
                                    <input
                                      className="basic-slider"
                                      type="range"
                                      min={MIN_BASIC_PERCENT}
                                      max={MAX_BASIC_PERCENT}
                                      step="1"
                                      value={clampBasicPercent(row.basicPercent)}
                                      onChange={(event) =>
                                        updateEmployee(row.id, "basicPercent", Number(event.target.value))
                                      }
                                    />
                                  </div>
                                  <div className="settings-column">
                                    <span>PF</span>
                                    <strong>{row.pfOptIn ? "On" : "Off"}</strong>
                                    <small>{row.monthlySalary * (row.basicPercent / 100) > PF_BASIC_LIMIT ? `PF is off automatically above ${currency(PF_BASIC_LIMIT)} Basic` : "Toggle controls employee PF choice"}</small>
                                    <button
                                      type="button"
                                      className={row.pfOptIn ? "toggle-on" : "toggle-off"}
                                      disabled={isSpecial}
                                      onClick={() => updateEmployee(row.id, "pfOptIn", !row.pfOptIn)}
                                    >
                                      {row.pfOptIn ? "Turn Off" : "Turn On"}
                                    </button>
                                  </div>
                                  <div className="settings-column">
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
                                      className={row.esiOptIn ? "toggle-on" : "toggle-off"}
                                      disabled={isSpecial}
                                      onClick={() =>
                                        esiOverLimit
                                          ? updateEmployee(row.id, "esiOverLimitOptIn", !row.esiOptIn)
                                          : updateEmployee(row.id, "esiOptIn", !row.esiOptIn)
                                      }
                                    >
                                      {row.esiOptIn ? "Turn Off" : "Turn On"}
                                    </button>
                                  </div>
                                  {/* Category used to be repeated here as read-only
                                      text; it is already an editable dropdown in
                                      the row itself, and its Special explanation
                                      now lives on that dropdown's tooltip. */}
                                  <div className="settings-column">
                                    <span>Notes</span>
                                    <button
                                      type="button"
                                      className="notes-toggle"
                                      aria-expanded={notesOpen}
                                      onClick={() => setNotesOpen((open) => !open)}
                                    >
                                      <ChevronDown size={13} className={notesOpen ? "rot" : undefined} />
                                      {row.notes?.trim() ? "Edit notes" : "Add notes"}
                                    </button>
                                  </div>
                                  {notesOpen ? (
                                    <div className="settings-column settings-column--full">
                                      <textarea
                                        className="notes-input"
                                        rows={3}
                                        placeholder={"Increments and anything else worth keeping.\nApr-26 +500 allowance (now 1500)"}
                                        value={row.notes ?? ""}
                                        onChange={(event) => updateEmployee(row.id, "notes", event.target.value)}
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
                          Total — {filteredRows.length} of {salaryRows.length} shown
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
              ) : (
                <table className="official-table">
                  <thead>
                    <tr>
                      <th onClick={() => handleOfficialSort("name")} className="sortable-th">
                        Name {officialSortField === "name" && (officialSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleOfficialSort("wageCategory")} className="sortable-th">
                        Category {officialSortField === "wageCategory" && (officialSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleOfficialSort("attendance")} className="sortable-th">
                        Attendance {officialSortField === "attendance" && (officialSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleOfficialSort("extraDays")} className="sortable-th">
                        Extra Days {officialSortField === "extraDays" && (officialSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleOfficialSort("monthlyBasic")} className="sortable-th">
                        Official Basic {officialSortField === "monthlyBasic" && (officialSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleOfficialSort("monthlyHra")} className="sortable-th">
                        HRA {officialSortField === "monthlyHra" && (officialSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleOfficialSort("monthlyTravelAllowance")} className="sortable-th">
                        TA {officialSortField === "monthlyTravelAllowance" && (officialSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleOfficialSort("bonus")} className="sortable-th">
                        Bonus {officialSortField === "bonus" && (officialSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleOfficialSort("pf")} className="sortable-th">
                        PF {officialSortField === "pf" && (officialSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleOfficialSort("esi")} className="sortable-th">
                        ESI {officialSortField === "esi" && (officialSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleOfficialSort("professionalTax")} className="sortable-th">
                        P-Tax {officialSortField === "professionalTax" && (officialSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleOfficialSort("advance")} className="sortable-th">
                        Advance {officialSortField === "advance" && (officialSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleOfficialSort("netPayable")} className="sortable-th">
                        Net Pay {officialSortField === "netPayable" && (officialSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleOfficialSort("referenceNetPayable")} className="sortable-th">
                        Reference Net {officialSortField === "referenceNetPayable" && (officialSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedFilteredOfficialRows.map((row) => {
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
                    {!filteredOfficialRows.length ? (
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
                  {filteredOfficialRows.length ? (
                    <tfoot>
                      <tr className="totals-row">
                        <th scope="row" colSpan={2}>
                          Total — {filteredOfficialRows.length} of {officialRows.length} shown
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
              )}
            </div>
          </article>

          {/* The Rules wall of text moved into a dialog and the "Ready to Pay"
              panel was deleted — it was the fourth copy of Net Payable, which
              the totals strip and the sticky totals row now cover. The chart
              stays: it is the only thing here you cannot read off the table. */}
          <aside className="side-stack">
            <article className="panel">
              <div className="panel-heading compact">
                <div>
                  <h2><BarChart3 size={18} /> Category Net Pay</h2>
                  <p>Largest groups</p>
                </div>
              </div>
              <div className="bar-list">
                {categoryTotals.map((item) => {
                  const width = totals.net ? Math.max(8, (item.total / totals.net) * 100) : 0;
                  return (
                    <div className="bar-row" key={item.category}>
                      <div className="bar-label">
                        <span>{item.category}</span>
                        <strong>{currency(item.total)}</strong>
                      </div>
                      <div className="bar-track">
                        <span style={{ width: `${width}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>
          </aside>
        </section>
      </main>

      {isRulesOpen && (
        <div className="modal-overlay" onClick={() => setIsRulesOpen(false)}>
          <div
            className="modal rules-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="rules-modal-head">
              <div>
                <span className="modal-eyebrow">Reference</span>
                <h2>Calculation Rules</h2>
              </div>
              <button className="close-modal" type="button" onClick={() => setIsRulesOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="rule-list">
              <Rule label="Category" value="Chosen per employee — Unskilled, Semi-skilled, Skilled or Special. Never inferred from salary." />
              <Rule label="Salary Anchor" value="Unskilled is anchored on salary/day; the rest on salary/month. Either can be typed — Settings has a Per Day / Per Month switch." />
              <Rule label="Calendar Days" value={`${effectiveMonthDays} days for ${monthLabel || "selected month"}`} />
              <Rule label="Earned Salary" value="Salary/Month / calendar days x Days Worked" />
              <Rule label="Reference Basic" value="Earned Salary x Basic %" />
              <Rule label="Main PF Attendance" value={`Starts at 26 - (${effectiveMonthDays} - Days Worked), then reduces if Basic plus Bonus is too high`} />
              <Rule label="Official Basic" value="Attendance x category daily wage" />
              <Rule label="Zone A Day Rate" value="Unskilled 400, Semi-skilled 440, Skilled 484" />
              <Rule label="Days Worked" value="Entered manually per employee for the selected month" />
              <Rule label="Extra Days" value="Entered manually; shown on both sheets and used for the Reference performance bonus" />
              <Rule
                label="HRA"
                value={`${HRA_SHARE_OF_BALANCE * 100}% of prorated Total Salary minus Basic`}
              />
              <Rule
                label="Travel Allowance"
                value={`${TA_SHARE_OF_BALANCE * 100}% of prorated Total Salary minus Basic`}
              />
              <Rule
                label="PF"
                value={`${PF_RATE * 100}% on Basic (capped at ${currency(PF_BASIC_LIMIT)} Basic) when PF is enabled`}
              />
              <Rule label="ESI" value={`${ESI_RATE * 100}% on Earned Salary when ESI is enabled. Off by default above ${currency(ESI_GROSS_LIMIT)} Total Salary — enable it per employee in Settings, and the main-sheet Basic is held under ${currency(ESI_GROSS_LIMIT)} so it applies`} />
              <Rule label="P-Tax" value="Based on Gross Payable (before PF/ESI) slab" />
              <Rule label="Advance" value="Amount advanced to the employee, recovered from this month's net pay" />
              <Rule label="Performance Bonus" value="(salary/day + bonus/day) x Extra Days" />
              <Rule
                label="Reference Sheet"
                value="Category is set by hand, never guessed from salary. Earned is Salary/Month prorated by Days Worked. Basic is Earned x Basic %. HRA and TA split prorated Total Salary minus Basic in a 70% / 30% ratio."
              />
              <Rule
                label="Main Sheet"
                value={`For PF-on rows, main-sheet attendance starts at 26 - (${effectiveMonthDays} calendar days - Days Worked), then reduces when needed so Basic always equals attendance x category daily wage and Main Bonus is at least the Reference Daily Bonus Amount. HRA/travel allowance are Days-Worked-prorated, and any excess target gross is shown as Bonus so net pay matches the reference sheet. PF-off rows stay aligned with the reference sheet.`}
              />
            </div>
          </div>
        </div>
      )}

       {showNoDataModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: "500px", height: "auto", padding: "28px" }}>
            <div style={{ marginBottom: "20px" }}>
              <span className="modal-eyebrow">Database Notice</span>
              <h2 style={{ fontSize: "20px", fontWeight: 700, margin: "8px 0" }}>
                Initialize {activeCompany} &middot; {noDataMonth}
              </h2>
              <p style={{ color: "#667085", fontSize: "14px", lineHeight: "1.5" }}>
                No records exist for <strong>{companyName || activeCompany}</strong> in <strong>{noDataMonth}</strong> yet. How would you like to initialize this month?
              </p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "24px" }}>
              {allMonths.filter(m => m !== noDataMonth).length > 0 && (
                <div style={{ padding: "14px", border: "1px solid #e2e8f0", borderRadius: "8px", background: "#f8fafc" }}>
                  <label style={{ fontSize: "11px", fontWeight: "bold", textTransform: "uppercase", display: "block", marginBottom: "6px" }}>
                    Copy Employees From:
                  </label>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <select
                      value={copySourceMonth}
                      onChange={(e) => setCopySourceMonth(e.target.value)}
                      style={{ flex: 1, padding: "8px", border: "1px solid #cbd5e1", borderRadius: "6px", background: "#fff", fontSize: "14px" }}
                    >
                      {allMonths.filter(m => m !== noDataMonth).map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    <button
                      className="primary-button"
                      onClick={() => handleCopyMonth(copySourceMonth)}
                      style={{ padding: "0 14px", height: "38px", fontSize: "13px" }}
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}

              {activeCompany === "NKPL" && (
                <button
                  className="ghost-button"
                  onClick={handleCreateSampleMonth}
                  style={{ justifyContent: "center", height: "42px", fontWeight: "600", color: "#2563eb", borderColor: "#2563eb", background: "rgba(37,99,235,0.04)" }}
                >
                  Use Default Sample Employees
                </button>
              )}

              <button
                className="quiet-button"
                onClick={handleCreateBlankMonth}
                style={{ justifyContent: "center", height: "42px", fontWeight: "500", border: "1px solid #cbd5e1" }}
              >
                Start with a Blank Sheet
              </button>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                className="quiet-button"
                onClick={handleCancelNoData}
                style={{ color: "#ef4444", fontWeight: "600" }}
              >
                Cancel & Restore Previous Month
              </button>
            </div>
          </div>
        </div>
      )}

      {isDbModalOpen && (
        <div className="modal-overlay" onClick={() => setIsDbModalOpen(false)}>
          <div
            className="modal"
            style={{ maxWidth: "600px", height: "auto", padding: "28px" }}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <div>
                <span className="modal-eyebrow">Database Settings</span>
                <h2 style={{ fontSize: "20px", fontWeight: 700, margin: "4px 0" }}>Database Sync & Backup</h2>
              </div>
              <button className="close-modal" onClick={() => setIsDbModalOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <div style={{ marginBottom: "24px" }}>
              <div style={{ marginBottom: "20px", padding: "16px", background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: "10px", color: "#065f46", fontSize: "14px", display: "flex", gap: "10px", alignItems: "flex-start" }}>
                <Cloud size={20} style={{ color: "#059669", flexShrink: 0, marginTop: "2px" }} />
                <div>
                  <strong style={{ display: "block", marginBottom: "4px", fontSize: "15px" }}>Redis Sync Active</strong>
                  Payroll is stored in Redis and is the single source of truth. Every month record and the shared rate card load and sync automatically by company and month for everyone who opens the app &mdash; NKPL and APTUS data are kept completely separate.
                </div>
              </div>

              <div style={{ marginBottom: "20px", padding: "12px 16px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", color: "#64748b", fontSize: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
                <Wifi size={18} style={{ color: "#2563eb", flexShrink: 0 }} />
                <div>
                  <strong>Local Caching Active:</strong> Local Storage caches the data locally in your browser to ensure offline support and maximum speed.
                </div>
              </div>

              <div style={{ fontSize: "13px", color: "#64748b", background: "#f8fafc", padding: "14px", borderRadius: "8px", border: "1px solid #e2e8f0", lineHeight: "1.5" }}>
                <strong>Keys in use:</strong>
                <ul style={{ paddingLeft: "18px", marginTop: "6px", display: "flex", flexDirection: "column", gap: "4px", listStyleType: "disc" }}>
                  <li><code>monthly_salary/&lt;company&gt;/&lt;month&gt;</code> &mdash; one record per company per month.</li>
                  <li><code>employee_rates/&lt;company&gt;</code> &mdash; the shared rate card that carries across months.</li>
                  <li>The connection string never reaches the browser; all reads and writes go through <code>/api/db</code> and <code>/api/rates</code>.</li>
                </ul>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
              <button
                className="quiet-button"
                onClick={() => setIsDbModalOpen(false)}
                style={{ fontWeight: "600" }}
              >
                Close Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          className={`custom-toast ${toast.type}`}
          role="status"
          aria-live="polite"
          onClick={() => setToast(null)}
        >
          {toast.type === "success" ? <Check size={16} /> : <AlertTriangle size={16} />}
          <span>{toast.message}</span>
        </div>
      )}
    </>
  );
}

function NumberInput({
   value,
  onChange,
  className = "number-input",
  min,
  max,
  allowBlank = false,
  disabled = false,
  dataCell,
  title,
}: {
  value: number | undefined | "";
  onChange: (value: number | undefined) => void;
  className?: string;
  min?: number;
  max?: number;
  allowBlank?: boolean;
  disabled?: boolean;
  // Opts this input into arrow-key column navigation — see handleGridKey.
  dataCell?: string;
  title?: string;
}) {
  const canonical =
    allowBlank && (value === undefined || value === "") ? "" : Number.isFinite(value) ? value : 0;
  // While the field is focused we show exactly what was typed. The model still
  // updates on every keystroke, but a value that comes back rounded or derived
  // (Salary per Month for Unskilled, Allowance) must not overwrite the digits
  // mid-word — that made the box snap to 0 or refuse the number entered.
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className={className}
      type="number"
      min={min}
      max={max}
      value={draft ?? canonical}
      disabled={disabled}
      data-cell={dataCell}
      title={title}
      onFocus={(event) => setDraft(event.target.value)}
      onBlur={() => setDraft(null)}
      onChange={(event) => {
        const val = event.target.value;
        setDraft(val);
        if (val === "") {
          onChange(allowBlank ? undefined : 0);
        } else {
          onChange(numberValue(val));
        }
      }}
    />
  );
}

function Rule({ label, value }: { label: string; value: string }) {
  return (
    <div className="rule-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default App;
