import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  getAllMonthLabels,
  getEmployeeRates,
  getMonthData,
  saveEmployeeRates,
  saveMonthData,
  type EmployeeRateMap,
} from "../db";
import {
  carryForwardEmployee,
  buildRateMap,
  hydrateRoster,
} from "../roster";
import type { EmployeeInput } from "../types";
import {
  calendarDaysForMonth,
  normalizeMonthLabel,
  pickCarrySource,
  sortMonthsChronologically,
} from "../months";
import {
  initialLifecycleState,
  monthLifecycleReducer,
  type MonthLifecycleState,
} from "../monthLifecycle";

type CarryResult = "copied" | "missing" | "unavailable" | "cancelled";

export type MonthLifecycleApi = {
  lifecycle: MonthLifecycleState;
  employees: EmployeeInput[];
  setEmployees: Dispatch<SetStateAction<EmployeeInput[]>>;
  employeeRates: EmployeeRateMap;
  allMonths: string[];
  copySourceMonth: string;
  setCopySourceMonth: Dispatch<SetStateAction<string>>;
  showNoDataModal: boolean;
  dbLoading: boolean;
  retry: () => void;
  cancelNoData: () => void;
  createBlankMonth: () => void;
  createSampleMonth: () => Promise<void>;
  copyMonth: (source: string) => Promise<CarryResult>;
};

function monthSignature(
  company: string,
  monthLabel: string,
  days: number,
  employees: EmployeeInput[],
): string {
  return JSON.stringify({ company, monthLabel, days, employees });
}

