import { EmployeeInput } from "./types";

export interface MonthRecord {
  id: string;
  company: string;
  monthLabel: string;
  days: number;
  employees: EmployeeInput[];
  updatedAt: string;
}

const DB_NAME = "NKPL_Salary_DB";
const DB_VERSION = 2;
const STORE_NAME = "monthly_salary";
const DEFAULT_COMPANY = "NKPL";

function recordId(company: string, monthLabel: string) {
  return `${company}::${monthLabel}`;
}

function getDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("company", "company", { unique: false });
        return;
      }

      // Migrating from v1 (keyPath: "monthLabel", single implicit company) to
      // v2 (keyPath: "id", explicit company field + index). All pre-existing
      // records belonged to NKPL, since it was the only company at the time.
      if (event.oldVersion < 2 && tx) {
        const oldStore = tx.objectStore(STORE_NAME);
        const migrated: any[] = [];
        const cursorRequest = oldStore.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (cursor) {
            const value = cursor.value;
            const company = value.company || DEFAULT_COMPANY;
            migrated.push({ ...value, company, id: recordId(company, value.monthLabel) });
            cursor.continue();
          } else {
            db.deleteObjectStore(STORE_NAME);
            const newStore = db.createObjectStore(STORE_NAME, { keyPath: "id" });
            newStore.createIndex("company", "company", { unique: false });
            migrated.forEach((record) => newStore.put(record));
          }
        };
      }
    };
  });
}

export interface CloudConfig {
  enabled: boolean;
}

// Automatically enabled because we use Vercel's backend environment
export function getCloudConfig(): CloudConfig {
  return { enabled: true };
}

// Write (upsert) a month record into the local IndexedDB cache.
async function idbPutRecord(record: MonthRecord): Promise<void> {
  const db = await getDB();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function saveMonthData(
  company: string,
  monthLabel: string,
  days: number,
  employees: EmployeeInput[],
): Promise<void> {
  const record: MonthRecord = {
    id: recordId(company, monthLabel),
    company,
    monthLabel,
    days,
    employees,
    updatedAt: new Date().toISOString(),
  };

  // 1. Save to local IndexedDB
  try {
    await idbPutRecord(record);
  } catch (err) {
    console.error("Failed to save to local IndexedDB:", err);
  }

  // 2. Sync to Vercel Blob store via serverless proxy
  try {
    const response = await fetch("/api/db", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(record),
    });

    if (!response.ok) {
      console.error("Vercel Blob sync failed:", await response.text());
    }
  } catch (error) {
    console.error("Error syncing to Vercel Blob:", error);
  }
}

export async function getMonthData(company: string, monthLabel: string): Promise<MonthRecord | null> {
  // The cloud (Vercel Blob) copy is the single source of truth so that every
  // visitor to the site sees the same data. IndexedDB is only a same-device
  // cache used when the network is unavailable -- it must never be allowed
  // to shadow a fresher edit made by someone else on another device, so we
  // no longer compare timestamps and pick "whichever is newer".
  // 1. Try to fetch from Vercel serverless cloud database first
  try {
    const response = await fetch(
      `/api/db?company=${encodeURIComponent(company)}&month=${encodeURIComponent(monthLabel)}&t=${Date.now()}`,
    );
    if (response.ok) {
      const data = await response.json();
      if (data) {
        const record: MonthRecord = {
          id: recordId(company, monthLabel),
          company,
          monthLabel: data.monthLabel,
          days: data.days,
          employees: data.employees || [],
          updatedAt: data.updatedAt || new Date().toISOString(),
        };
        // Cache locally in IndexedDB
        await idbPutRecord(record);
        return record;
      }
    }
  } catch (error) {
    console.error("Error fetching from cloud database:", error);
  }

  // 2. Migration Check: If it is NKPL May 2026 and not found in cloud, check localStorage
  if (company === DEFAULT_COMPANY && monthLabel === "May 2026") {
    const localMayData = localStorage.getItem("salary-sheet-employees-may-2026-v2");
    if (localMayData) {
      try {
        const employees = JSON.parse(localMayData);
        if (Array.isArray(employees) && employees.length > 0) {
          const daysConfig = localStorage.getItem("salary-sheet-month-config");
          let days = 31;
          if (daysConfig) {
            const parsed = JSON.parse(daysConfig);
            if (parsed && typeof parsed.days === "number") {
              days = parsed.days;
            }
          }

          // Auto-save/migrate to cloud
          const record: MonthRecord = {
            id: recordId(company, "May 2026"),
            company,
            monthLabel: "May 2026",
            days,
            employees,
            updatedAt: new Date().toISOString(),
          };

          // Save to cloud asynchronously
          fetch("/api/db", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(record),
          }).catch(console.error);

          // Save to IndexedDB
          await idbPutRecord(record);

          return record;
        }
      } catch (err) {
        console.error("Local storage May migration failed:", err);
      }
    }
  }

  // 3. Fallback to local IndexedDB
  try {
    const db = await getDB();
    return new Promise<MonthRecord | null>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(recordId(company, monthLabel));

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("Failed to read from IndexedDB:", err);
  }

  return null;
}

