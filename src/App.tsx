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
  Users,
  AlertTriangle,
  X,
  Check,
  Cloud,
  Wifi,
  Building2,
} from "lucide-react";
import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
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
  clampDays,
  clampMonthDays,
  currency,
  isSpecialCategory,
  monthlyFromDaily,
  numberValue,
  repairRates,
  roundMoney,
  uid,
} from "./salary";
import type {
  Category,
  EmployeeInput,
  SalaryRow,
} from "./types";
import { buildOfficialRow, normalizeCategory } from "./officialSheet";

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

const blankEmployee = (monthDays: number): EmployeeInput => ({
  id: uid(),
  name: "New Employee",
  category: "Skilled",
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
    // Extra Days are a manual payroll input; only Special has none at all.
    extraDays: isSpecial ? 0 : Math.max(0, numberValue(row.extraDays)),
    basicPercent: clampBasicPercent(row.basicPercent),
    pfOptIn: isSpecial ? false : row.pfOptIn !== false,
    esiOptIn: isSpecial ? false : row.esiOptIn !== false,
    // Absent stays absent: this one must default to "no consent", never to true
    // the way esiOptIn does (ADR-0011).
    esiOverLimitOptIn: !isSpecial && row.esiOverLimitOptIn === true ? true : undefined,
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
  // Reset manual per-month pay inputs so last month's absences are not billed twice.
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
      // Notes are per employee, not per month — the shared record owns them.
      ...(rate.notes ? { notes: rate.notes } : {}),
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
      ...(employee.notes?.trim() ? { notes: employee.notes } : {}),
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

        // Free text — must never reach the numeric fallthrough at the bottom.
        if (field === "notes") {
          const notes = String(value ?? "");
          return { ...employee, notes: notes.trim() ? notes : undefined };
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

        if (field === "pfOptIn" || field === "esiOptIn" || field === "esiOverLimitOptIn") {
          if (isSpecialCategory(employee.category)) {
            return { ...employee, pfOptIn: false, esiOptIn: false, esiOverLimitOptIn: undefined };
          }
          if (field === "esiOverLimitOptIn") {
            // Only ever stored as an explicit true; off is the absence of consent.
            return {
              ...employee,
              esiOverLimitOptIn: booleanValue(value) ? true : undefined,
            };
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
            // Full precision on the way in: rounding r to paise meant a typed
            // 12,000 came back as D × 387.10 = 11,999.10, i.e. the box refused
            // the number entered. M = D × r now round-trips exactly.
            return {
              ...employee,
              monthlySalary,
              salaryPerDay: monthlySalary / D,
              bonusPerDay: field === "allowance" ? typed / D : employee.bonusPerDay,
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
    if (!isDbModalOpen && !showNoDataModal) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (isDbModalOpen) {
        setIsDbModalOpen(false);
      } else if (showNoDataModal) {
        handleCancelNoData();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDbModalOpen, showNoDataModal]);

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
                                className={row.notes?.trim() ? "icon-button has-notes" : "icon-button"}
                                title={row.notes?.trim() ? `Employee settings — notes:\n${row.notes}` : "Employee settings"}
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
                                    <small>
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
                                  <div className="settings-column">
                                    <span>Category</span>
                                    <strong>{row.category}</strong>
                                    <small>
                                      {isSpecial
                                        ? "Special: full pay, no day rate, no PF/ESI"
                                        : "Change grade via the Category column"}
                                    </small>
                                  </div>
                                  <div className="settings-column settings-column--full">
                                    <span>Notes</span>
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
                          <td>{currency(row.monthlyBasic)}</td>
                          <td>{currency(row.monthlyHra)}</td>
                          <td>{currency(row.monthlyTravelAllowance)}</td>
                          <td>{currency(row.bonus)}</td>
                          <td>{currency(row.pf)}</td>
                          <td>{currency(row.esi)}</td>
                          <td>{currency(row.professionalTax)}</td>
                          {/* Read-only here — the advance is typed on the reference
                              sheet and already deducted from this net. */}
                          <td>{currency(Math.max(0, Number(row.advance) || 0))}</td>
                          <td className="net-cell">{currency(row.netPayable)}</td>
                          <td>{currency(row.referenceNetPayable)}</td>
                        </tr>
                      );
                    })}
                    {!filteredOfficialRows.length ? (
                      <tr className="empty-row">
                        <td colSpan={13}>
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
                ? "Category is set by hand, never guessed from salary. Earned is Salary/Month prorated by Days Worked. Basic is Earned x Basic %. HRA and TA split prorated Total Salary minus Basic in a 70% / 30% ratio."
                : `For PF-on rows, main-sheet attendance starts at 26 - (${effectiveMonthDays} calendar days - Days Worked), then reduces when needed so Basic always equals attendance x category daily wage. HRA/travel allowance are Days-Worked-prorated, and any excess target gross is shown as Bonus so net pay matches the reference sheet. PF-off rows stay aligned with the reference sheet.`}
            </div>
          </article>

          <aside className="side-stack">
            <article className="panel">
              <div className="panel-heading compact">
                <div>
                  <h2>Rules</h2>
                  <p>Applied to calculations</p>
                </div>
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
                 <Rule label="Extra Days" value="Entered manually; used for the performance bonus" />
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

function MetricCard({
  icon,
  label,
  value,
  caption,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  caption: string;
  tone: "green" | "blue" | "amber" | "rose";
}) {
  return (
    <article className={`metric-card ${tone}`}>
      <span>{icon}</span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <small>{caption}</small>
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
