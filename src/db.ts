import { EmployeeInput } from "./types";

export interface MonthRecord {
  monthLabel: string;
  days: number;
  employees: EmployeeInput[];
  updatedAt: string;
}

const DB_NAME = "NKPL_Salary_DB";
const DB_VERSION = 1;
const STORE_NAME = "monthly_salary";

function getDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "monthLabel" });
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

export function saveCloudConfig(config: CloudConfig) {
  // Configured automatically on Vercel backend
}

export async function saveMonthData(monthLabel: string, days: number, employees: EmployeeInput[]): Promise<void> {
  const record: MonthRecord = {
    monthLabel,
    days,
    employees,
    updatedAt: new Date().toISOString(),
  };

  // 1. Save to local IndexedDB
  try {
    const db = await getDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
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

export async function getMonthData(monthLabel: string): Promise<MonthRecord | null> {
  // 1. Try to fetch from Vercel serverless cloud database first
  try {
    const response = await fetch(`/api/db?month=${encodeURIComponent(monthLabel)}`);
    if (response.ok) {
      const data = await response.json();
      if (data) {
        const record: MonthRecord = {
          monthLabel: data.monthLabel,
          days: data.days,
          employees: data.employees || [],
          updatedAt: data.updatedAt
        };
        // Cache locally in IndexedDB
        const db = await getDB();
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction(STORE_NAME, "readwrite");
          const store = transaction.objectStore(STORE_NAME);
          const request = store.put(record);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
        return record;
      }
    }
  } catch (error) {
    console.error("Error fetching from cloud database:", error);
  }

  // 2. Migration Check: If it is May 2026 and not found in cloud, check localStorage
  if (monthLabel === "May 2026") {
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
            monthLabel: "May 2026",
            days,
            employees,
            updatedAt: new Date().toISOString(),
          };

          // Save to cloud asynchronously
          fetch("/api/db", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(record)
          }).catch(console.error);

          // Save to IndexedDB
          const db = await getDB();
          await new Promise<void>((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, "readwrite");
            const store = transaction.objectStore(STORE_NAME);
            const request = store.put(record);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
          });

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
      const request = store.get(monthLabel);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("Failed to read from IndexedDB:", err);
  }
  
  return null;
}

export async function getAllMonthLabels(): Promise<string[]> {
  try {
    const response = await fetch("/api/db");
    if (response.ok) {
      const months = await response.json();
      if (Array.isArray(months)) {
        // Ensure "May 2026" is always present if there is local localStorage data
        if (!months.includes("May 2026") && localStorage.getItem("salary-sheet-employees-may-2026-v2")) {
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
    const request = store.getAllKeys();

    request.onsuccess = () => {
      const keys = (request.result || []) as string[];
      if (!keys.includes("May 2026") && localStorage.getItem("salary-sheet-employees-may-2026-v2")) {
        keys.push("May 2026");
      }
      resolve(keys);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function deleteMonthData(monthLabel: string): Promise<void> {
  try {
    await fetch(`/api/db?month=${encodeURIComponent(monthLabel)}`, {
      method: "DELETE",
    });
  } catch (error) {
    console.error("Error deleting from cloud database:", error);
  }

  // Local delete
  const db = await getDB();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(monthLabel);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
