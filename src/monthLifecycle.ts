export type LifecycleStatus =
  | "loading"
  | "loaded"
  | "dirty"
  | "saving"
  | "saved"
  | "error";

export type Scope = { company: string; monthLabel: string };
export type WriteKind = "month" | "rates";

export type PendingWrite = Scope & {
  kind: WriteKind;
  signature: string;
};

export type MonthLifecycleState = {
  status: LifecycleStatus;
  /** What the live roster belongs to. Saves must target this, never a different selection. */
  loadedScope: Scope | null;
  /** A no-data modal is open; no write is legal until the user makes a choice. */
  awaitingChoice: boolean;
  /** The first save intent after hydration is consumed without writing. */
  suppressNextSave: boolean;
  /** Identity of the last month payload successfully written. */
  lastMonthSignature: string | null;
  /** Identity of the last shared Rate Card successfully written. */
  lastRatesSignature: string | null;
  saveError: string | null;
  retryToken: number;
  pendingWrite: PendingWrite | null;
};

export type MonthLifecycleAction =
  | { type: "SELECT_SCOPE"; company: string; monthLabel: string }
  | {
      type: "LOAD_SUCCESS";
      company: string;
      monthLabel: string;
      monthSignature?: string;
      ratesSignature?: string;
      suppressNextSave?: boolean;
    }
  | { type: "LOAD_EMPTY"; company: string; monthLabel: string }
  | { type: "CANCEL_CHOICE" }
  | { type: "LOAD_ERROR"; error: string }
  | { type: "SAVE_REQUEST"; company: string; monthLabel: string; signature: string }
  | { type: "RATES_SAVE_REQUEST"; company: string; monthLabel: string; signature: string }
  | { type: "SAVE_SUCCESS"; kind?: WriteKind; signature?: string }
  | { type: "SAVE_ERROR"; error: string }
  | { type: "RETRY" };

export function initialLifecycleState(_monthLabel: string): MonthLifecycleState {
  return {
    status: "loading",
    loadedScope: null,
    awaitingChoice: false,
    suppressNextSave: false,
    lastMonthSignature: null,
    lastRatesSignature: null,
    saveError: null,
    retryToken: 0,
    pendingWrite: null,
  };
}

function scopesEqual(a: Scope | null, b: Scope): boolean {
  return Boolean(a && a.company === b.company && a.monthLabel === b.monthLabel);
}

function canStartWrite(state: MonthLifecycleState, scope: Scope): boolean {
  return Boolean(
    scopesEqual(state.loadedScope, scope) &&
      state.status !== "loading" &&
      state.status !== "saving" &&
      state.status !== "error" &&
      !state.awaitingChoice &&
      !state.suppressNextSave &&
      !state.pendingWrite,
  );
}

function lastSignatureFor(state: MonthLifecycleState, kind: WriteKind): string | null {
  return kind === "month" ? state.lastMonthSignature : state.lastRatesSignature;
}

function requestWrite(
  state: MonthLifecycleState,
  kind: WriteKind,
  scope: Scope,
  signature: string,
): MonthLifecycleState {
  if (!scopesEqual(state.loadedScope, scope)) return state;
  if (
    state.status === "loading" ||
    state.status === "saving" ||
    state.status === "error" ||
    state.awaitingChoice ||
    state.pendingWrite
  ) {
    return state;
  }

  if (state.suppressNextSave) {
    return { ...state, suppressNextSave: false };
  }

  if (lastSignatureFor(state, kind) === signature) return state;

  return {
    ...state,
    status: "saving",
    saveError: null,
    pendingWrite: { kind, ...scope, signature },
  };
}

/**
 * Pure month lifecycle reducer.
 *
 * The Scope Guard and every write gate live here. Effects may dispatch intents
 * and perform the pending I/O, but they cannot bypass this state machine.
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
        loadedScope: null,
        awaitingChoice: false,
        suppressNextSave: true,
        lastMonthSignature: null,
        lastRatesSignature: null,
        saveError: null,
        pendingWrite: null,
      };

    case "LOAD_SUCCESS":
      return {
        ...state,
        status: "loaded",
        loadedScope: { company: action.company, monthLabel: action.monthLabel },
        awaitingChoice: false,
        suppressNextSave: action.suppressNextSave ?? true,
        lastMonthSignature: action.monthSignature ?? null,
        lastRatesSignature: action.ratesSignature ?? null,
        saveError: null,
        pendingWrite: null,
      };

    case "LOAD_EMPTY":
      return {
        ...state,
        status: "loaded",
        loadedScope: null,
        awaitingChoice: true,
        suppressNextSave: true,
        lastMonthSignature: null,
        lastRatesSignature: null,
        saveError: null,
        pendingWrite: null,
      };

    case "LOAD_ERROR":
      return {
        ...state,
        status: "error",
        loadedScope: null,
        awaitingChoice: false,
        suppressNextSave: false,
        pendingWrite: null,
        saveError: action.error,
      };

    case "CANCEL_CHOICE":
      return {
        ...state,
        awaitingChoice: false,
        suppressNextSave: false,
      };

    case "SAVE_REQUEST":
      return requestWrite(
        state,
        "month",
        { company: action.company, monthLabel: action.monthLabel },
        action.signature,
      );

    case "RATES_SAVE_REQUEST":
      return requestWrite(
        state,
        "rates",
        { company: action.company, monthLabel: action.monthLabel },
        action.signature,
      );

    case "SAVE_SUCCESS": {
      if (!state.pendingWrite) return state;
      const kind = action.kind ?? state.pendingWrite.kind;
      const signature = action.signature ?? state.pendingWrite.signature;
      return {
        ...state,
        status: "saved",
        saveError: null,
        pendingWrite: null,
        ...(kind === "month"
          ? { lastMonthSignature: signature }
          : { lastRatesSignature: signature }),
      };
    }

    case "SAVE_ERROR":
      return {
        ...state,
        status: "error",
        saveError: action.error,
        pendingWrite: null,
      };

    case "RETRY":
      return {
        ...state,
        status: state.loadedScope ? "dirty" : "loading",
        suppressNextSave: false,
        saveError: null,
        pendingWrite: null,
        retryToken: state.retryToken + 1,
      };

    default:
      return state;
  }
}

/** True when a loaded scope is eligible for a write before signature checks. */
export function canSaveForScope(
  state: MonthLifecycleState,
  company: string,
  monthLabel: string,
): boolean {
  return canStartWrite(state, { company, monthLabel });
}

/** True when this scope and payload signature would be accepted by the reducer. */
export function canWriteForScope(
  state: MonthLifecycleState,
  kind: WriteKind,
  scope: Scope,
  signature: string,
): boolean {
  return canStartWrite(state, scope) && lastSignatureFor(state, kind) !== signature;
}
