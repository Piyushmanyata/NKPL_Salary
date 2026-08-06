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

async function fetchJson(url: string): Promise<{ ok: true; data: unknown } | { ok: false }> {
  try {
    const response = await fetch(url);
    if (!response.ok) return { ok: false };
    return { ok: true, data: await response.json() };
  } catch (error) {
    console.error("fetch failed:", error);
    return { ok: false };
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
): Promise<MonthRecord | null> {
  const result = await fetchJson(
    `/api/db?company=${encodeURIComponent(company)}&month=${encodeURIComponent(monthLabel)}&t=${Date.now()}`,
  );
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
    return record;
  }
  return localGetRecord(company, monthLabel);
}

export async function getAllMonthLabels(company: string): Promise<string[]> {
  const result = await fetchJson(
    `/api/db?company=${encodeURIComponent(company)}&t=${Date.now()}`,
  );
  if (result.ok && Array.isArray(result.data)) {
    return result.data as string[];
  }

  const keys: string[] = [];
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
  } catch (err) {
    console.error("Failed to read from local storage keys:", err);
  }
  return keys;
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
