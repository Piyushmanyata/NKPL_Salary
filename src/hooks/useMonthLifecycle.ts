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
import { applyRateCardPatch, rateCardPatch } from "../../api/_lib/rateCard";
import {
  backupIfDue,
  clearDraft,
  getAllMonthLabels,
  getEmployeeRates,
  getMonthData,
  saveEmployeeRates,
  saveMonthData,
  takeDraft,
  writeDraft,
  type EmployeeRateMap,
  savedByThisTab,
  type StaleInfo,
} from "../db";
import {
  carryForwardEmployee,
  buildRateMap,
  hydrateRoster,
  hydrateSavedMonth,
} from "../roster";
import type { EmployeeInput } from "../types";
import {
  calendarDaysForMonth,
  normalizeMonthLabel,
  pickCarrySource,
  sortMonthsChronologically,
} from "../months";
import {
  hasUnsavedChanges,
  initialLifecycleState,
  monthLifecycleReducer,
  ratesSaveDelay,
  retryDelay,
  SAVE_DEBOUNCE_MS,
  saveStatus,
  type MonthLifecycleState,
  type SaveStatus,
} from "../monthLifecycle";

const DRAFT_DELAY_MS = 500;

type CarryResult = "copied" | "missing" | "unavailable" | "cancelled";

export type DraftNotice = { editedAt: string; restored: boolean };

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
  restoreVersion: (savedEmployees: unknown[]) => void;
  saveStatus: SaveStatus;
  nextRetryMs: number;
  draftNotice: DraftNotice | null;
  dismissDraftNotice: () => void;
};

function monthSignature(
  company: string,
  monthLabel: string,
  days: number,
  employees: EmployeeInput[],
): string {
  return JSON.stringify({ company, monthLabel, days, employees });
}

export function ratesSignature(roster: EmployeeInput[], baseline: string | null = null): string {
  return JSON.stringify({ ...ratesFromSignature(baseline), ...buildRateMap(roster) });
}

