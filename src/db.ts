import { applyRateCardPatch, type RateCardPatch } from "../api/_lib/rateCard";
import type { EmployeeInput, Increment } from "./types";
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
  version: number;
  device?: string;
  tabId?: string;
}

export type StaleInfo = { updatedAt?: string; device?: string };

export type SaveMonthResult =
  | { ok: true; version: number; updatedAt: string }
  | { ok: false; error: string; stale?: StaleInfo };

const TAB_ID = globalThis.crypto.randomUUID();

export const REQUEST_TIMEOUT_MS = 15_000;

/** One error text for every failed call, in words a payroll user can act on. */
export function friendlyError(error: unknown): string {
  if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return `The server did not answer in ${REQUEST_TIMEOUT_MS / 1000} seconds.`;
  }
  if (error instanceof TypeError) return "Could not reach the server. Check the internet connection.";
  return error instanceof Error ? error.message : String(error);
}

async function responseError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const body = JSON.parse(text) as { error?: unknown };
    if (typeof body.error === "string" && body.error) return body.error;
  } catch {
    // Not JSON: the text itself is the message.
  }
  return text || `The server answered with error ${response.status}.`;
}

function send(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

export type MonthDataResult =
  | { kind: "found"; record: MonthRecord; fromCache?: boolean }
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
    const record = JSON.parse(cached) as MonthRecord;
    return { ...record, version: record.version ?? 1 };
  } catch {
    return null;
  }
}

type FetchResult =
  | { ok: true; data: unknown }
  | { ok: false; kind: "not-found" | "unavailable"; error: string };

async function fetchJson(url: string): Promise<FetchResult> {
  try {
    const response = await send(url);
    if (response.status === 404) {
      return { ok: false, kind: "not-found", error: "Not found" };
    }
    if (!response.ok) {
      return { ok: false, kind: "unavailable", error: await responseError(response) };
    }
    return { ok: true, data: await response.json() };
  } catch (error) {
    return { ok: false, kind: "unavailable", error: friendlyError(error) };
  }
}

async function postJson(
  url: string,
  body: unknown,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await send(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) return { ok: false, error: await responseError(response) };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
}

export async function saveMonthData(
  company: string,
  monthLabel: string,
  days: number,
  employees: EmployeeInput[],
  baseVersion: number,
  checkpoint = false,
): Promise<SaveMonthResult> {
  try {
    const response = await send("/api/db", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company, monthLabel, days, employees, baseVersion, tabId: TAB_ID, checkpoint }),
    });
    if (response.status === 409) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        current?: StaleInfo | null;
      };
      return { ok: false, error: body.error || "This tab is out of date.", stale: body.current ?? {} };
    }
    if (!response.ok) return { ok: false, error: await responseError(response) };
    const saved = (await response.json()) as { version: number; updatedAt: string };
    localPutRecord({
      id: recordId(company, monthLabel),
      company,
      monthLabel,
      days,
      employees,
      updatedAt: saved.updatedAt,
      version: saved.version,
    });
    return { ok: true, version: saved.version, updatedAt: saved.updatedAt };
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
}

export function savedByThisTab(record: MonthRecord): boolean {
  return record.tabId === TAB_ID;
}

export async function getMonthHistory(
  company: string,
  monthLabel: string,
): Promise<{ ok: true; records: MonthRecord[] } | { ok: false; error: string }> {
  const result = await fetchJson(
    `/api/db?company=${encodeURIComponent(company)}&month=${encodeURIComponent(monthLabel)}&history=1&t=${Date.now()}`,
  );
  if (!result.ok) return { ok: false, error: result.error };
  const records = (Array.isArray(result.data) ? result.data : []) as Partial<MonthRecord>[];
  return { ok: true, records: records.map((data) => toRecord(company, monthLabel, data)) };
}

function toRecord(company: string, monthLabel: string, data: Partial<MonthRecord>): MonthRecord {
  return {
    id: recordId(company, monthLabel),
    company,
    monthLabel: data.monthLabel ?? monthLabel,
    days: data.days ?? 0,
    employees: data.employees || [],
    updatedAt: data.updatedAt || new Date().toISOString(),
    version: data.version ?? 1,
    device: data.device,
    tabId: data.tabId,
  };
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
    const record = toRecord(company, monthLabel, result.data as Partial<MonthRecord>);
    localPutRecord(record);
    return { kind: "found", record };
  }
  if (cached) {
    const notOnServer = !result.ok && result.kind === "not-found";
    return notOnServer
      ? { kind: "found", record: { ...cached, version: 0 } }
      : { kind: "found", record: cached, fromCache: true };
  }
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
  /** Standing Official basic pin at full attendance. SPEC §6.3 / issue #29. */
  fullAttendanceBasic?: number;
  increments?: Increment[];
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
  return cachedEmployeeRates(company);
}

function cachedEmployeeRates(company: string): EmployeeRateMap {
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
  patch: RateCardPatch,
): Promise<{ ok: boolean; error?: string }> {
  writeStorage(
    storageKeys.employeeRates(company),
    JSON.stringify(applyRateCardPatch(cachedEmployeeRates(company), patch)),
  );
  return postJson("/api/rates", { company, patch });
}

/** Edits this tab has not saved yet, kept in the browser so a closed tab or a crash does not lose them. */
export type MonthDraft = { baseVersion: number; employees: EmployeeInput[]; editedAt: string };

export function writeDraft(company: string, monthLabel: string, draft: MonthDraft): void {
  writeStorage(storageKeys.monthDraft(company, monthLabel), JSON.stringify(draft));
}

export function clearDraft(company: string, monthLabel: string): void {
  try {
    localStorage.removeItem(storageKeys.monthDraft(company, monthLabel));
  } catch {
    // A browser without storage has no draft to clear.
  }
}

/** Removes the draft and says whether it can go back: only when nothing was saved since it was made, or it would put back older data. */
export function takeDraft(
  company: string,
  monthLabel: string,
  serverVersion: number,
): { draft: MonthDraft; current: boolean } | null {
  const raw = readStorage(storageKeys.monthDraft(company, monthLabel));
  if (!raw) return null;
  clearDraft(company, monthLabel);
  try {
    const draft = JSON.parse(raw) as MonthDraft;
    if (!Array.isArray(draft.employees)) return null;
    return { draft, current: draft.baseVersion === serverVersion };
  } catch {
    return null;
  }
}

export type BackupStatus = { configured: boolean; lastAt: string | null; took?: boolean };

export async function getBackupStatus(): Promise<BackupStatus | null> {
  const result = await fetchJson(`/api/backup?t=${Date.now()}`);
  return result.ok ? (result.data as BackupStatus) : null;
}

/** The server copies everything to the backup store if the last copy is older than 20 hours. */
export async function backupIfDue(): Promise<BackupStatus | null> {
  try {
    const response = await send("/api/backup", { method: "POST" });
    return response.ok ? ((await response.json()) as BackupStatus) : null;
  } catch {
    return null;
  }
}

export const BACKUP_DOWNLOAD_URL = "/api/backup?download=1";