export async function getAllMonthLabels(company: string): Promise<string[]> {
  try {
    const response = await fetch(`/api/db?company=${encodeURIComponent(company)}&t=${Date.now()}`);
    if (response.ok) {
      const months = await response.json();
      if (Array.isArray(months)) {
        // Ensure "May 2026" is always present if there is local localStorage data
        if (
          company === DEFAULT_COMPANY &&
          !months.includes("May 2026") &&
          localStorage.getItem("salary-sheet-employees-may-2026-v2")
        ) {
          months.push("May 2026");
        }
        return months;
      }
    }
  } catch (error) {
    console.error("Error listing months from cloud database:", error);
  }

  // Fallback to IndexedDB
  const db = await getDB();
  return new Promise<string[]>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index("company");
    const request = index.getAll(company);

    request.onsuccess = () => {
      const keys = (request.result || []).map((record: MonthRecord) => record.monthLabel);
      if (
        company === DEFAULT_COMPANY &&
        !keys.includes("May 2026") &&
        localStorage.getItem("salary-sheet-employees-may-2026-v2")
      ) {
        keys.push("May 2026");
      }
      resolve(keys);
    };
    request.onerror = () => reject(request.error);
  });
}

export interface EmployeeRate {
  id: string;
  name: string;
  salaryPerDay: number;
  bonusPerDay: number;
}

export type EmployeeRateMap = Record<string, EmployeeRate>;

const employeeRatesCacheKey = (company: string) => `salary-sheet-employee-rates-${company}-v1`;

// Employee per-day rates are the one thing that must stay identical for every
// visitor and consistent across every month, so they live in a single small
// cloud blob per company (see api/rates.ts) instead of being duplicated --
// and able to drift -- inside every month's record.
export async function getEmployeeRates(company: string): Promise<EmployeeRateMap> {
  try {
    const response = await fetch(`/api/rates?company=${encodeURIComponent(company)}&t=${Date.now()}`);
    if (response.ok) {
      const data = await response.json();
      if (data && typeof data === "object") {
        try {
          localStorage.setItem(employeeRatesCacheKey(company), JSON.stringify(data));
        } catch {
          // ignore storage failures
        }
        return data;
      }
    }
  } catch (error) {
    console.error("Error fetching employee rates:", error);
  }

  // Offline fallback: last-known rates cached on this device.
  try {
    const cached = localStorage.getItem(employeeRatesCacheKey(company));
    if (cached) {
      return JSON.parse(cached);
    }
  } catch {
    // ignore
  }
  return {};
}

export async function saveEmployeeRates(company: string, rates: EmployeeRateMap): Promise<void> {
  try {
    localStorage.setItem(employeeRatesCacheKey(company), JSON.stringify(rates));
  } catch {
    // ignore storage failures
  }

  try {
    const response = await fetch("/api/rates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company, rates }),
    });
    if (!response.ok) {
      console.error("Failed to save employee rates:", await response.text());
    }
  } catch (error) {
    console.error("Error saving employee rates:", error);
  }
}