function ratesSignature(rates: EmployeeRateMap): string {
  return JSON.stringify(rates);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function defaultEmployeesForCompany(company: string): Promise<EmployeeInput[]> {
  if (company !== "NKPL") return [];
  return (await import("../juneEmployees")).juneEmployees;
}

export function useMonthLifecycle(
  activeCompany: string,
  monthLabel: string,
  effectiveMonthDays: number,
): MonthLifecycleApi {
  const [employees, setEmployees] = useState<EmployeeInput[]>([]);
  const [employeeRates, setEmployeeRates] = useState<EmployeeRateMap>({});
  const [allMonths, setAllMonths] = useState<string[]>([]);
  const [copySourceMonth, setCopySourceMonth] = useState("");
  const [loadRetryToken, setLoadRetryToken] = useState(0);
  const copyGenerationRef = useRef(0);
  const [lifecycle, dispatchLifecycle] = useReducer(
    monthLifecycleReducer,
    monthLabel,
    initialLifecycleState,
  );

  const scopeMonthLabel = normalizeMonthLabel(monthLabel);
  const isCanonicalMonth = scopeMonthLabel === monthLabel;
  const nextRates = useMemo(() => buildRateMap(employees), [employees]);
  const monthPayloadSignature = useMemo(
    () => monthSignature(activeCompany, scopeMonthLabel, effectiveMonthDays, employees),
    [activeCompany, scopeMonthLabel, effectiveMonthDays, employees],
  );
  const nextRatesSignature = useMemo(() => ratesSignature(nextRates), [nextRates]);

  const carryMonthInto = useCallback(
    async (
      source: string,
      target: string,
      rates: EmployeeRateMap,
      isCancelled?: () => boolean,
    ): Promise<CarryResult> => {
      const sourceResult = await getMonthData(activeCompany, source);
      if (isCancelled?.()) return "cancelled";
      if (sourceResult.kind === "unavailable") return "unavailable";
      if (sourceResult.kind === "empty") return "missing";

      const targetDays = calendarDaysForMonth(target);
      const carried = hydrateRoster(sourceResult.record.employees, targetDays, rates).map((employee) =>
        carryForwardEmployee(employee, targetDays),
      );
      if (isCancelled?.()) return "cancelled";
      setEmployees(carried);
      dispatchLifecycle({
        type: "LOAD_SUCCESS",
        company: activeCompany,
        monthLabel: target,
        suppressNextSave: false,
        ratesSignature: ratesSignature(rates),
      });
      setAllMonths((current) =>
        current.includes(target) ? current : sortMonthsChronologically([...current, target]),
      );
      return "copied";
    },
    [activeCompany],
  );

  const loadScope = useCallback(
    async (isCancelled: () => boolean): Promise<void> => {
      if (!isCanonicalMonth) return;

      const [monthResult, rates] = await Promise.all([
        getMonthData(activeCompany, scopeMonthLabel),
        getEmployeeRates(activeCompany),
      ]);
      if (isCancelled()) return;
      setEmployeeRates(rates);

      if (monthResult.kind === "unavailable") {
        dispatchLifecycle({ type: "LOAD_ERROR", error: monthResult.error });
        return;
      }

      if (monthResult.kind === "found") {
        const roster = hydrateRoster(
          monthResult.record.employees,
          calendarDaysForMonth(scopeMonthLabel),
        );
        setEmployees(roster);
        setCopySourceMonth("");
        dispatchLifecycle({
          type: "LOAD_SUCCESS",
          company: activeCompany,
          monthLabel: scopeMonthLabel,
          monthSignature: monthSignature(
            activeCompany,
            scopeMonthLabel,
            calendarDaysForMonth(scopeMonthLabel),
            roster,
          ),
          ratesSignature: ratesSignature(rates),
        });
        return;
      }

      const monthLabels = await getAllMonthLabels(activeCompany);
      if (isCancelled()) return;
      if (monthLabels.kind === "unavailable") {
        dispatchLifecycle({ type: "LOAD_ERROR", error: monthLabels.error });
        return;
      }
      const months = sortMonthsChronologically(monthLabels.labels);
      setAllMonths(months);
      const source = pickCarrySource(months, scopeMonthLabel);
      setCopySourceMonth(source);
      const carryResult = source
        ? await carryMonthInto(source, scopeMonthLabel, rates, isCancelled)
        : "missing";
      if (isCancelled()) return;
      if (carryResult === "copied") return;
      if (carryResult === "cancelled") return;
      if (carryResult === "unavailable") {
        dispatchLifecycle({ type: "LOAD_ERROR", error: "Unable to read the carry-forward month." });
        return;
      }

      setEmployees([]);
      dispatchLifecycle({
        type: "LOAD_EMPTY",
        company: activeCompany,
        monthLabel: scopeMonthLabel,
      });
    },
    [
      activeCompany,
      carryMonthInto,
      isCanonicalMonth,
      scopeMonthLabel,
    ],
  );

  // The one load path. A retry re-runs it by bumping loadRetryToken rather than
  // running a second effect, so a scope change after a retry cannot start two
  // concurrent loads for the same scope.
  useEffect(() => {
    let cancelled = false;
    setEmployees([]);
    dispatchLifecycle({
      type: "SELECT_SCOPE",
      company: activeCompany,
      monthLabel: scopeMonthLabel,
    });
    void loadScope(() => cancelled).catch((error: unknown) => {
      if (!cancelled) {
        dispatchLifecycle({ type: "LOAD_ERROR", error: errorMessage(error) });
      }
    });
    return () => {
      cancelled = true;
      copyGenerationRef.current += 1;
    };
  }, [activeCompany, loadRetryToken, loadScope, scopeMonthLabel]);

  useEffect(() => {
    if (!isCanonicalMonth) return;
    const timer = window.setTimeout(() => {
      dispatchLifecycle({
        type: "SAVE_REQUEST",
        company: activeCompany,
        monthLabel: scopeMonthLabel,
        signature: monthPayloadSignature,
      });
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [
    activeCompany,
    isCanonicalMonth,
    lifecycle.pendingWrite,
    lifecycle.retryToken,
    lifecycle.status,
    monthPayloadSignature,
    scopeMonthLabel,
  ]);

  useEffect(() => {
    const pending = lifecycle.pendingWrite;
    if (pending?.kind !== "month") return;
    void saveMonthData(
      pending.company,
      pending.monthLabel,
      calendarDaysForMonth(pending.monthLabel),
      employees,
    ).then((result) => {
      if (result.ok) {
        dispatchLifecycle({
          type: "SAVE_SUCCESS",
          kind: "month",
          signature: pending.signature,
        });
      } else {
        dispatchLifecycle({
          type: "SAVE_ERROR",
          error: result.error || "Failed to save month data to the database.",
        });
      }
    }).catch((error: unknown) => {
      dispatchLifecycle({
        type: "SAVE_ERROR",
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, [lifecycle.pendingWrite]);

  useEffect(() => {
    if (!isCanonicalMonth) return;
    const timer = window.setTimeout(() => {
      dispatchLifecycle({
        type: "RATES_SAVE_REQUEST",
        company: activeCompany,
        monthLabel: scopeMonthLabel,
        signature: nextRatesSignature,
      });
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [
    activeCompany,
    isCanonicalMonth,
    lifecycle.pendingWrite,
    lifecycle.retryToken,
    lifecycle.status,
    nextRatesSignature,
    scopeMonthLabel,
  ]);

  useEffect(() => {
    const pending = lifecycle.pendingWrite;
    if (pending?.kind !== "rates") return;
    void saveEmployeeRates(pending.company, nextRates).then((result) => {
      if (result.ok) {
        setEmployeeRates(nextRates);
        dispatchLifecycle({
          type: "SAVE_SUCCESS",
          kind: "rates",
          signature: pending.signature,
        });
      } else {
        dispatchLifecycle({
          type: "SAVE_ERROR",
          error: result.error || "Failed to save employee rates.",
        });
      }
    }).catch((error: unknown) => {
      dispatchLifecycle({
        type: "SAVE_ERROR",
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, [lifecycle.pendingWrite]);

  const retry = useCallback(() => {
    const shouldReload = lifecycle.loadedScope === null;
    dispatchLifecycle({ type: "RETRY" });
    if (shouldReload) setLoadRetryToken((token) => token + 1);
  }, [lifecycle.loadedScope]);

  const cancelNoData = useCallback(() => {
    copyGenerationRef.current += 1;
    dispatchLifecycle({ type: "CANCEL_CHOICE" });
  }, []);

  const createBlankMonth = useCallback(() => {
    setEmployees([]);
    setCopySourceMonth("");
    dispatchLifecycle({
      type: "LOAD_SUCCESS",
      company: activeCompany,
      monthLabel: scopeMonthLabel,
      suppressNextSave: false,
    });
  }, [activeCompany, scopeMonthLabel]);

  const createSampleMonth = useCallback(async () => {
    const defaults = await defaultEmployeesForCompany(activeCompany);
    const sanitized = hydrateRoster(defaults, effectiveMonthDays, employeeRates);
    setEmployees(sanitized);
    setCopySourceMonth("");
    dispatchLifecycle({
      type: "LOAD_SUCCESS",
      company: activeCompany,
      monthLabel: scopeMonthLabel,
      suppressNextSave: false,
      ratesSignature: ratesSignature(employeeRates),
    });
  }, [activeCompany, effectiveMonthDays, employeeRates, scopeMonthLabel]);

  const copyMonth = useCallback(
    async (source: string) => {
      const generation = copyGenerationRef.current;
      return carryMonthInto(
        source,
        scopeMonthLabel,
        employeeRates,
        () => copyGenerationRef.current !== generation,
      );
    },
    [carryMonthInto, employeeRates, scopeMonthLabel],
  );

  return {
    lifecycle,
    employees,
    setEmployees,
    employeeRates,
    allMonths,
    copySourceMonth,
    setCopySourceMonth,
    showNoDataModal: lifecycle.awaitingChoice,
    dbLoading: lifecycle.status === "loading",
    retry,
    cancelNoData,
    createBlankMonth,
    createSampleMonth,
    copyMonth,
  };
}
