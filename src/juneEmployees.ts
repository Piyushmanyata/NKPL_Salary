import type { EmployeeInput } from "./types";
import seed from "./data/nkpl-seed-roster.json";

// NKPL June 2026 payroll roster (data file, not application logic).
// Lazy-imported from App so it stays out of the initial bundle.
export const juneEmployees = seed as EmployeeInput[];
