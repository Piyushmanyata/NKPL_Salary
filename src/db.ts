import type { EmployeeInput } from "./types";
import {
  legacyStorageKeys,
  readStorage,
  storageKeys,
  writeStorage,
} from "./storageKeys";

export interface MonthRecord {
  id: string;
  company: string;
  monthLabel: string;
  days: number;
  employees: EmployeeInput[];
  updatedAt: string;
}

export type MonthDataResult =
  | { kind: "found"; record: MonthRecord }
  | { kind: "empty" }
  | { kind: "unavailable"; error: string };

export type MonthLabelsResult =
  | { kind: "found"; labels: string[] }
  | { kind: "unavailable"; error: string };

function recordId(company: string, monthLabel: string) {
  return `${company}::${monthLabel}`;
}

function localPutRecord(record: MonthRecord): void {
  writeStorage(
    storageKeys.monthCache(record.company, record.monthLabel),
    JSON.stringify(record),
  );
}

function localGetRecord(company: string, monthLabel: string): MonthRecord | null {
  const cached = readStorage(
    storageKeys.monthCache(company, monthLabel),
    legacyStorageKeys.monthCache(company, monthLabel),
  );
  if (!cached) return null;
  try {
    return JSON.parse(cached) as MonthRecord;
  } catch {
    return null;
  }
}

type FetchResult =
  | { ok: true; data: unknown }
  | { ok: false; kind: "not-found" | "unavailable"; error: string };

async function fetchJson(url: string): Promise<FetchResult> {
  try {
    const response = await fetch(url);
    if (response.status === 404) {
      return { ok: false, kind: "not-found", error: "Not found" };
    }
    if (!response.ok) {
      return {
        ok: false,
        kind: "unavailable",
        error: (await response.text()) || `Request failed with status ${response.status}`,
      };
    }
    return { ok: true, data: await response.json() };
  } catch (error) {
    return {
      ok: false,
      kind: "unavailable",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function postJson(
  url: string,
  body: unknown,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const error = await response.text();
      console.error("POST failed:", error);
      return { ok: false, error };
    }
    return { ok: true };
  } catch (error: any) {
    console.error("POST error:", error);
    return { ok: false, error: error?.message || String(error) };
  }
}

export async function saveMonthData(
  company: string,
  monthLabel: string,
  days: number,
  employees: EmployeeInput[],
): Promise<{ ok: boolean; error?: string }> {
  const record: MonthRecord = {
    id: recordId(company, monthLabel),
    company,
    monthLabel,
    days,
    employees,
    updatedAt: new Date().toISOString(),
  };
  localPutRecord(record);
  return postJson("/api/db", record);
}

export async function getMonthData(
  company: string,
  monthLabel: string,
): Promise<MonthDataResult> {
  const result = await fetchJson(
    `/api/db?company=${encodeURIComponent(company)}&month=${encodeURIComponent(monthLabel)}&t=${Date.now()}`,
  );
  const cached = localGetRecord(company, monthLabel);
  if (result.ok && result.data) {
    const data = result.data as Partial<MonthRecord>;
    const record: MonthRecord = {
      id: recordId(company, monthLabel),
      company,
      monthLabel: data.monthLabel ?? monthLabel,
      days: data.days ?? 0,
      employees: data.employees || [],
      updatedAt: data.updatedAt || new Date().toISOString(),
    };
    localPutRecord(record);
    return { kind: "found", record };
  }
  if (cached) return { kind: "found", record: cached };
  if (!result.ok && result.kind === "unavailable") {
    return { kind: "unavailable", error: result.error };
  }
  return { kind: "empty" };
}

export async function getAllMonthLabels(company: string): Promise<MonthLabelsResult> {
  const result = await fetchJson(
    `/api/db?company=${encodeURIComponent(company)}&t=${Date.now()}`,
  );
  if (result.ok && Array.isArray(result.data)) {
    return { kind: "found", labels: Array.from(new Set(result.data as string[])) };
  }

  const keys: string[] = [];
  if (typeof localStorage !== "undefined") {
    try {
      const newPrefix = storageKeys.monthCachePrefix + company + "::";
      const oldPrefix = legacyStorageKeys.monthCachePrefix + company + "::";
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (key.startsWith(newPrefix)) {
          keys.push(key.slice(newPrefix.length));
        } else if (key.startsWith(oldPrefix)) {
          keys.push(key.slice(oldPrefix.length));
        }
      }
    } catch {
      // A non-browser caller has no local fallback to consult.
    }
  }
  const labels = Array.from(new Set(keys));
  if (labels.length) return { kind: "found", labels };
  if (!result.ok && result.kind === "unavailable") {
    return { kind: "unavailable", error: result.error };
  }
  return { kind: "found", labels: [] };
}

export interface EmployeeRate {
  id: string;
  name: string;
  salaryPerDay: number;
  bonusPerDay: number;
  monthlySalary?: number;
  totalSalary?: number;
  notes?: string;
}

export type EmployeeRateMap = Record<string, EmployeeRate>;

export async function getEmployeeRates(company: string): Promise<EmployeeRateMap> {
  const result = await fetchJson(
    `/api/rates?company=${encodeURIComponent(company)}&t=${Date.now()}`,
  );
  if (result.ok && result.data && typeof result.data === "object") {
    writeStorage(storageKeys.employeeRates(company), JSON.stringify(result.data));
    return result.data as EmployeeRateMap;
  }

  const cached = readStorage(
    storageKeys.employeeRates(company),
    legacyStorageKeys.employeeRates(company),
  );
  if (cached) {
    try {
      return JSON.parse(cached) as EmployeeRateMap;
    } catch {
      // ignore
    }
  }
  return {};
}

export async function saveEmployeeRates(
  company: string,
  rates: EmployeeRateMap,
): Promise<{ ok: boolean; error?: string }> {
  writeStorage(storageKeys.employeeRates(company), JSON.stringify(rates));
  return postJson("/api/rates", { company, rates });
}
