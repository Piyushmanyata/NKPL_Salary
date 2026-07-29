import { EmployeeInput } from "./types";

export interface MonthRecord {
  id: string;
  company: string;
  monthLabel: string;
  days: number;
  employees: EmployeeInput[];
  updatedAt: string;
}

const STORE_KEY_PREFIX = "NKPL_Salary_cache::";

function recordId(company: string, monthLabel: string) {
  return `${company}::${monthLabel}`;
}

function recordKey(company: string, monthLabel: string) {
  return `${STORE_KEY_PREFIX}${company}::${monthLabel}`;
}

// Write (upsert) a month record into the local localStorage cache.
function localPutRecord(record: MonthRecord): void {
  try {
    localStorage.setItem(recordKey(record.company, record.monthLabel), JSON.stringify(record));
  } catch (err) {
    console.error("Failed to save to local storage cache:", err);
  }
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

  // 1. Save to local cache
  localPutRecord(record);

  // 2. Sync to cloud database via serverless API
  try {
    const response = await fetch("/api/db", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(record),
    });

    if (!response.ok) {
      console.error("Cloud database sync failed:", await response.text());
    }
  } catch (error) {
    console.error("Error syncing to cloud database:", error);
  }
}

export async function getMonthData(company: string, monthLabel: string): Promise<MonthRecord | null> {
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
        // Cache locally
        localPutRecord(record);
        return record;
      }
    }
  } catch (error) {
    console.error("Error fetching from cloud database:", error);
  }

  // 2. Fallback to local storage cache
  try {
    const cached = localStorage.getItem(recordKey(company, monthLabel));
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (err) {
    console.error("Failed to read from local storage cache:", err);
  }

  return null;
}

export async function getAllMonthLabels(company: string): Promise<string[]> {
  try {
    const response = await fetch(`/api/db?company=${encodeURIComponent(company)}&t=${Date.now()}`);
    if (response.ok) {
      const months = await response.json();
      if (Array.isArray(months)) {
        return months;
      }
    }
  } catch (error) {
    console.error("Error listing months from cloud database:", error);
  }

  // Fallback to local storage cache keys
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORE_KEY_PREFIX)) {
        const parts = key.slice(STORE_KEY_PREFIX.length).split("::");
        if (parts.length === 2 && parts[0] === company) {
          keys.push(parts[1]);
        }
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
  /**
   * Standing package for the fixed-monthly categories, the way salaryPerDay is
   * the standing rate for Unskilled. Optional so pre-existing blobs still load.
   */
  monthlySalary?: number;
  totalSalary?: number;
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


