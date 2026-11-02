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
  /** Identity of the month payload as loaded or last written; a month write needs a different one. */
  lastMonthSignature: string | null;
  /** JSON of the Rate Card entries as loaded or last written, keeping employees since dropped from the roster; a rates write sends only what differs from it. */
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
      ratesSignature: string;
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
        lastMonthSignature: action.monthSignature ?? null,
        lastRatesSignature: action.ratesSignature,
        saveError: null,
        pendingWrite: null,
      };

    case "LOAD_EMPTY":
      return {
        ...state,
        status: "loaded",
        loadedScope: null,
        awaitingChoice: true,
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
        pendingWrite: null,
        saveError: action.error,
      };

    case "CANCEL_CHOICE":
      return {
        ...state,
        awaitingChoice: false,
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
      const pending = state.pendingWrite;
      if (!pending) return state;
      const { kind = pending.kind, signature = pending.signature } = action;
      if (kind !== pending.kind || signature !== pending.signature) return state;
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
      // A write that outlived its scope reports back after SELECT_SCOPE has
      // already cleared the pending write. Dropping it keeps a stale failure
      // from putting the freshly loaded scope into `error` and blocking it.
      if (!state.pendingWrite) return state;
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
        saveError: null,
        pendingWrite: null,
        retryToken: state.retryToken + 1,
      };

    default:
      return state;
  }
}

export const SAVE_DEBOUNCE_MS = 2000;

/** The Rate Card follows a finished month write at once, so a quick month switch cannot strand it. */
export function ratesSaveDelay(state: MonthLifecycleState, monthSignature: string): number {
  return state.status === "saved" && state.lastMonthSignature === monthSignature ? 0 : SAVE_DEBOUNCE_MS;
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
