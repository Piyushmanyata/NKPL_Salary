import {
  BarChart3,
  Calculator,
  CheckCircle2,
  FileDown,
  FileSpreadsheet,
  IndianRupee,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  Upload,
  Users,
  AlertTriangle,
  Calendar,
  Clock,
  X,
  Check,
  Info,
  Cloud,
  Wifi,
  Building2,
} from "lucide-react";
import { ChangeEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";
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
  calculateSalary,
  clampBasicPercent,
  clampDays,
  clampMonthDays,
  currency,
  dailyFromMonthly,
  isSpecialCategory,
  monthlyFromDaily,
  numberValue,
  repairRates,
  roundMoney,
  uid,
} from "./salary";
import type { AttendanceEmployee, Category, EmployeeInput, SalaryRow } from "./types";
import { buildOfficialRow, normalizeCategory } from "./officialSheet";

const CATEGORIES: Category[] = ["Unskilled", "Semi-skilled", "Skilled", "Special"];
import {
  calculateEmployeeAttendanceStats,
  calendarDaysForMonth,
  getBestWorksheet,
  namesMatch,
  parseAttendanceExcel,
  pickCarrySource,
  sortMonthsChronologically,
} from "./attendance";

type SheetMode = "reference" | "main";

const COMPANIES = [
  { code: "NKPL", label: "NKPL" },
  { code: "APTUS", label: "APTUS" },
] as const;

type CompanyCode = (typeof COMPANIES)[number]["code"];

const blankEmployee = (monthDays: number): EmployeeInput => ({
  id: uid(),
  name: "New Employee",
  category: "Skilled",
  isSecurity: false,
  monthlySalary: 0,
  salaryPerDay: 0,
  bonusPerDay: 0,
  daysWorked: monthDays,
  extraDays: 0,
  basicPercent: 70,
  pfOptIn: true,
  esiOptIn: true,
  advance: undefined,
  otherDeduction: 0,
  specialBonus: undefined,
});

/** One-time name heuristic for back-filling isSecurity when the flag is absent. */
const nameLooksLikeSecurity = (name: string) => /\(?\s*security\s*\)?/i.test(name);

const sum = (rows: SalaryRow[], key: keyof SalaryRow) =>
  rows.reduce((total, row) => total + numberValue(row[key]), 0);

const DEFAULT_COMPANY: CompanyCode = "NKPL";
const legacyMonthConfigStorageKey = "salary-sheet-month-config";
const activeCompanyStorageKey = "salary-sheet-active-company";
const monthConfigStorageKey = (company: string) => `salary-sheet-month-config-${company}`;
const companyLabelStorageKey = (company: string) => `salary-sheet-company-label-${company}`;
const csvEscape = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
const htmlEscape = (value: string | number) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const booleanValue = (value: unknown) =>
  value === true || value === "true" || value === "yes" || value === "on" || value === 1;
// Neutralize spreadsheet formula injection: a free-text name starting with
// =, +, -, or @ would otherwise execute as a formula when the exported
// CSV/Excel file is opened. Prefixing with an apostrophe forces text.
const sanitizeSpreadsheetCell = (value: string) => (/^[=+\-@]/.test(value) ? `'${value}` : value);

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

const loadXLSX = () => import("xlsx");

function loadActiveCompany(): CompanyCode {
  try {
    const stored = localStorage.getItem(activeCompanyStorageKey);
    if (stored && COMPANIES.some((company) => company.code === stored)) {
      return stored as CompanyCode;
    }
  } catch {
    // ignore
  }
  return DEFAULT_COMPANY;
}

function loadCompanyLabel(company: CompanyCode): string {
  try {
    return localStorage.getItem(companyLabelStorageKey(company)) || company;
  } catch {
    return company;
  }
}

