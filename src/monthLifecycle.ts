import type { EmployeeInput } from "./types";

export type LifecycleStatus =
  | "loading"
  | "loaded"
  | "dirty"
  | "saving"
  | "saved"
  | "error";

export type Scope = { company: string; monthLabel: string };

export type MonthLifecycleState = {
  status: LifecycleStatus;
  /** What `roster` actually belongs to. Saves must target this, never a different selection. */
  loadedScope: Scope | null;
  roster: EmployeeInput[];
  /** Currently selected month label (may differ from loadedScope during a switch). */
  monthLabel: string;
  allMonths: string[];
  saveError: string | null;
  retryToken: number;
};

export type MonthLifecycleAction =
  | { type: "SELECT_SCOPE"; company: string; monthLabel: string }
  | {
      type: "LOAD_SUCCESS";
      company: string;
      monthLabel: string;
      roster: EmployeeInput[];
      allMonths?: string[];
    }
  | {
      type: "LOAD_EMPTY";
      company: string;
      monthLabel: string;
      allMonths: string[];
    }
  | { type: "LOAD_ERROR"; error: string }
  | { type: "EDIT_ROSTER"; roster: EmployeeInput[] }
  | { type: "SAVE_REQUEST"; company: string; monthLabel: string }
  | { type: "SAVE_SUCCESS" }
  | { type: "SAVE_ERROR"; error: string }
  | { type: "RETRY" }
  | { type: "SET_ALL_MONTHS"; allMonths: string[] }
  | { type: "REMEMBER_MONTH"; monthLabel: string }
  | { type: "SET_MONTH_LABEL"; monthLabel: string };

export function initialLifecycleState(monthLabel: string): MonthLifecycleState {
  return {
    status: "loading",
    loadedScope: null,
    roster: [],
    monthLabel,
    allMonths: [],
    saveError: null,
    retryToken: 0,
  };
}

function scopesEqual(a: Scope | null, b: Scope): boolean {
  return Boolean(a && a.company === b.company && a.monthLabel === b.monthLabel);
}

/**
 * Pure month lifecycle reducer.
 * Scope Guard: a SAVE_REQUEST whose company/month is not loadedScope is rejected
 * (status stays; no transition to saving). That makes cross-Company writes
 * structurally impossible rather than comment-enforced.
 */
export function monthLifecycleReducer(
  state: MonthLifecycleState,
  action: MonthLifecycleAction,
): MonthLifecycleState {
  switch (action.type) {
    case "SELECT_SCOPE":
      return {
        ...state,
        status: "loading",
        // Clear loaded scope immediately so no save can fire for the previous roster
        // under the newly selected company/month.
        loadedScope: null,
        monthLabel: action.monthLabel,
        saveError: null,
      };

    case "LOAD_SUCCESS":
      return {
        ...state,
        status: "loaded",
        loadedScope: { company: action.company, monthLabel: action.monthLabel },
        roster: action.roster,
        monthLabel: action.monthLabel,
        allMonths: action.allMonths ?? state.allMonths,
        saveError: null,
      };

    case "LOAD_EMPTY":
      return {
        ...state,
        status: "loaded",
        // Empty intentional scope still "belongs" so blank/sample create can save.
        loadedScope: { company: action.company, monthLabel: action.monthLabel },
        roster: [],
        monthLabel: action.monthLabel,
        allMonths: action.allMonths,
        saveError: null,
      };

    case "LOAD_ERROR":
      return {
        ...state,
        status: "error",
        loadedScope: null,
        saveError: action.error,
      };

    case "EDIT_ROSTER":
      if (!state.loadedScope) {
        // No scope loaded — ignore edits (stale UI during switch).
        return state;
      }
      return {
        ...state,
        status: state.status === "loading" ? state.status : "dirty",
        roster: action.roster,
      };

    case "SAVE_REQUEST": {
      const requested: Scope = {
        company: action.company,
        monthLabel: action.monthLabel,
      };
      // Scope Guard — the whole point of this reducer.
      if (!scopesEqual(state.loadedScope, requested)) {
        return state;
      }
      if (state.status !== "dirty" && state.status !== "error" && state.status !== "saved") {
        // Allow re-save from dirty/error; also from saved if caller re-requests.
        if (state.status !== "loaded") {
          // still allow saving loaded→saving if payload changed externally
        }
      }
      if (!state.loadedScope) return state;
      return {
        ...state,
        status: "saving",
        saveError: null,
      };
    }

    case "SAVE_SUCCESS":
      return {
        ...state,
        status: "saved",
        saveError: null,
      };

    case "SAVE_ERROR":
      return {
        ...state,
        status: "error",
        saveError: action.error,
      };

    case "RETRY":
      return {
        ...state,
        retryToken: state.retryToken + 1,
        saveError: null,
        status: state.loadedScope ? "dirty" : state.status,
      };

    case "SET_ALL_MONTHS":
      return { ...state, allMonths: action.allMonths };

    case "REMEMBER_MONTH":
      if (state.allMonths.includes(action.monthLabel)) return state;
      return {
        ...state,
        allMonths: [...state.allMonths, action.monthLabel],
      };

    case "SET_MONTH_LABEL":
      return { ...state, monthLabel: action.monthLabel };

    default:
      return state;
  }
}

/** True when a save may be emitted for this scope. */
export function canSaveForScope(
  state: MonthLifecycleState,
  company: string,
  monthLabel: string,
): boolean {
  return scopesEqual(state.loadedScope, { company, monthLabel });
}