function ratesFromSignature(signature: string | null): EmployeeRateMap {
  return JSON.parse(signature ?? "{}");
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
  holdSave = false,
): MonthLifecycleApi {
  const [employees, setEmployees] = useState<EmployeeInput[]>([]);
  const [employeeRates, setEmployeeRates] = useState<EmployeeRateMap>({});
  const [allMonths, setAllMonths] = useState<string[]>([]);
  const [copySourceMonth, setCopySourceMonth] = useState("");
  const [loadRetryToken, setLoadRetryToken] = useState(0);
  const copyGenerationRef = useRef(0);
  const checkpointNextSaveRef = useRef(false);
  const retryAttemptRef = useRef(0);
  const backupAskedRef = useRef(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [draftNotice, setDraftNotice] = useState<DraftNotice | null>(null);
  const [lifecycle, dispatchLifecycle] = useReducer(
    monthLifecycleReducer,
    monthLabel,
    initialLifecycleState,
  );

  const scopeMonthLabel = normalizeMonthLabel(monthLabel);
  const isCanonicalMonth = scopeMonthLabel === monthLabel;
  const monthPayloadSignature = useMemo(
    () => monthSignature(activeCompany, scopeMonthLabel, effectiveMonthDays, employees),
    [activeCompany, scopeMonthLabel, effectiveMonthDays, employees],
  );
  const nextRatesSignature = useMemo(
    () => ratesSignature(employees, lifecycle.lastRatesSignature),
    [employees, lifecycle.lastRatesSignature],
  );

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
      const kept = takeDraft(activeCompany, target, 0);
      setEmployees(kept?.current ? hydrateSavedMonth(kept.draft.employees, targetDays, rates) : carried);
      setDraftNotice(kept && { editedAt: kept.draft.editedAt, restored: kept.current });
      dispatchLifecycle({
        type: "LOAD_SUCCESS",
        company: activeCompany,
        monthLabel: target,
        ratesSignature: ratesSignature(carried),
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
        const days = calendarDaysForMonth(scopeMonthLabel);
        const roster = hydrateSavedMonth(monthResult.record.employees, days, rates);
        const kept = takeDraft(activeCompany, scopeMonthLabel, monthResult.record.version);
        setEmployees(kept?.current ? hydrateSavedMonth(kept.draft.employees, days, rates) : roster);
        setDraftNotice(kept && { editedAt: kept.draft.editedAt, restored: kept.current });
        setSavedAt(monthResult.record.updatedAt);
        setOffline(Boolean(monthResult.fromCache));
        setCopySourceMonth("");
        dispatchLifecycle({
          type: "LOAD_SUCCESS",
          company: activeCompany,
          monthLabel: scopeMonthLabel,
          monthSignature: monthSignature(activeCompany, scopeMonthLabel, days, roster),
          ratesSignature: ratesSignature(roster),
          version: monthResult.record.version,
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
    setSavedAt(null);
    setOffline(false);
    setDraftNotice(null);
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
    if (!isCanonicalMonth || holdSave) return;
    const timer = window.setTimeout(() => {
      dispatchLifecycle({
        type: "SAVE_REQUEST",
        company: activeCompany,
        monthLabel: scopeMonthLabel,
        signature: monthPayloadSignature,
      });
    }, SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [
    activeCompany,
    holdSave,
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
    const checkpoint = checkpointNextSaveRef.current;
    checkpointNextSaveRef.current = false;
    void saveMonthData(
      pending.company,
      pending.monthLabel,
      calendarDaysForMonth(pending.monthLabel),
      employees,
      pending.baseVersion,
      checkpoint,
    ).then((result) => {
      if (result.ok) {
        setSavedAt(result.updatedAt);
        setOffline(false);
        dispatchLifecycle({
          type: "SAVE_SUCCESS",
          kind: "month",
          signature: pending.signature,
          version: result.version,
        });
      } else if (result.stale) {
        dispatchLifecycle({
          type: "SAVE_ERROR",
          kind: "month",
          signature: pending.signature,
          error: staleMessage(result.stale, true),
          stale: true,
        });
      } else {
        if (checkpoint) checkpointNextSaveRef.current = true;
        dispatchLifecycle({
          type: "SAVE_ERROR",
          kind: "month",
          signature: pending.signature,
          error: result.error || "Failed to save month data to the database.",
        });
      }
    }).catch((error: unknown) => {
      dispatchLifecycle({
        type: "SAVE_ERROR",
        kind: "month",
        signature: pending.signature,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, [lifecycle.pendingWrite]);

  useEffect(() => {
    if (!isCanonicalMonth || holdSave) return;
    const timer = window.setTimeout(() => {
      dispatchLifecycle({
        type: "RATES_SAVE_REQUEST",
        company: activeCompany,
        monthLabel: scopeMonthLabel,
        signature: nextRatesSignature,
      });
    }, ratesSaveDelay(lifecycle, monthPayloadSignature));
    return () => window.clearTimeout(timer);
  }, [
    activeCompany,
    holdSave,
    isCanonicalMonth,
    lifecycle.lastMonthSignature,
    lifecycle.pendingWrite,
    lifecycle.retryToken,
    lifecycle.status,
    monthPayloadSignature,
    nextRatesSignature,
    scopeMonthLabel,
  ]);

  useEffect(() => {
    const pending = lifecycle.pendingWrite;
    if (pending?.kind !== "rates") return;
    const patch = rateCardPatch(
      ratesFromSignature(lifecycle.lastRatesSignature),
      ratesFromSignature(pending.signature),
    );
    void saveEmployeeRates(pending.company, patch).then((result) => {
      if (result.ok) {
        setEmployeeRates((card) => applyRateCardPatch(card, patch));
        dispatchLifecycle({
          type: "SAVE_SUCCESS",
          kind: "rates",
          signature: pending.signature,
        });
      } else {
        dispatchLifecycle({
          type: "SAVE_ERROR",
          kind: "rates",
          signature: pending.signature,
          error: result.error || "Failed to save employee rates.",
        });
      }
    }).catch((error: unknown) => {
      dispatchLifecycle({
        type: "SAVE_ERROR",
        kind: "rates",
        signature: pending.signature,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, [lifecycle.pendingWrite]);

  const retry = useCallback(() => {
    const shouldReload = lifecycle.loadedScope === null || lifecycle.stale;
    dispatchLifecycle({ type: "RETRY" });
    if (shouldReload) setLoadRetryToken((token) => token + 1);
  }, [lifecycle.loadedScope, lifecycle.stale]);

  const onScreen = useMemo(
    () => ({ company: activeCompany, monthLabel: scopeMonthLabel }),
    [activeCompany, scopeMonthLabel],
  );
  const unsaved = hasUnsavedChanges(lifecycle, onScreen, monthPayloadSignature, nextRatesSignature);

  useEffect(() => {
    if (lifecycle.status === "saved" || lifecycle.status === "loaded") retryAttemptRef.current = 0;
  }, [lifecycle.status]);

  const autoRetry = lifecycle.status === "error" && !lifecycle.stale && !holdSave;
  const nextRetryMs = retryDelay(retryAttemptRef.current);
  useEffect(() => {
    if (!autoRetry) return;
    const timer = window.setTimeout(() => {
      retryAttemptRef.current += 1;
      retry();
    }, nextRetryMs);
    return () => window.clearTimeout(timer);
  }, [autoRetry, lifecycle.saveError, nextRetryMs, retry]);

  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  const loadedScope = lifecycle.loadedScope;
  const draftScope =
    loadedScope?.company === onScreen.company && loadedScope.monthLabel === onScreen.monthLabel ? loadedScope : null;
  useEffect(() => {
    if (!draftScope || lifecycle.stale) return;
    const timer = window.setTimeout(() => {
      if (!unsaved) return clearDraft(draftScope.company, draftScope.monthLabel);
      writeDraft(draftScope.company, draftScope.monthLabel, {
        baseVersion: lifecycle.version,
        employees,
        editedAt: new Date().toISOString(),
      });
    }, DRAFT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [draftScope, employees, lifecycle.stale, lifecycle.version, unsaved]);

  useEffect(() => {
    if (!loadedScope || backupAskedRef.current) return;
    backupAskedRef.current = true;
    void backupIfDue();
  }, [loadedScope]);

  useEffect(() => {
    if (!loadedScope) return;
    const { company, monthLabel: loadedMonth } = loadedScope;
    const checkServer = () => {
      if (document.visibilityState !== "visible") return;
      void getMonthData(company, loadedMonth).then((result) => {
        if (result.kind !== "found" || result.fromCache) return;
        setOffline(false);
        if (savedByThisTab(result.record)) return;
        dispatchLifecycle({
          type: "NEWER_ON_SERVER",
          company,
          monthLabel: loadedMonth,
          version: result.record.version,
          error: staleMessage(result.record, false),
        });
      });
    };
    document.addEventListener("visibilitychange", checkServer);
    window.addEventListener("focus", checkServer);
    return () => {
      document.removeEventListener("visibilitychange", checkServer);
      window.removeEventListener("focus", checkServer);
    };
  }, [loadedScope]);

  const restoreVersion = useCallback(
    (savedEmployees: unknown[]) => {
      checkpointNextSaveRef.current = true;
      setEmployees(hydrateSavedMonth(savedEmployees, calendarDaysForMonth(scopeMonthLabel), employeeRates));
    },
    [employeeRates, scopeMonthLabel],
  );

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
      ratesSignature: ratesSignature([]),
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
      ratesSignature: ratesSignature(sanitized),
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
    restoreVersion,
    saveStatus: saveStatus(lifecycle, unsaved, offline, savedAt, holdSave),
    nextRetryMs,
    draftNotice,
    dismissDraftNotice: () => setDraftNotice(null),
  };
}

function staleMessage(saved: StaleInfo, editLost: boolean): string {
  const when = saved.updatedAt ? ` at ${formatSavedAt(saved.updatedAt)}` : "";
  const where = saved.device ? ` from ${saved.device}` : "";
  const lost = editLost ? " Your last change in this tab was NOT saved." : "";
  return `Newer data was saved${when}${where}. This tab is out of date.${lost} Reload to see the latest.`;
}

export function formatSavedAt(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}