function loadMonthConfig(company: CompanyCode) {
  try {
    const raw =
      localStorage.getItem(monthConfigStorageKey(company)) ??
      (company === DEFAULT_COMPANY ? localStorage.getItem(legacyMonthConfigStorageKey) : null) ??
      "{}";
    const parsed = JSON.parse(raw) as {
      label?: unknown;
      days?: unknown; // ignored — D is derived from label (TICKET-03)
    };
    const label = String(parsed.label || "May 2026");
    return {
      label,
      // Recompute days from the label; never trust a stored days value.
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

const sanitizeEmployee = (value: unknown, index: number, monthDays: number): EmployeeInput | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const row = value as Partial<EmployeeInput> & { isSpecial?: boolean };
  const name = String(row.name ?? "").trim();
  const rawMonthlySalary = Math.max(0, numberValue(row.monthlySalary));
  const hasSalaryPerDay =
    row.salaryPerDay !== undefined && row.salaryPerDay !== null && String(row.salaryPerDay).trim() !== "";

  // One-release shim: migrate legacy isSpecial flag → Category "Special" (TICKET-01).
  let category = normalizeCategory(row.category);
  if (row.isSpecial === true) {
    category = "Special";
  }
  if (category === null) {
    // Unrecognizable strings fall back visibly to Unskilled rather than salary-band guessing.
    category = "Unskilled";
  }
  const isSpecial = category === "Special";
  // Persist isSecurity; back-fill once from name when the field is absent (TICKET-02).
  const isSecurity =
    row.isSecurity !== undefined && row.isSecurity !== null
      ? Boolean(row.isSecurity)
      : nameLooksLikeSecurity(name);

  const days = clampMonthDays(monthDays);
  const rawSalaryPerDay = hasSalaryPerDay ? Math.max(0, numberValue(row.salaryPerDay)) : 0;
  const rawBonusPerDay = Math.max(0, numberValue(row.bonusPerDay));
  // One-time rate repair at load (SPEC §2.2.1 / TICKET-04). Persisted after this.
  const repaired = repairRates(category, rawMonthlySalary, rawSalaryPerDay, rawBonusPerDay, days);
  const monthlySalary = repaired.monthlySalary;
  const salaryPerDay = repaired.salaryPerDay;
  const bonusPerDay = repaired.bonusPerDay;

  if (!name && monthlySalary <= 0 && salaryPerDay <= 0) {
    return null;
  }

  return {
    id: String(row.id || `emp-${Date.now()}-${index}`),
    name,
    category,
    isSecurity,
    monthlySalary,
    // Typed package anchor for the fixed-monthly categories; never below M, and
    // never stored for Unskilled (whose total stays derived from r and b).
    totalSalary:
      category === "Unskilled"
        ? undefined
        : Math.max(0, numberValue(row.totalSalary)) > monthlySalary
          ? Math.max(0, numberValue(row.totalSalary))
          : undefined,
    salaryPerDay,
    bonusPerDay,
    daysWorked: isSpecial ? days : clampDays(numberValue(row.daysWorked), days),
    // Security keeps typed Extra Days (the Sunday package is still withheld by
    // the attendance layer); only Special has none at all.
    extraDays: isSpecial ? 0 : Math.max(0, numberValue(row.extraDays)),
    basicPercent: clampBasicPercent(row.basicPercent),
    pfOptIn: isSpecial ? false : row.pfOptIn !== false,
    esiOptIn: isSpecial ? false : row.esiOptIn !== false,
    // Positive advance = recovered from net. Negatives (legacy UI convention) clamp to absent.
    advance: row.advance !== undefined && row.advance !== null && String(row.advance).trim() !== "" && numberValue(row.advance) > 0 ? numberValue(row.advance) : undefined,
    otherDeduction: Math.max(0, numberValue(row.otherDeduction)),
    // performanceBonus / officialAttendance / officialBonus are not inputs (TICKET-10).
    // Legacy stored keys are ignored on read and drop out on next save.
    specialBonus: row.specialBonus !== undefined && row.specialBonus !== null && String(row.specialBonus).trim() !== "" ? numberValue(row.specialBonus) : undefined,
  };
};

// A new month inherits the roster and every standing rate from the month
// before it — salary, allowance, category, PF/ESI choices and TDS all carry.
// Only the per-month inputs reset, because attendance is the thing that
// actually differs month to month. Days Worked starts at full attendance and
// the Attendance Checker (or the user) marks people down from there; carrying
// last month's absences forward would quietly bill them twice.
const carryForwardEmployee = (employee: EmployeeInput, monthDays: number): EmployeeInput => ({
  ...employee,
  daysWorked: clampMonthDays(monthDays),
  extraDays: 0,
  advance: undefined,
  specialBonus: undefined,
});

// NKPL is the only company with bundled sample/demo data; a newly added
// company like APTUS starts blank until real employees are entered. Loaded on
// demand so ~30 kB of seed roster stays out of the initial bundle — it is only
// ever needed behind the "Use Default Sample Employees" button.
const defaultEmployeesForCompany = async (
  company: CompanyCode,
  monthLabel?: string,
): Promise<EmployeeInput[]> => {
  if (company !== "NKPL") {
    return [];
  }
  // NKPL's real June 2026 payroll sheet is the bundled default for that
  // specific month; every other month falls back to the general sample
  // roster (originally sourced from May 2026).
  if (monthLabel && normalizeMonthLabel(monthLabel) === "June 2026") {
    return (await import("./juneEmployees")).juneEmployees;
  }
  return (await import("./sampleEmployees")).sampleEmployees;
};

// Salary/day and bonus/day are shared across every month for a given
// employee (see api/rates.ts) -- overlay the shared rate on top of whatever
// per-month snapshot was loaded so every month always reflects the latest
// rate, and every employee not yet in the shared store keeps its own value.
const applyEmployeeRates = (list: EmployeeInput[], rates: EmployeeRateMap): EmployeeInput[] =>
  list.map((employee) => {
    const rate = rates[employee.id];
    if (!rate) {
      return employee;
    }
    const monthlySalary = Math.max(0, numberValue(rate.monthlySalary));
    const totalSalary = Math.max(0, numberValue(rate.totalSalary));
    return {
      ...employee,
      salaryPerDay: Math.max(0, numberValue(rate.salaryPerDay)),
      bonusPerDay: Math.max(0, numberValue(rate.bonusPerDay)),
      // Only overlay a package that was actually stored — a legacy rate blob has
      // neither field, and a 0 there must never wipe a good monthly salary.
      ...(monthlySalary > 0 ? { monthlySalary } : {}),
      ...(totalSalary > monthlySalary ? { totalSalary } : {}),
    };
  });

const buildRateMap = (list: EmployeeInput[]): EmployeeRateMap => {
  const map: EmployeeRateMap = {};
  list.forEach((employee) => {
    if (!employee.name.trim()) {
      return;
    }
    map[employee.id] = {
      id: employee.id,
      name: employee.name,
      salaryPerDay: Math.max(0, numberValue(employee.salaryPerDay)),
      bonusPerDay: Math.max(0, numberValue(employee.bonusPerDay)),
      monthlySalary: Math.max(0, numberValue(employee.monthlySalary)),
      totalSalary: Math.max(0, numberValue(employee.totalSalary)),
    };
  });
  return map;
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
  const [attendanceData, setAttendanceData] = useState<AttendanceEmployee[] | null>(null);
  const [attendanceMonth, setAttendanceMonth] = useState<string>("");
  const [isAttendanceModalOpen, setIsAttendanceModalOpen] = useState(false);
  const attendanceFileRef = useRef<HTMLInputElement>(null);
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

  // Shared salary/day + bonus/day rates for the active company, kept in sync
  // with the cloud store (see api/rates.ts) independently of month records.
  const [employeeRates, setEmployeeRates] = useState<EmployeeRateMap>({});
  const ratesSignatureRef = useRef<string>("");

  // Cloud Database Sync settings
  const [isDbModalOpen, setIsDbModalOpen] = useState(false);

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

  // The Attendance Checker is a local audit/import tool: it parses an uploaded
  // punch-in/out Excel file into a day-by-day breakdown purely to help review
  // and correct present days before syncing. The breakdown itself is never
  // persisted -- only its end result (each employee's present day count)
  // matters, and that lives in `daysWorked`, which is saved to Redis. So the
  // audit view is simply discarded whenever the month or company changes.
  useEffect(() => {
    setAttendanceData(null);
    setAttendanceMonth("");
  }, [monthLabel, activeCompany]);

  const salaryRows = useMemo(
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

  const filteredRows = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) {
      return salaryRows;
    }

    return salaryRows.filter((row) =>
      `${row.name} ${row.category}`.toLowerCase().includes(search),
    );
  }, [query, salaryRows]);

  const officialRows = useMemo(
    () => salaryRows.map((row) => buildOfficialRow(row, effectiveMonthDays)),
    [effectiveMonthDays, salaryRows],
  );

  const filteredOfficialRows = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) {
      return officialRows;
    }

    return officialRows.filter((row) =>
      `${row.name} ${row.sourceCategory} ${row.wageCategory}`.toLowerCase().includes(search),
    );
  }, [officialRows, query]);

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
    field: keyof EmployeeInput | "allowance",
    value: string | number | boolean | undefined,
  ) => {
    if (id === newlyAddedId && field === "name") {
      setNewlyAddedId(null);
    }
    setEmployees((current) => {
      const next = current.map((employee) => {
        if (employee.id !== id) {
          return employee;
        }

        if (field === "name") {
          const nameStr = String(value);
          if (isSpecialCategory(employee.category)) {
            return {
              ...employee,
              name: nameStr,
              daysWorked: effectiveMonthDays,
              pfOptIn: false,
              esiOptIn: false,
            };
          }
          return { ...employee, name: nameStr };
        }

        if (field === "category") {
          const next = normalizeCategory(value) ?? employee.category;
          if (next === "Special") {
            return {
              ...employee,
              category: next,
              salaryPerDay: 0,
              bonusPerDay: 0,
              extraDays: 0,
              daysWorked: effectiveMonthDays,
              pfOptIn: false,
              esiOptIn: false,
            };
          }
          return { ...employee, category: next };
        }

        if (field === "isSecurity") {
          const next = booleanValue(value);
          return {
            ...employee,
            isSecurity: next,
            // Toggling Security no longer wipes Extra Days — they stay manually
            // editable. Only Special has no Extra Days concept at all.
            extraDays: isSpecialCategory(employee.category) ? 0 : employee.extraDays,
          };
        }

        if (field === "pfOptIn" || field === "esiOptIn") {
          if (isSpecialCategory(employee.category)) {
            return { ...employee, pfOptIn: false, esiOptIn: false };
          }
          return {
            ...employee,
            [field]: booleanValue(value),
          };
        }

        // M and the Monthly Allowance are what the user types for the fixed-monthly
        // categories; T = M + allowance is the stored anchor and b is derived from it.
        // Editing M holds the allowance and carries T along; editing the allowance
        // leaves M alone. T at or below M means "no allowance".
        if (field === "monthlySalary" || field === "totalSalary" || field === "allowance") {
          const D = effectiveMonthDays;
          const oldM = Math.max(0, numberValue(employee.monthlySalary));
          const oldT = Math.max(0, numberValue(employee.totalSalary));
          const bonus = oldT > oldM ? (oldT - oldM) / D : Math.max(0, numberValue(employee.bonusPerDay));
          const typed = Math.max(0, numberValue(value));
          const monthlySalary = field === "monthlySalary" ? typed : oldM;
          // Unskilled stays anchored on the day rate (SPEC §2.2): a monthly figure
          // typed through the Per Month toggle is stored as M / D, and its monthly
          // allowance as allowance / D. Nothing else changes shape.
          if (employee.category === "Unskilled") {
            return {
              ...employee,
              monthlySalary,
              salaryPerDay: dailyFromMonthly(monthlySalary, D),
              bonusPerDay:
                field === "allowance" ? dailyFromMonthly(typed, D) : employee.bonusPerDay,
            };
          }
          const total =
            field === "totalSalary"
              ? typed
              : field === "allowance"
                ? monthlySalary + typed
                : monthlySalary + D * bonus;
          return {
            ...employee,
            monthlySalary,
            totalSalary: total > monthlySalary ? roundMoney(total) : undefined,
          };
        }

        // Mirror of the branch above for the Per Day input mode. Unskilled already
        // anchors on r; for the fixed-monthly categories a typed day rate sets the
        // package M = D × r and keeps whatever allowance was already on the row.
        if (field === "salaryPerDay" && employee.category !== "Unskilled") {
          const salaryPerDay = Math.max(0, numberValue(value));
          const monthlySalary = monthlyFromDaily(salaryPerDay, effectiveMonthDays);
          const allowance = Math.max(
            0,
            Math.max(0, numberValue(employee.totalSalary)) -
              Math.max(0, numberValue(employee.monthlySalary)),
          );
          return {
            ...employee,
            salaryPerDay,
            monthlySalary,
            totalSalary: allowance > 0 ? roundMoney(monthlySalary + allowance) : undefined,
          };
        }

        if (field === "basicPercent") {
          const basicPercent = clampBasicPercent(value);
          return {
            ...employee,
            basicPercent,
          };
        }

        if (field === "advance") {
          const val = value === undefined || value === "" ? undefined : Number(value);
          // Reject negatives: advance is stored positive and always subtracted (TICKET-06).
          if (val !== undefined && (Number.isNaN(val) || val < 0)) {
            return { ...employee, advance: undefined };
          }
          return {
            ...employee,
            advance: val === 0 || val === undefined ? undefined : val,
          };
        }

        if (field === "specialBonus") {
          const val = value === undefined || value === "" ? undefined : Number(value);
          return {
            ...employee,
            specialBonus: val,
          };
        }

        const numericValue = numberValue(value);
        const updated = { ...employee, [field]: numericValue };

        return updated;
      });
      return next;
    });
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
    // Attendance data belongs to the company it was loaded/uploaded for; clear it
    // so switching companies never shows one company's attendance audit against
    // another company's employee list.
    setAttendanceData(null);
    setAttendanceMonth("");
    setIsAttendanceModalOpen(false);
  };

  // Persist the active company selection and its display label
  useEffect(() => {
    try {
      localStorage.setItem(activeCompanyStorageKey, activeCompany);
    } catch {
      // ignore storage failures (e.g. private browsing)
    }
  }, [activeCompany]);

  useEffect(() => {
    try {
      localStorage.setItem(companyLabelStorageKey(activeCompany), companyName);
    } catch {
      // ignore storage failures
    }
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
    try {
      // Persist label only — days are always recomputed from the label (TICKET-03).
      localStorage.setItem(
        monthConfigStorageKey(activeCompany),
        JSON.stringify({ label: normalized }),
      );
    } catch {
      // ignore storage failures
    }
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
              showToast(`${normalized} started from ${source} — salaries kept, attendance reset`);
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

  // Auto-save changes to the database (with 500ms debounce to optimize writes)
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

    const delayDebounce = setTimeout(async () => {
      try {
        await saveMonthData(activeCompany, normalized, effectiveMonthDays, employees);
        // No month-list refetch here: every save targets a month that is already
        // in `allMonths` (it is put there when the month is created/carried), and
        // re-listing meant a full Redis SCAN after every debounced keystroke.
      } catch (err) {
        console.error("Failed to save month data:", err);
      }
    }, 500);

    return () => clearTimeout(delayDebounce);
  }, [employees, effectiveMonthDays, monthLabel, activeCompany, dbLoading, showNoDataModal]);

  // Auto-save salary/day + bonus/day rates to the shared cloud store whenever
  // they change, so every month and every visitor picks up the new rate.
  // Debounced and skipped when unchanged so unrelated edits (attendance,
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
        ratesSignatureRef.current = signature;
        setEmployeeRates(nextRates);
        await saveEmployeeRates(activeCompany, nextRates);
      } catch (err) {
        console.error("Failed to save employee rates:", err);
      }
    }, 500);

    return () => clearTimeout(delayDebounce);
  }, [employees, activeCompany, monthLabel, dbLoading, showNoDataModal]);

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

  // Carry a month's roster forward into `target`, resetting the per-month
  // attendance inputs. Shared by the automatic carry on opening a new month and
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
        showToast(`Carried ${source} forward to ${noDataMonth} (${targetDays} days, attendance reset)`);
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
    if (!isAttendanceModalOpen && !isDbModalOpen && !showNoDataModal) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (isDbModalOpen) {
        setIsDbModalOpen(false);
      } else if (isAttendanceModalOpen) {
        setIsAttendanceModalOpen(false);
      } else if (showNoDataModal) {
        handleCancelNoData();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isAttendanceModalOpen, isDbModalOpen, showNoDataModal]);

  const exportRows =
    sheetMode === "main"
      ? officialRows.map((row, index) => ({
          "Sl No": index + 1,
          "Employee Name": sanitizeSpreadsheetCell(row.name),
          "Source Category": row.sourceCategory,
          "Wage Category": row.wageCategory,
          "Employee Types": row.employeeTypes,
          "Allowed Basic": roundMoney(row.allowedBasic),
          "Official Basic": roundMoney(row.monthlyBasic),
          HRA: roundMoney(row.monthlyHra),
          "Travel Allowance": roundMoney(row.monthlyTravelAllowance),
          Attendance: row.attendance,
          Bonus: roundMoney(row.bonus),
          PF: roundMoney(row.pf),
          ESI: roundMoney(row.esi),
          "P-Tax": roundMoney(row.professionalTax),
          // Display sign: negative means recovered (engine stores positive).
          Advance: row.advance !== undefined && row.advance !== null ? -roundMoney(row.advance) : "",
          "Other Deduction": roundMoney(row.otherDeduction),
          "Net Payable": roundMoney(row.netPayable),
          "Reference Net Payable": roundMoney(row.referenceNetPayable),
        }))
      : salaryRows.map((row, index) => ({
          "Sl No": index + 1,
          "Employee Name": sanitizeSpreadsheetCell(row.name),
          Category: row.category,
          "Basic Percent": row.basicPercent,
          "Salary Per Day": roundMoney(row.salaryPerDay),
          "Bonus Per Day": roundMoney(row.bonusPerDay),
          "Salary Per Month": roundMoney(row.monthlySalary),
          "Total Salary": roundMoney(row.totalSalary),
          "Days Worked": row.daysWorked,
          "Extra Days": row.extraDays,
          "Absent Days": row.absentDays,
          "PF Opt In": row.pfOptIn ? "Yes" : "No",
          "ESI Opt In": row.esiOptIn ? "Yes" : "No",
          "Absent Deduction": roundMoney(row.absentDeduction),
          "Earned Salary": roundMoney(row.earnedSalary),
          "Basic Salary": roundMoney(row.basicSalary),
           HRA: roundMoney(row.hra),
          "Travel Allowance": roundMoney(row.travelAllowance),
          "Performance Bonus": roundMoney(row.performanceBonus),
          "Special Bonus": roundMoney(row.specialBonus),
          "Daily Bonus Amount": roundMoney(row.dailyBonus),
          "Employee PF Deduction": roundMoney(row.employeePf),
          "Employer PF Contribution": roundMoney(row.employerPf),
          "ESI Deduction": roundMoney(row.esi),
          "Employer ESI Contribution": roundMoney(row.employerEsi),
          "P-Tax": roundMoney(row.professionalTax),
          // Display sign: negative means recovered (engine stores positive).
          Advance: row.advance !== undefined && row.advance !== null ? -roundMoney(row.advance) : "",
          "Other Deduction": roundMoney(row.otherDeduction),
          "Net Payable": roundMoney(row.netPayable),
          "Employer Total Cost": roundMoney(row.totalCost),
        }));

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
    const headers = Object.keys(exportRows[0] ?? { "Employee Name": "" });
    const body = exportRows
      .map(
        (row) =>
          `<tr>${headers
            .map((header) => `<td>${htmlEscape(row[header as keyof typeof row] ?? "")}</td>`)
            .join("")}</tr>`,
      )
      .join("");
    const html = `<!doctype html><html><head><meta charset="utf-8" /></head><body><table><thead><tr>${headers
      .map((header) => `<th>${htmlEscape(header)}</th>`)
      .join("")}</tr></thead><tbody>${body}</tbody></table></body></html>`;
    downloadBlob(
      html,
      `${companyName || "Company"} ${sheetMode === "main" ? "Official Main Sheet" : "Reference Salary Sheet"} ${monthLabel}.xls`,
      "application/vnd.ms-excel;charset=utf-8;",
    );
  };

  const exportCsv = () => {
    if (!assertOfficialExportAllowed()) return;
    const headers = Object.keys(exportRows[0] ?? { "Employee Name": "" });
    const csv = [
      headers.map(csvEscape).join(","),
      ...exportRows.map((row) =>
        headers.map((header) => csvEscape(row[header as keyof typeof row] ?? "")).join(","),
      ),
    ].join("\n");
    downloadBlob(csv, `${companyName || "Company"} ${sheetMode === "main" ? "Official Main Sheet" : "Reference Salary Sheet"} ${monthLabel}.csv`, "text/csv;charset=utf-8;");
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

  const handleAttendanceUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const XLSX = await loadXLSX();
      const workbook = XLSX.read(buffer, { type: "array" });
      const worksheet = getBestWorksheet(workbook, monthLabel);
      const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
      const parsed = parseAttendanceExcel(rows, employees);
      setAttendanceData(parsed.employees);
      setAttendanceMonth(parsed.monthLabel);
      setIsAttendanceModalOpen(true);
      showToast("Attendance file loaded successfully.");
    } catch (err) {
      console.error(err);
      showToast("Error parsing the Excel file. Please check format.", "error");
    } finally {
      event.target.value = "";
    }
  };

  return (
    <>
      <main className="app-shell">
        <section className="topbar">
          <div>
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
            <p className="eyebrow">Salary Sheet Dashboard</p>
            <h1>{companyName || "Company"} Payroll</h1>
            <p className="hero-copy">
              Build the reference payroll, review the official main sheet, and export clean salary files
              for {monthLabel}.
            </p>
          </div>
          <div className="topbar-actions">
            <button
              className="quiet-button"
              type="button"
              onClick={() => setSheetMode((current) => (current === "reference" ? "main" : "reference"))}
            >
              <Calculator size={17} />
              {sheetMode === "reference" ? "Show Main Sheet" : "Show Reference Sheet"}
            </button>
            <button
              className="ghost-button"
              type="button"
              onClick={() => {
                if (attendanceData && attendanceData.length > 0) {
                  setIsAttendanceModalOpen(true);
                } else {
                  attendanceFileRef.current?.click();
                }
              }}
            >
              <FileSpreadsheet size={17} />
              Attendance Checker
            </button>
            <button className="ghost-button" type="button" onClick={exportCsv}>
              <FileDown size={17} />
              CSV
            </button>
            <button
              className="ghost-button"
              type="button"
              onClick={() => setIsDbModalOpen(true)}
              title={
                dbLoading
                  ? "Syncing with cloud database..."
                  : "Cloud database connected"
              }
            >
              {dbLoading ? (
                <RefreshCw size={17} className="spin-icon" style={{ color: "#2563eb" }} />
              ) : (
                <Cloud size={17} style={{ color: "#2563eb" }} />
              )}
              Database {dbLoading ? "Syncing..." : "Cloud"}
            </button>
            <button className="primary-button" type="button" onClick={exportWorkbook}>
              <FileSpreadsheet size={17} />
              Excel
            </button>
            <input
              ref={attendanceFileRef}
              className="hidden-input"
              type="file"
              accept=".xls,.xlsx"
              onChange={handleAttendanceUpload}
            />
          </div>
        </section>

        <section className="control-strip" aria-label="Salary sheet setup">
          <label>
            Company
            <input value={companyName} onChange={(event) => setCompanyName(event.target.value)} />
          </label>
          <label>
            Month
            <input
              value={monthLabel}
              onBlur={commitMonthLabel}
              onChange={(event) => updateMonthLabel(event.target.value)}
            />
          </label>
          <label>
            Calendar Days
            <input
              type="number"
              value={effectiveMonthDays}
              readOnly
              title="Derived from the month label (not editable)"
              aria-readonly="true"
            />
          </label>
          <label>
            Search employee
            <span className="search-box">
              <Search size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Name or category"
              />
            </span>
          </label>
          <button className="quiet-button" type="button" onClick={addEmployee}>
            <Plus size={17} />
            Add Employee
          </button>
        </section>

        <section className="summary-grid">
          <MetricCard
            icon={<IndianRupee />}
            label="Net Payable"
            value={currency(totals.net)}
            caption={`${totals.employees} active employees`}
            tone="green"
          />
          <MetricCard
            icon={<Calculator />}
            label="Gross Earnings"
            value={currency(totals.gross)}
            caption={`${currency(totals.deductions)} total deductions`}
            tone="blue"
          />
          <MetricCard
            icon={<FileSpreadsheet />}
            label="PF + ESI + P-Tax"
            value={currency(totals.pf + totals.esi + totals.professionalTax)}
            caption={`${currency(totals.employerPf)} PF + ${currency(totals.employerEsi)} ESI (Employer)`}
            tone="amber"
          />
          <MetricCard
            icon={<Users />}
            label="Employer Cost"
            value={currency(totals.cost)}
            caption={`${sheetMode === "main" ? filteredOfficialRows.length : filteredRows.length} rows in view`}
            tone="rose"
          />
        </section>

        <section className="workspace-grid">
          <article className="panel table-panel">
            <div className="panel-heading">
              <div>
                <h2>{sheetMode === "reference" ? "Reference Salary Sheet" : "Official Main Sheet"}</h2>
                <p>
                  {sheetMode === "reference"
                    ? `${filteredRows.length} employees shown, ${salaryRows.length} total`
                    : totals.unpackableCount > 0
                      ? `${filteredOfficialRows.length} rows · ${totals.unpackableCount} unpackable (export blocked)`
                      : `${filteredOfficialRows.length} calculated rows, net computed from Official components`}
                </p>
              </div>
              <div className="panel-actions">
                <button className="icon-button" title="Print salary sheet" type="button" onClick={() => window.print()}>
                  <Printer size={17} />
                </button>
              </div>
            </div>

            <div className={`table-wrap ${sheetMode === "main" ? "table-wrap--official" : ""}`}>
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
                      <th onClick={() => handleRefSort("daysWorked")} className="sortable-th">
                        Days {refSortField === "daysWorked" && (refSortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleRefSort("extraDays")} className="sortable-th">
                        Extra {refSortField === "extraDays" && (refSortDirection === "asc" ? " ↑" : " ↓")}
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
                      <th>Settings</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedFilteredRows.map((row) => {
                      const isSpecial = isSpecialCategory(row.category);
                      const isSecurity = row.isSecurity === true;
                      const missingRate = row.missingRate === true;
                      // Special is paid a flat package and has no day rate, so it is
                      // always typed per month regardless of the toggle.
                      const perDayInput =
                        !isSpecial && (rateMode ?? (row.category === "Unskilled" ? "perDay" : "perMonth")) === "perDay";
                      return (
                        <Fragment key={row.id}>
                          <tr className={missingRate ? "row-missing-rate" : undefined}>
                            <td className="name-cell">
                              <input
                                value={row.name}
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
                                onChange={(event) => updateEmployee(row.id, "category", event.target.value)}
                              >
                                {CATEGORIES.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <NumberInput
                                value={row.daysWorked}
                                min={0}
                                max={effectiveMonthDays}
                                disabled={isSpecial}
                                onChange={(value) => updateEmployee(row.id, "daysWorked", value)}
                              />
                            </td>
                            <td>
                              <NumberInput
                                className="number-input number-input--compact"
                                value={row.extraDays}
                                min={0}
                                disabled={isSpecial}
                                onChange={(value) => updateEmployee(row.id, "extraDays", value)}
                              />
                            </td>
                            <td>{currency(row.earnedSalary)}</td>
                            <td>{currency(row.basicSalary)}</td>
                            <td>{currency(row.hra)}</td>
                            <td>{currency(row.travelAllowance)}</td>
                            <td>{currency(row.performanceBonus)}</td>
                            <td>
                              <NumberInput
                                className="number-input number-input--compact"
                                value={row.specialBonus ?? undefined}
                                allowBlank={true}
                                min={0}
                                onChange={(value) => updateEmployee(row.id, "specialBonus", value)}
                              />
                            </td>
                            <td>{currency(row.employeePf)}</td>
                            <td>{currency(row.esi)}</td>
                            <td>{currency(row.professionalTax)}</td>
                            <td>
                              <NumberInput
                                value={row.advance ?? undefined}
                                allowBlank={true}
                                onChange={(value) => updateEmployee(row.id, "advance", value)}
                              />
                            </td>
                            <td className="net-cell">{currency(row.netPayable)}</td>
                            <td>
                              <button
                                className="icon-button"
                                title="Employee settings"
                                type="button"
                                onClick={() => {
                                  setRateMode(null);
                                  setOpenSettingsId((current) => (current === row.id ? null : row.id));
                                }}
                              >
                                <Settings2 size={16} />
                              </button>
                            </td>
                            <td>
                              <button
                                className="delete-button"
                                title="Remove employee"
                                type="button"
                                onClick={() => removeEmployee(row.id)}
                              >
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </tr>
                          {openSettingsId === row.id ? (
                            <tr className="settings-row">
                              <td colSpan={17}>
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
                                    <small>{row.totalSalary > ESI_GROSS_LIMIT ? `ESI is off automatically above ${currency(ESI_GROSS_LIMIT)} Total Salary` : "Toggle controls employee ESI choice"}</small>
                                    <button
                                      type="button"
                                      className={row.esiOptIn ? "toggle-on" : "toggle-off"}
                                      disabled={isSpecial}
                                      onClick={() => updateEmployee(row.id, "esiOptIn", !row.esiOptIn)}
                                    >
                                      {row.esiOptIn ? "Turn Off" : "Turn On"}
                                    </button>
                                  </div>
                                  <div className="settings-column">
                                    <span>Category</span>
                                    <strong>{row.category}</strong>
                                    <small>
                                      {isSpecial
                                        ? "Special: full pay, no day rate, no PF/ESI"
                                        : "Change grade via the Category column"}
                                    </small>
                                  </div>
                                  <div className="settings-column">
                                    <span>Security</span>
                                    <strong>{isSecurity ? "On" : "Off"}</strong>
                                    <small>
                                      {isSecurity
                                        ? "No automatic Sunday package — Extra Days can still be set by hand"
                                        : "Toggle if this employee is security staff"}
                                    </small>
                                    <button
                                      type="button"
                                      className={isSecurity ? "toggle-on" : "toggle-off"}
                                      onClick={() => updateEmployee(row.id, "isSecurity", !isSecurity)}
                                    >
                                      {isSecurity ? "Turn Off" : "Turn On"}
                                    </button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                    {!filteredRows.length ? (
                      <tr className="empty-row">
                        <td colSpan={17}>
                          <div>
                            {query ? <Search size={18} /> : <Users size={18} />}
                            <strong>
                              {query ? "No employees match this search." : "No employees in this month yet."}
                            </strong>
                            <span>
                              {query
                                ? "Clear the search or add a new employee to continue."
                                : "Use “Add Employee” above to start building this sheet."}
                            </span>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
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
                          <td>{currency(row.monthlyBasic)}</td>
                          <td>{currency(row.monthlyHra)}</td>
                          <td>{currency(row.monthlyTravelAllowance)}</td>
                          <td>{currency(row.bonus)}</td>
                          <td>{currency(row.pf)}</td>
                          <td>{currency(row.esi)}</td>
                          <td>{currency(row.professionalTax)}</td>
                          <td className="net-cell">{currency(row.netPayable)}</td>
                          <td>{currency(row.referenceNetPayable)}</td>
                        </tr>
                      );
                    })}
                    {!filteredOfficialRows.length ? (
                      <tr className="empty-row">
                        <td colSpan={12}>
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
                </table>
              )}
            </div>
            <div className="table-note">
              {sheetMode === "reference"
                ? "Category is set by hand, never guessed from salary. Earned is Salary/Month prorated by present days. Basic is Earned x Basic %. HRA and TA split prorated Total Salary minus Basic in a 70% / 30% ratio."
                : `For PF-on rows, main-sheet attendance starts at 26 - (${effectiveMonthDays} calendar days - present days), then reduces when needed so Basic always equals attendance x category daily wage. HRA/travel allowance are attendance-prorated, and any excess target gross is shown as Bonus so net pay matches the reference sheet. PF-off rows stay aligned with the reference sheet.`}
            </div>
          </article>

          <aside className="side-stack">
            <article className="panel">
              <div className="panel-heading compact">
                <div>
                  <h2>Rules</h2>
                  <p>Applied automatically</p>
                </div>
              </div>
              <div className="rule-list">
                <Rule label="Category" value="Chosen per employee — Unskilled, Semi-skilled, Skilled or Special. Never inferred from salary." />
                <Rule label="Salary Anchor" value="Unskilled is anchored on salary/day; the rest on salary/month. Either can be typed — Settings has a Per Day / Per Month switch." />
                <Rule label="Calendar Days" value={`${effectiveMonthDays} days for ${monthLabel || "selected month"}`} />
                <Rule label="Earned Salary" value="Salary/Month / calendar days x present days" />
                <Rule label="Reference Basic" value="Earned Salary x Basic %" />
                <Rule label="Main PF Attendance" value={`Starts at 26 - (${effectiveMonthDays} - present days), then reduces if Basic plus Bonus is too high`} />
                <Rule label="Official Basic" value="Attendance x category daily wage" />
                <Rule label="Zone A Day Rate" value="Unskilled 400, Semi-skilled 440, Skilled 484" />
                <Rule label="Sunday Attendance" value="Paid automatically for all Sundays if present >= 21 days (31-day month) or >= 20 days (30-day month). Denied if absent on Saturday and Monday surrounding a Sunday." />
                <Rule label="Sunday Double Pay" value="Sundays actually worked count again as a bonus day (double pay) if threshold is met" />
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
                <Rule label="ESI" value={`${ESI_RATE * 100}% on Earned Salary when ESI is enabled (auto-off when Total Salary exceeds ${currency(ESI_GROSS_LIMIT)})`} />
                <Rule label="P-Tax" value="Based on Gross Payable (before PF/ESI) slab" />
                <Rule label="Advance" value="Amount advanced to the employee, recovered from this month's net pay" />
                <Rule label="Performance Bonus" value="(salary/day + bonus/day) x Extra Days" />
              </div>
            </article>

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

            <article className="panel status-panel">
              <div className="status-row">
                <CheckCircle2 size={22} />
                <div>
                  <h2>Ready to Pay</h2>
                  <strong>{currency(totals.net)}</strong>
                </div>
              </div>
              <div className="status-list">
                <Rule label="Employees" value={`${totals.employees} active`} />
                <Rule label="Employer PF" value={currency(totals.employerPf)} />
                <Rule label="Deductions" value={currency(totals.deductions)} />
              </div>
            </article>
          </aside>
        </section>
      </main>

      {isAttendanceModalOpen && attendanceData && (
        <AttendanceCheckerModal
          data={attendanceData}
          month={attendanceMonth}
          onClose={() => setIsAttendanceModalOpen(false)}
          employees={employees}
          onUploadNewFile={(newData, newMonth) => {
            setAttendanceData(newData);
            setAttendanceMonth(newMonth);
          }}
          onSyncAttendance={(auditedEmps) => {
            setEmployees((current) => {
              let matchedCount = 0;
              let importCount = 0;

              // 1. Map existing employees and update their attendance.
              // Keep persisted isSecurity; attendance already used it for Sunday stats.
              const updatedExisting = current.map((emp) => {
                const matched = auditedEmps.find((d) => namesMatch(emp.name, d.name));
                if (matched) {
                  matchedCount++;
                  const isSecurity = emp.isSecurity === true || matched.isSecurity;
                  return {
                    ...emp,
                    isSecurity,
                    daysWorked: matched.presentDays,
                    // Security / Special: engine also zeros this; keep stored value consistent.
                    extraDays: isSecurity || isSpecialCategory(emp.category) ? 0 : matched.sundaysEligible,
                  };
                }
                // Sync employees without matching attendance in the sheet to 0 days worked & 0 extra days
                return {
                  ...emp,
                  daysWorked: 0,
                  extraDays: 0,
                };
              });

              // 2. Identify and import new employees that aren't in the current roster.
              // Do not overload category with security status (TICKET-02).
              const newEmployees: EmployeeInput[] = [];
              auditedEmps.forEach((d) => {
                const exists = current.some((emp) => namesMatch(emp.name, d.name));
                if (!exists) {
                  importCount++;
                  newEmployees.push({
                    id: uid(),
                    name: d.name,
                    category: "Unskilled",
                    isSecurity: d.isSecurity,
                    monthlySalary: 0,
                    salaryPerDay: 0,
                    bonusPerDay: 0,
                    daysWorked: d.presentDays,
                    extraDays: d.isSecurity ? 0 : d.sundaysEligible,
                    basicPercent: 70,
                    pfOptIn: true,
                    esiOptIn: true,
                    advance: undefined,
                    otherDeduction: 0,
                    specialBonus: undefined,
                  });
                }
              });

              const next = [...updatedExisting, ...newEmployees];

              let toastMsg = `Synced attendance: ${matchedCount} employees matched.`;
              if (importCount > 0) {
                toastMsg += ` Imported ${importCount} new employees from attendance sheet.`;
              }
              const zeroedCount = current.length - matchedCount;
              if (zeroedCount > 0) {
                toastMsg += ` ${zeroedCount} set to 0 due to no attendance.`;
              }
              showToast(toastMsg, "success");
              return next;
            });
            setIsAttendanceModalOpen(false);
          }}
          showToast={showToast}
        />
      )}

      {showNoDataModal && (
        <div className="attendance-overlay">
          <div className="attendance-modal" style={{ maxWidth: "500px", height: "auto", padding: "28px" }}>
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
        <div className="attendance-overlay" onClick={() => setIsDbModalOpen(false)}>
          <div
            className="attendance-modal"
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

interface AttendanceCheckerModalProps {
  data: AttendanceEmployee[];
  month: string;
  onClose: () => void;
  employees: EmployeeInput[];
  onUploadNewFile: (data: AttendanceEmployee[], month: string) => void;
  onSyncAttendance: (auditedEmployees: AttendanceEmployee[]) => void;
  showToast: (message: string, type?: "success" | "error") => void;
}

function AttendanceCheckerModal({
  data,
  month,
  onClose,
  employees,
  onUploadNewFile,
  onSyncAttendance,
  showToast,
}: AttendanceCheckerModalProps) {
  const modalFileRef = useRef<HTMLInputElement>(null);

  const handleModalUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const XLSX = await loadXLSX();
      const workbook = XLSX.read(buffer, { type: "array" });
      const worksheet = getBestWorksheet(workbook, month);
      const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
      const parsed = parseAttendanceExcel(rows, employees);
      onUploadNewFile(parsed.employees, parsed.monthLabel);
      showToast("Successfully uploaded and parsed new attendance file.");
    } catch (err) {
      console.error(err);
      showToast("Error parsing the Excel file. Please check format.", "error");
    } finally {
      event.target.value = "";
    }
  };

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(data[0]?.id || null);

  // Uploading a different attendance file replaces `data`; if the previously
  // selected employee no longer exists, fall back to the first row instead of
  // showing the empty "select an employee" prompt with a stale selection.
  useEffect(() => {
    if (selectedId && data.some((emp) => emp.id === selectedId)) {
      return;
    }
    setSelectedId(data[0]?.id || null);
  }, [data, selectedId]);
  const [activeChartTab, setActiveChartTab] = useState<"days" | "hours">("days");
  const [sortField, setSortField] = useState<"name" | "presentDays" | "avgHours" | "sundaysWorked" | "sundaysEligible" | "warnings">("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [modalTab, setModalTab] = useState<"audit" | "analytics">("audit");
  const [chartSort, setChartSort] = useState<"name" | "value-desc" | "value-asc">("value-desc");

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection(field === "name" ? "asc" : "desc");
    }
  };

  const handleToggleOverride = (
    employeeId: string,
    dateString: string,
    type: "override" | "leaveType",
    value: any
  ) => {
    const updatedData = data.map((emp) => {
      if (emp.id !== employeeId) return emp;

      const updatedDaysDetail = emp.daysDetail.map((day) => {
        if (day.dateString !== dateString) return day;

        const newDay = { ...day };
        if (type === "override") {
          newDay.manualOverride = value; // "present" or undefined
          if (value === "present") {
            newDay.isPresent = true;
          } else {
            newDay.isPresent = newDay.punchTimes.length > 0 && !newDay.isShortStay;
          }
        } else if (type === "leaveType") {
          newDay.leaveType = value; // "approved" or "unapproved"
        }
        return newDay;
      });

      const stats = calculateEmployeeAttendanceStats(updatedDaysDetail, emp.isSecurity);

      return {
        ...emp,
        daysDetail: updatedDaysDetail,
        ...stats,
      };
    });

    onUploadNewFile(updatedData, month);
  };

  const sortedAndFilteredData = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let result = [...data];
    if (q) {
      result = result.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.department.toLowerCase().includes(q)
      );
    }

    result.sort((a, b) => {
      let valA: any;
      let valB: any;

      if (sortField === "warnings") {
        valA = a.isSecurity ? 99 : a.sundayDetails.filter((d) => !d.isEligible).length;
        valB = b.isSecurity ? 99 : b.sundayDetails.filter((d) => !d.isEligible).length;
      } else {
        valA = a[sortField];
        valB = b[sortField];
      }

      if (typeof valA === "string") {
        return sortDirection === "asc"
          ? valA.localeCompare(valB)
          : valB.localeCompare(valA);
      } else {
        return sortDirection === "asc" ? valA - valB : valB - valA;
      }
    });

    return result;
  }, [searchQuery, data, sortField, sortDirection]);

  const selectedEmployee = data.find((e) => e.id === selectedId);

  const totalWorkedSundays = data.reduce((sum, e) => sum + e.sundaysWorked, 0);
  const totalEligibleSundays = data.reduce((sum, e) => sum + e.sundaysEligible, 0);
  const totalWarnings = data.reduce((sum, e) => {
    const flaggedCount = e.sundayDetails.filter((d) => !d.isEligible).length;
    return sum + flaggedCount;
  }, 0);

  const avgAttendance =
    data.length > 0
      ? data.reduce((sum, e) => sum + e.presentDays, 0) / data.length
      : 0;
  const avgStayHours =
    data.length > 0
      ? data.reduce((sum, e) => sum + e.avgHours, 0) / data.length
      : 0;

  const maxPresentDays = Math.max(...data.map((e) => e.presentDays), 1);
  const maxStayHours = Math.max(...data.map((e) => e.avgHours), 1);

  const sortedChartData = useMemo(() => {
    const result = [...data];
    if (chartSort === "name") {
      result.sort((a, b) => a.name.localeCompare(b.name));
    } else if (chartSort === "value-desc") {
      result.sort((a, b) => {
        const valA = activeChartTab === "days" ? a.presentDays : a.avgHours;
        const valB = activeChartTab === "days" ? b.presentDays : b.avgHours;
        return valB - valA;
      });
    } else if (chartSort === "value-asc") {
      result.sort((a, b) => {
        const valA = activeChartTab === "days" ? a.presentDays : a.avgHours;
        const valB = activeChartTab === "days" ? b.presentDays : b.avgHours;
        return valA - valB;
      });
    }
    return result;
  }, [data, chartSort, activeChartTab]);

  return (
    <div className="attendance-overlay" onClick={onClose}>
      <div className="attendance-modal" onClick={(event) => event.stopPropagation()}>
        <header className="attendance-header">
          <div>
            <span className="modal-eyebrow">Data Auditor</span>
            <h1>Attendance Checker & Sunday Bonus Auditor</h1>
            <p className="modal-copy">
              Audit raw punch card logs, verify stay times, and inspect Sunday bonus eligibility for {month || "May 2026"}.
            </p>
          </div>
          <div className="attendance-header-actions" style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button
              className="primary-button"
              type="button"
              onClick={() => onSyncAttendance(data)}
              style={{ minHeight: "36px", height: "36px", padding: "0 12px", fontSize: "13px", background: "#059669", color: "#ffffff", borderColor: "#059669" }}
            >
              <Check size={14} /> Sync to Payroll
            </button>
            <button
              className="ghost-button"
              type="button"
              onClick={() => modalFileRef.current?.click()}
              style={{ minHeight: "36px", height: "36px", padding: "0 12px", fontSize: "13px" }}
            >
              <Upload size={15} /> Upload New File
            </button>
            <input
              ref={modalFileRef}
              className="hidden-input"
              type="file"
              accept=".xls,.xlsx"
              onChange={handleModalUpload}
            />
            <button
              className="icon-button close-modal"
              type="button"
              onClick={onClose}
              style={{ minHeight: "36px", height: "36px", width: "36px" }}
            >
              <X size={20} />
            </button>
          </div>
        </header>

        {/* Tab Selector Bar */}
        <div className="attendance-tabs">
          <button
            className={`attendance-tab-link ${modalTab === "audit" ? "active" : ""}`}
            onClick={() => setModalTab("audit")}
          >
            <Users size={15} /> Employee Auditor
          </button>
          <button
            className={`attendance-tab-link ${modalTab === "analytics" ? "active" : ""}`}
            onClick={() => setModalTab("analytics")}
          >
            <BarChart3 size={15} /> Analytics & Standings
          </button>
        </div>

        {modalTab === "audit" ? (
          /* Tab 1: Split Screen Auditor View */
          <div className="attendance-split-workspace">
            {/* Left Column: Employee List Table */}
            <div className="attendance-left-pane">
              <div className="attendance-panel-heading" style={{ padding: "16px 20px" }}>
                <div>
                  <h2 style={{ fontSize: "14px", fontWeight: 800 }}>Employee Records</h2>
                  <p style={{ fontSize: "11px", color: "#64748b" }}>{sortedAndFilteredData.length} total</p>
                </div>
                <div className="search-box attendance-search-box" style={{ width: "200px", minHeight: "34px", height: "34px" }}>
                  <Search size={14} />
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search name..."
                    style={{ fontSize: "12px", minHeight: "30px", height: "30px" }}
                  />
                </div>
              </div>

              <div className="attendance-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th onClick={() => handleSort("name")} className="sortable-th">
                        Name {sortField === "name" && (sortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleSort("presentDays")} className="sortable-th text-right">
                        Days {sortField === "presentDays" && (sortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleSort("avgHours")} className="sortable-th text-right">
                        Stay {sortField === "avgHours" && (sortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                      <th onClick={() => handleSort("warnings")} className="sortable-th text-center">
                        Status {sortField === "warnings" && (sortDirection === "asc" ? " ↑" : " ↓")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedAndFilteredData.map((emp) => {
                      const totalFlags = emp.sundayDetails.filter((d) => !d.isEligible).length;
                      const isSelected = emp.id === selectedId;
                      return (
                        <tr
                          key={emp.id}
                          onClick={() => setSelectedId(emp.id)}
                          className={`clickable-row ${isSelected ? "selected-row" : ""}`}
                        >
                          <td className="name-cell font-bold" style={{ fontSize: "11.5px" }}>{emp.name}</td>
                          <td className="text-right">{emp.presentDays} Days</td>
                          <td className="text-right">{emp.avgHours.toFixed(1)} Hrs</td>
                          <td>
                            {emp.isSecurity ? (
                              <span className="badge badge-rose" style={{ fontSize: "9px" }}>Security</span>
                            ) : totalFlags > 0 ? (
                              <span className="badge badge-amber" style={{ fontSize: "9px" }}>{totalFlags} Warning</span>
                            ) : emp.sundaysWorked > 0 ? (
                              <span className="badge badge-green" style={{ fontSize: "9px" }}>Eligible</span>
                            ) : (
                              <span className="badge badge-neutral" style={{ fontSize: "9px" }}>None</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {sortedAndFilteredData.length === 0 && (
                      <tr className="empty-row">
                        <td colSpan={4}>No matching audited employees.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Right Column: Selected Employee Audit Detail */}
            <div className="attendance-right-pane">
              {selectedEmployee ? (
                <div className="employee-audit-card">
                  <header className="employee-audit-header">
                    <div>
                      <h3 style={{ fontSize: "22px", fontWeight: 900 }}>{selectedEmployee.name}</h3>
                      <p style={{ fontSize: "13px", color: "#64748b", marginTop: "4px" }}>
                        Department: <strong>{selectedEmployee.department}</strong> | Present days this month:{" "}
                        <strong>{selectedEmployee.presentDays} Days</strong> | Average stay duration: <strong>{selectedEmployee.avgHours.toFixed(1)} Hrs/Day</strong>
                      </p>
                    </div>
                    <div className="employee-badges" style={{ gap: "8px" }}>
                      {selectedEmployee.isSecurity && (
                        <span className="badge badge-rose">Security guard (Exempt)</span>
                      )}
                      {!selectedEmployee.meetsMonthThreshold && (
                        <span className="badge badge-amber">Below Monthly Threshold</span>
                      )}
                      {selectedEmployee.daysDetail.some((d) => d.isShortStay) && (
                        <span className="badge badge-rose">
                          {selectedEmployee.daysDetail.filter((d) => d.isShortStay).length} Short Stays
                        </span>
                      )}
                    </div>
                  </header>

                  {/* Summary of Employee Sunday Status & Shifts */}
                  <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                    <div className="metric-card" style={{ flex: "1 1 120px", minHeight: "80px", padding: "12px 16px" }}>
                      <div>
                        <p style={{ fontSize: "11px", fontWeight: 800, color: "#64748b", textTransform: "uppercase" }}>Sundays Worked</p>
                        <strong style={{ fontSize: "20px", marginTop: "4px" }}>{selectedEmployee.sundaysWorked} Days</strong>
                      </div>
                    </div>
                    <div className="metric-card" style={{ flex: "1 1 120px", minHeight: "80px", padding: "12px 16px" }}>
                      <div>
                        <p style={{ fontSize: "11px", fontWeight: 800, color: "#64748b", textTransform: "uppercase" }}>Sunday Bonus Days</p>
                        <strong style={{ fontSize: "20px", marginTop: "4px" }}>{selectedEmployee.sundaysEligible} Days</strong>
                      </div>
                    </div>
                    <div className="metric-card" style={{ flex: "1 1 120px", minHeight: "80px", padding: "12px 16px" }}>
                      <div>
                        <p style={{ fontSize: "11px", fontWeight: 800, color: "#64748b", textTransform: "uppercase" }}>Day Shifts</p>
                        <strong style={{ fontSize: "20px", marginTop: "4px", color: "#2563eb" }}>
                          {selectedEmployee.daysDetail.filter((d) => d.isPresent && d.shift === "Day").length} Days
                        </strong>
                      </div>
                    </div>
                    <div className="metric-card" style={{ flex: "1 1 120px", minHeight: "80px", padding: "12px 16px" }}>
                      <div>
                        <p style={{ fontSize: "11px", fontWeight: 800, color: "#64748b", textTransform: "uppercase" }}>Night Shifts</p>
                        <strong style={{ fontSize: "20px", marginTop: "4px", color: "#7c3aed" }}>
                          {selectedEmployee.daysDetail.filter((d) => d.isPresent && d.shift === "Night").length} Days
                        </strong>
                      </div>
                    </div>
                  </div>

                  {selectedEmployee.sundayDetails && selectedEmployee.sundayDetails.length > 0 ? (
                    <div className="sunday-audit-section">
                      <h4 style={{ fontSize: "12px", fontWeight: 900 }}>Sunday Audit Logs</h4>
                      <div className="sunday-cards-grid" style={{ marginTop: "12px" }}>
                        {selectedEmployee.sundayDetails.map((sun, idx) => {
                          const dayDetail = selectedEmployee.daysDetail.find(
                            (d) => d.dateString === sun.date
                          );
                          const actuallyWorked = dayDetail?.isPresent;

                          let badgeText = "Not Paid";
                          let badgeBg = "#ffe4e6";
                          let badgeColor = "#b91c1c";
                          let borderStyle = "4px solid #f87171";
                          let cardBg = "#fffafb";

                          if (sun.isEligible) {
                            if (actuallyWorked) {
                              badgeText = "Double Pay (Present + Bonus)";
                              badgeBg = "#dcfce7";
                              badgeColor = "#15803d";
                              borderStyle = "4px solid #10b981";
                              cardBg = "#f6fdf9";
                            } else {
                              badgeText = "Paid (Auto-Presence)";
                              badgeBg = "#dbeafe";
                              badgeColor = "#1e40af";
                              borderStyle = "4px solid #3b82f6";
                              cardBg = "#f5f9ff";
                            }
                          } else {
                            if (actuallyWorked) {
                              badgeText = "Single Pay (No Bonus)";
                              badgeBg = "#fef3c7";
                              badgeColor = "#b45309";
                              borderStyle = "4px solid #f59e0b";
                              cardBg = "#fffdf5";
                            }
                          }

                          return (
                            <div
                              key={idx}
                              className="sunday-card"
                              style={{
                                padding: "12px",
                                borderLeft: borderStyle,
                                background: cardBg,
                              }}
                            >
                              <div className="sunday-card-header">
                                <span className="sunday-date" style={{ fontSize: "12px" }}>
                                  <Calendar size={13} style={{ marginRight: "4px" }} /> {sun.date}
                                </span>
                                <span
                                  className="badge"
                                  style={{
                                    fontSize: "9px",
                                    fontWeight: 800,
                                    textTransform: "uppercase",
                                    padding: "4px 8px",
                                    borderRadius: "9999px",
                                    background: badgeBg,
                                    color: badgeColor,
                                  }}
                                >
                                  {badgeText}
                                </span>
                              </div>
                              <ul className="reasons-list" style={{ marginTop: "8px" }}>
                                {sun.reasons.map((r, i) => (
                                  <li key={i} style={{ fontSize: "11px", color: badgeColor }}>
                                    <AlertTriangle size={12} style={{ marginRight: "4px" }} /> {r}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="info-callout" style={{ padding: "12px 16px" }}>
                      <Info size={16} />
                      <p style={{ fontSize: "13px" }}>No Sunday details available for this month.</p>
                    </div>
                  )}

                  <div className="daily-log-section">
                    <h4 style={{ fontSize: "12px", fontWeight: 900 }}>Daily Punch Logs & Durations</h4>
                    <div className="daily-timeline" style={{ marginTop: "16px" }}>
                      {selectedEmployee.daysDetail.map((day, idx) => {
                        const isSunday = day.dayOfWeek === 0;
                        const isSaturday = day.dayOfWeek === 6;
                        const dayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day.dayOfWeek];
                        const dateNum = day.dateString.split("/")[2] || "";

                        return (
                          <div
                            key={idx}
                            className={`timeline-row ${day.isPresent ? "present" : day.isShortStay ? "short-stay" : "absent"} ${
                              isSunday ? "sunday-row" : ""
                            } ${isSaturday ? "saturday-row" : ""}`}
                          >
                            <div className="timeline-date-col">
                              <span className="timeline-day-num">{dateNum}</span>
                              <span className="timeline-day-name" style={{ fontSize: "9px" }}>{dayName}</span>
                            </div>
                            <div className="timeline-status-indicator">
                              <span className="dot"></span>
                            </div>
                            <div className="timeline-info-col">
                              {day.isPresent ? (
                                <div className="punch-details" style={{ gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
                                  <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
                                    {day.punchTimes.length > 0 ? (
                                      <div className="punch-times-badge" style={{ padding: "3px 8px", fontSize: "11.5px" }}>
                                        <Clock size={12} />
                                        <span>Punches: {day.punchTimes.join("  |  ")}</span>
                                      </div>
                                    ) : (
                                      <div className="punch-times-badge" style={{ padding: "3px 8px", fontSize: "11.5px", background: "#f0fdf4", borderColor: "#bbf7d0", color: "#166534" }}>
                                        <Clock size={12} style={{ color: "#16a34a" }} />
                                        <span>No Punch Logs (Forgot Punch)</span>
                                      </div>
                                    )}
                                    {day.punchTimes.length > 0 && (
                                      <span className="punch-duration" style={{ fontSize: "11.5px" }}>
                                        {day.duration.toFixed(1)} Hours Stayed
                                      </span>
                                    )}
                                    {day.shift && day.punchTimes.length > 0 && (
                                      <span className="badge" style={{ fontSize: "10px", padding: "3px 8px", background: day.shift === "Night" ? "#f3e8ff" : "#eff6ff", color: day.shift === "Night" ? "#6b21a8" : "#1e40af", border: day.shift === "Night" ? "1px solid #d8b4fe" : "1px solid #bfdbfe", textTransform: "none" }}>
                                        {day.shift === "Night" ? "Night Shift" : "Day Shift"}
                                      </span>
                                    )}
                                    {day.manualOverride === "present" && (
                                      <span className="badge badge-green" style={{ fontSize: "10px", textTransform: "none", padding: "3px 8px", display: "inline-flex", alignItems: "center" }}>
                                        Approved (Manual Override)
                                      </span>
                                    )}
                                    {day.manualOverride === "present" && (
                                      <button
                                        type="button"
                                        onClick={() => handleToggleOverride(selectedEmployee.id, day.dateString, "override", undefined)}
                                        style={{ background: "none", border: "none", color: "#b91c1c", fontSize: "11px", fontWeight: 700, cursor: "pointer", textDecoration: "underline", padding: 0 }}
                                      >
                                        Revert
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ) : day.isShortStay ? (
                                <div className="punch-details" style={{ gap: "12px", flexDirection: "column", alignItems: "flex-start" }}>
                                  <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
                                    <div className="punch-times-badge" style={{ padding: "3px 8px", fontSize: "11.5px", background: "#fff5f5", borderColor: "#feb2b2", color: "#9b1c1c" }}>
                                      <Clock size={12} style={{ color: "#c53030" }} />
                                      <span>Punches: {day.punchTimes.join("  |  ")}</span>
                                    </div>
                                    <span className="badge badge-rose" style={{ fontSize: "10.5px", textTransform: "none", padding: "3px 10px", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                                      <AlertTriangle size={11} />
                                      Short Stay ({day.duration.toFixed(1)} Hrs &lt; 5 Hrs) - Marked Absent
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleToggleOverride(selectedEmployee.id, day.dateString, "override", "present")}
                                      style={{ background: "#dcfce7", border: "1px solid #bbf7d0", color: "#15803d", fontSize: "11px", fontWeight: 700, cursor: "pointer", padding: "4px 8px", borderRadius: "4px" }}
                                    >
                                      Approve as Present
                                    </button>
                                  </div>
                                  
                                  {/* Leave Status controls for Short Stay */}
                                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                    <span style={{ fontSize: "10.5px", color: "#64748b", fontWeight: 700 }}>Leave Status:</span>
                                    <div style={{ display: "flex", background: "#f1f5f9", padding: "2px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                                      <button
                                        type="button"
                                        onClick={() => handleToggleOverride(selectedEmployee.id, day.dateString, "leaveType", "approved")}
                                        style={{ fontSize: "10px", padding: "2px 8px", border: 0, borderRadius: "4px", fontWeight: 700, cursor: "pointer", background: day.leaveType !== "unapproved" ? "#ffffff" : "transparent", color: day.leaveType !== "unapproved" ? "#16a34a" : "#64748b", boxShadow: day.leaveType !== "unapproved" ? "0 1px 2px rgba(0,0,0,0.05)" : "none" }}
                                      >
                                        Approved (Informed)
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleToggleOverride(selectedEmployee.id, day.dateString, "leaveType", "unapproved")}
                                        style={{ fontSize: "10px", padding: "2px 8px", border: 0, borderRadius: "4px", fontWeight: 700, cursor: "pointer", background: day.leaveType === "unapproved" ? "#ffffff" : "transparent", color: day.leaveType === "unapproved" ? "#dc2626" : "#64748b", boxShadow: day.leaveType === "unapproved" ? "0 1px 2px rgba(0,0,0,0.05)" : "none" }}
                                      >
                                        Unapproved (Uninformed)
                                      </button>
                                    </div>
                                    {day.leaveType === "unapproved" && (
                                      <span className="badge badge-rose" style={{ fontSize: "10px", textTransform: "none", padding: "2px 6px", display: "inline-flex", alignItems: "center", gap: "2px" }}>
                                        <AlertTriangle size={9} />
                                        -1 Penalty Day (Marked 2 Days Absent)
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <div className="punch-details" style={{ gap: "12px", alignItems: "center", flexWrap: "wrap", justifyContent: "space-between", width: "100%" }}>
                                  <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                                    <span className="absent-label" style={{ fontSize: "11px" }}>Absent / Off-day</span>
                                    <button
                                      type="button"
                                      onClick={() => handleToggleOverride(selectedEmployee.id, day.dateString, "override", "present")}
                                      style={{ background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e40af", fontSize: "11px", fontWeight: 700, cursor: "pointer", padding: "4px 8px", borderRadius: "4px", display: "inline-flex", alignItems: "center", gap: "4px", transition: "all 0.15s ease" }}
                                    >
                                      <Check size={12} /> Mark Present (Forgot Punch)
                                    </button>
                                  </div>
                                  
                                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                    <span style={{ fontSize: "10.5px", color: "#64748b", fontWeight: 700 }}>Leave Status:</span>
                                    <div style={{ display: "flex", background: "#f1f5f9", padding: "2px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                                      <button
                                        type="button"
                                        onClick={() => handleToggleOverride(selectedEmployee.id, day.dateString, "leaveType", "approved")}
                                        style={{ fontSize: "10px", padding: "2px 8px", border: 0, borderRadius: "4px", fontWeight: 700, cursor: "pointer", background: day.leaveType !== "unapproved" ? "#ffffff" : "transparent", color: day.leaveType !== "unapproved" ? "#16a34a" : "#64748b", boxShadow: day.leaveType !== "unapproved" ? "0 1px 2px rgba(0,0,0,0.05)" : "none" }}
                                      >
                                        Approved (Informed)
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleToggleOverride(selectedEmployee.id, day.dateString, "leaveType", "unapproved")}
                                        style={{ fontSize: "10px", padding: "2px 8px", border: 0, borderRadius: "4px", fontWeight: 700, cursor: "pointer", background: day.leaveType === "unapproved" ? "#ffffff" : "transparent", color: day.leaveType === "unapproved" ? "#dc2626" : "#64748b", boxShadow: day.leaveType === "unapproved" ? "0 1px 2px rgba(0,0,0,0.05)" : "none" }}
                                      >
                                        Unapproved (Uninformed)
                                      </button>
                                    </div>
                                    {day.leaveType === "unapproved" && (
                                      <span className="badge badge-rose" style={{ fontSize: "10px", textTransform: "none", padding: "2px 6px", display: "inline-flex", alignItems: "center", gap: "2px" }}>
                                        <AlertTriangle size={9} />
                                        -1 Penalty Day (Marked 2 Days Absent)
                                      </span>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="select-prompt">
                  <Users size={32} />
                  <p>Select an employee from the list to audit their daily logs.</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Tab 2: Analytics & Overall Standings View */
          <div className="attendance-analytics-tab" style={{ flex: 1, display: "flex", flexDirection: "column", overflowY: "auto" }}>
            {/* Global Metric Cards */}
            <section className="attendance-stats-row" style={{ borderBottom: "1px solid #edf1f7", padding: "24px 32px" }}>
              <div className="metric-card blue">
                <span>
                  <Calendar />
                </span>
                <div>
                  <p>Avg Present Days</p>
                  <strong>{avgAttendance.toFixed(1)} Days</strong>
                  <small>Across {data.length} audited rows</small>
                </div>
              </div>
              <div className="metric-card green">
                <span>
                  <Clock />
                </span>
                <div>
                  <p>Avg Stay Duration</p>
                  <strong>{avgStayHours.toFixed(1)} Hrs/Day</strong>
                  <small>Present day durations</small>
                </div>
              </div>
              <div className="metric-card amber">
                <span>
                  <FileSpreadsheet />
                </span>
                <div>
                  <p>Worked Sundays</p>
                  <strong>{totalWorkedSundays} Sundays</strong>
                  <small>{totalEligibleSundays} Sundays eligible for bonus</small>
                </div>
              </div>
              <div className="metric-card rose">
                <span>
                  <AlertTriangle />
                </span>
                <div>
                  <p>Bonus Exclusions</p>
                  <strong>{totalWarnings} Flags</strong>
                  <small>Worked Sundays denied bonus</small>
                </div>
              </div>
            </section>

            {/* Standings Charts section */}
            <div className="attendance-panel charts-panel" style={{ margin: "32px", border: "1px solid #e0e5ee", borderRadius: "8px", background: "#ffffff", boxShadow: "none" }}>
              <div className="detail-tabs" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 24px" }}>
                <span className="tab-title-text" style={{ fontSize: "14px", fontWeight: 800, color: "#334155" }}>Comparative Standings Charts</span>
                
                <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                  {/* Chart Sorting Controls */}
                  <div className="chart-sort-controls" style={{ display: "flex", alignItems: "center", gap: "8px", background: "#f1f5f9", padding: "3px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                    <span style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", padding: "0 6px" }}>Sort:</span>
                    <button
                      className={`chart-tab-btn ${chartSort === "value-desc" ? "active" : ""}`}
                      onClick={() => setChartSort("value-desc")}
                      style={{ fontSize: "11px", padding: "4px 8px" }}
                    >
                      High-Low
                    </button>
                    <button
                      className={`chart-tab-btn ${chartSort === "value-asc" ? "active" : ""}`}
                      onClick={() => setChartSort("value-asc")}
                      style={{ fontSize: "11px", padding: "4px 8px" }}
                    >
                      Low-High
                    </button>
                    <button
                      className={`chart-tab-btn ${chartSort === "name" ? "active" : ""}`}
                      onClick={() => setChartSort("name")}
                      style={{ fontSize: "11px", padding: "4px 8px" }}
                    >
                      A-Z
                    </button>
                  </div>

                  {/* Chart Metric Tabs */}
                  <div className="chart-tabs-btn-group" style={{ display: "flex", background: "#f1f5f9", padding: "3px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                    <button
                      className={`chart-tab-btn ${activeChartTab === "days" ? "active" : ""}`}
                      onClick={() => setActiveChartTab("days")}
                      style={{ fontSize: "11px", padding: "4px 8px" }}
                    >
                      Days Present
                    </button>
                    <button
                      className={`chart-tab-btn ${activeChartTab === "hours" ? "active" : ""}`}
                      onClick={() => setActiveChartTab("hours")}
                      style={{ fontSize: "11px", padding: "4px 8px" }}
                    >
                      Staying Hours
                    </button>
                  </div>
                </div>
              </div>

              <div className="detail-content" style={{ padding: "24px", background: "#ffffff" }}>
                <div className="global-charts-card">
                  <div className="chart-body">
                    {activeChartTab === "days" ? (
                      <div className="custom-horizontal-chart">
                        <p className="chart-instructions">
                          Days present during month (out of {data[0]?.daysDetail.length || 31} calendar days)
                        </p>
                        <div className="chart-scroll-area" style={{ maxHeight: "480px" }}>
                          {sortedChartData.map((emp) => {
                            const pct = (emp.presentDays / maxPresentDays) * 100;
                            return (
                              <div key={emp.id} className="chart-bar-row">
                                <div className="bar-label-name" title={emp.name}>
                                  {emp.name}
                                </div>
                                <div className="bar-track-wrap">
                                  <div className="bar-fill" style={{ width: `${pct}%` }}></div>
                                </div>
                                <div className="bar-val-outside">{emp.presentDays} days</div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div className="custom-horizontal-chart">
                        <p className="chart-instructions">
                          Average hours spent between earliest and latest punches
                        </p>
                        <div className="chart-scroll-area" style={{ maxHeight: "480px" }}>
                          {sortedChartData.map((emp) => {
                            const pct = (emp.avgHours / maxStayHours) * 100;
                            return (
                              <div key={emp.id} className="chart-bar-row">
                                <div className="bar-label-name" title={emp.name}>
                                  {emp.name}
                                </div>
                                <div className="bar-track-wrap">
                                  <div className="bar-fill hours-fill" style={{ width: `${pct}%` }}></div>
                                </div>
                                <div className="bar-val-outside">{emp.avgHours.toFixed(1)} hrs</div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  caption,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  caption?: string;
  tone: "green" | "blue" | "amber" | "rose";
}) {
  return (
    <article className={`metric-card ${tone}`}>
      <span>{icon}</span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        {caption ? <small>{caption}</small> : null}
      </div>
    </article>
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
}: {
  value: number | undefined | "";
  onChange: (value: number | undefined) => void;
  className?: string;
  min?: number;
  max?: number;
  allowBlank?: boolean;
  disabled?: boolean;
}) {
  const displayValue =
    allowBlank && (value === undefined || value === "") ? "" : Number.isFinite(value) ? value : 0;
  return (
    <input
      className={className}
      type="number"
      min={min}
      max={max}
      value={displayValue}
      disabled={disabled}
      onChange={(event) => {
        const val = event.target.value;
        if (allowBlank && val === "") {
          onChange(undefined);
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
