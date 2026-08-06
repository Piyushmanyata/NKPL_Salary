/**
 * One localStorage key-naming scheme.
 * Preference keys ship with a one-time read-old-if-new-missing shim (issue #26).
 */

const PREFIX = "nkpl:";

export const storageKeys = {
  activeCompany: `${PREFIX}activeCompany`,
  monthConfig: (company: string) => `${PREFIX}monthConfig:${company}`,
  companyLabel: (company: string) => `${PREFIX}companyLabel:${company}`,
  employeeRates: (company: string) => `${PREFIX}rates:${company}`,
  monthCache: (company: string, monthLabel: string) =>
    `${PREFIX}month:${company}::${monthLabel}`,
  monthCachePrefix: `${PREFIX}month:`,
} as const;

/** Keys used before the #26 rename — read when the new key is absent. */
export const legacyStorageKeys = {
  activeCompany: "salary-sheet-active-company",
  monthConfig: (company: string) => `salary-sheet-month-config-${company}`,
  /** Pre-multi-company month config (NKPL only). */
  monthConfigFlat: "salary-sheet-month-config",
  companyLabel: (company: string) => `salary-sheet-company-label-${company}`,
  employeeRates: (company: string) => `salary-sheet-employee-rates-${company}-v1`,
  monthCachePrefix: "NKPL_Salary_cache::",
  monthCache: (company: string, monthLabel: string) =>
    `NKPL_Salary_cache::${company}::${monthLabel}`,
} as const;

/** Read new key first; fall back to legacy keys and migrate when found. */
export function readStorage(newKey: string, ...legacyKeys: string[]): string | null {
  try {
    const current = localStorage.getItem(newKey);
    if (current !== null) return current;
    for (const key of legacyKeys) {
      const old = localStorage.getItem(key);
      if (old !== null) {
        try {
          localStorage.setItem(newKey, old);
        } catch {
          // ignore migrate write failures
        }
        return old;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}
