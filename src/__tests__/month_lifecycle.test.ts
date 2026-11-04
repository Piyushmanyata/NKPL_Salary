import { describe, expect, it } from "vitest";
import {
  canSaveForScope,
  canWriteForScope,
  initialLifecycleState,
  monthLifecycleReducer,
  ratesSaveDelay,
  type MonthLifecycleState,
} from "../monthLifecycle";

const SCOPE = { company: "NKPL", monthLabel: "June 2026" };

function loaded(): MonthLifecycleState {
  return monthLifecycleReducer(initialLifecycleState(SCOPE.monthLabel), {
    type: "LOAD_SUCCESS",
    ...SCOPE,
    monthSignature: "month-0",
    ratesSignature: "rates-0",
  });
}

function requestMonth(
  state: MonthLifecycleState,
  signature = "month-1",
): MonthLifecycleState {
  return monthLifecycleReducer(state, {
    type: "SAVE_REQUEST",
    ...SCOPE,
    signature,
  });
}

function requestRates(
  state: MonthLifecycleState,
  signature = "rates-1",
): MonthLifecycleState {
  return monthLifecycleReducer(state, {
    type: "RATES_SAVE_REQUEST",
    ...SCOPE,
    signature,
  });
}

describe("monthLifecycleReducer write gate", () => {
  it("starts loading with no writable scope", () => {
    const state = initialLifecycleState(SCOPE.monthLabel);

    expect(state.status).toBe("loading");
    expect(state.loadedScope).toBeNull();
    expect(canSaveForScope(state, SCOPE.company, SCOPE.monthLabel)).toBe(false);
    expect(canWriteForScope(state, "month", SCOPE, "month-1")).toBe(false);
  });

  it("loads a scope without carrying a second roster or month-list state", () => {
    const state = loaded();

    expect(state.status).toBe("loaded");
    expect(state.loadedScope).toEqual(SCOPE);
    expect(state.awaitingChoice).toBe(false);
    expect(state.lastMonthSignature).toBe("month-0");
    expect(state.lastRatesSignature).toBe("rates-0");
  });

  it("refuses writes while a no-data choice is open", () => {
    const state = monthLifecycleReducer(initialLifecycleState(SCOPE.monthLabel), {
      type: "LOAD_EMPTY",
      ...SCOPE,
    });

    expect(state.awaitingChoice).toBe(true);
    expect(state.loadedScope).toBeNull();
    expect(requestMonth(state)).toEqual(state);
  });

  it("does not write the loaded payload back", () => {
    const state = loaded();

    expect(requestMonth(state, "month-0")).toEqual(state);
    expect(requestRates(state, "rates-0")).toEqual(state);
  });

  it("writes a Rate Card edit that lands before the first debounced save after a load", () => {
    expect(requestRates(loaded(), "rates-1").pendingWrite?.signature).toBe("rates-1");
  });

  it("writes an edit that lands before the first debounced save after a load", () => {
    const state = requestMonth(loaded(), "month-1");

    expect(state.status).toBe("saving");
    expect(state.pendingWrite).toEqual({
      kind: "month",
      company: SCOPE.company,
      monthLabel: SCOPE.monthLabel,
      signature: "month-1",
      baseVersion: 0,
    });
  });

  it("rejects a month payload whose signature was already written", () => {
    let state = requestMonth(loaded(), "month-1");
    state = monthLifecycleReducer(state, { type: "SAVE_SUCCESS" });
    const before = state;

    expect(requestMonth(state, "month-1")).toEqual(before);
  });

  it("uses the same signature gate for the Rate Card", () => {
    let state = requestRates(requestMonth(loaded(), "month-1"), "rates-1");
    state = monthLifecycleReducer(state, { type: "SAVE_SUCCESS" });
    state = requestRates(state, "rates-2");
    expect(state.pendingWrite?.kind).toBe("rates");
    state = monthLifecycleReducer(state, { type: "SAVE_SUCCESS" });
    expect(requestRates(state, "rates-2")).toEqual(state);
  });

  it("ignores a late success from a write that is no longer the pending one", () => {
    const state = requestMonth(loaded(), "month-1");

    expect(
      monthLifecycleReducer(state, { type: "SAVE_SUCCESS", kind: "rates", signature: "rates-A" }),
    ).toEqual(state);
  });

  it("rejects a scope mismatch before any signature check", () => {
    let state = requestMonth(loaded(), "month-1");
    const before = state;

    state = monthLifecycleReducer(state, {
      type: "SAVE_REQUEST",
      company: "APTUS",
      monthLabel: SCOPE.monthLabel,
      signature: "new-payload",
    });

    expect(state).toEqual(before);
    expect(canWriteForScope(state, "month", {
      company: "APTUS",
      monthLabel: SCOPE.monthLabel,
    }, "new-payload")).toBe(false);
  });

  it("reports a failed write without recording its signature, then retries", () => {
    let state = requestMonth(loaded(), "month-1");
    state = monthLifecycleReducer(state, { type: "SAVE_ERROR", error: "offline" });
    expect(state.status).toBe("error");
    expect(state.lastMonthSignature).toBe("month-0");
    expect(state.pendingWrite).toBeNull();

    state = monthLifecycleReducer(state, { type: "RETRY" });
    expect(state.status).toBe("dirty");
    expect(state.saveError).toBeNull();
    expect(state.retryToken).toBe(1);
    expect(requestMonth(state, "month-1").status).toBe("saving");
  });

  it("drops a write failure that outlived its scope", () => {
    let state = requestMonth(loaded(), "month-1");
    expect(state.status).toBe("saving");

    state = monthLifecycleReducer(state, {
      type: "SELECT_SCOPE",
      company: "APTUS",
      monthLabel: SCOPE.monthLabel,
    });
    const before = state;

    expect(
      monthLifecycleReducer(state, { type: "SAVE_ERROR", error: "offline" }),
    ).toEqual(before);
  });

  it("blocks writes after a load error and lets retry return to loading", () => {
    let state = monthLifecycleReducer(initialLifecycleState(SCOPE.monthLabel), {
      type: "LOAD_ERROR",
      error: "datastore unavailable",
    });
    expect(state.status).toBe("error");
    expect(state.loadedScope).toBeNull();
    expect(requestMonth(state)).toEqual(state);

    state = monthLifecycleReducer(state, { type: "RETRY" });
    expect(state.status).toBe("loading");
    expect(state.retryToken).toBe(1);
  });

  it("clears the loaded scope before a company switch can write", () => {
    const state = monthLifecycleReducer(loaded(), {
      type: "SELECT_SCOPE",
      company: "APTUS",
      monthLabel: "July 2026",
    });

    expect(state.status).toBe("loading");
    expect(state.loadedScope).toBeNull();
    expect(state.pendingWrite).toBeNull();
    expect(canWriteForScope(state, "month", {
      company: "APTUS",
      monthLabel: "July 2026",
    }, "month-1")).toBe(false);
  });
});

describe("monthLifecycleReducer server version", () => {
  const loadedAt = (version: number) =>
    monthLifecycleReducer(initialLifecycleState(SCOPE.monthLabel), {
      type: "LOAD_SUCCESS",
      ...SCOPE,
      monthSignature: "month-0",
      ratesSignature: "rates-0",
      version,
    });

  it("sends the loaded version with a month write and moves to the saved one", () => {
    let state = requestMonth(loadedAt(7));
    expect(state.pendingWrite?.baseVersion).toBe(7);

    state = monthLifecycleReducer(state, { type: "SAVE_SUCCESS", kind: "month", signature: "month-1", version: 8 });
    expect(state.version).toBe(8);
    expect(requestMonth(state, "month-2").pendingWrite?.baseVersion).toBe(8);
  });

  it("treats a month that was never saved as version 0", () => {
    expect(requestMonth(loaded()).pendingWrite?.baseVersion).toBe(0);
  });

  it("blocks every write after an out-of-date save until a reload", () => {
    let state = monthLifecycleReducer(requestMonth(loadedAt(3)), {
      type: "SAVE_ERROR",
      error: "Newer data was saved",
      stale: true,
    });
    expect(state.stale).toBe(true);
    expect(state.status).toBe("error");
    expect(requestMonth(state, "month-2").pendingWrite).toBeNull();
    expect(requestRates(state).pendingWrite).toBeNull();

    state = monthLifecycleReducer(state, { type: "SELECT_SCOPE", ...SCOPE });
    expect(state.stale).toBe(false);
  });

  it("marks the tab out of date when the server holds a newer version", () => {
    const state = monthLifecycleReducer(loadedAt(3), {
      type: "NEWER_ON_SERVER",
      ...SCOPE,
      version: 4,
      error: "Newer data was saved",
    });
    expect(state.stale).toBe(true);
    expect(state.saveError).toBe("Newer data was saved");
    expect(requestMonth(state).pendingWrite).toBeNull();
  });

  it("ignores a server check that is not newer, is for another month, or races a save", () => {
    const check = { type: "NEWER_ON_SERVER" as const, ...SCOPE, version: 3, error: "x" };
    expect(monthLifecycleReducer(loadedAt(3), check).stale).toBe(false);
    expect(monthLifecycleReducer(loadedAt(3), { ...check, monthLabel: "July 2026", version: 9 }).stale).toBe(false);
    expect(monthLifecycleReducer(requestMonth(loadedAt(3)), { ...check, version: 4 }).stale).toBe(false);
  });
});

describe("ratesSaveDelay", () => {
  function monthSaved(signature = "month-1"): MonthLifecycleState {
    return monthLifecycleReducer(requestMonth(loaded(), signature), {
      type: "SAVE_SUCCESS",
      kind: "month",
      signature,
    });
  }

  it("sends the Rate Card straight after the month write for the same roster", () => {
    expect(ratesSaveDelay(monthSaved(), "month-1")).toBe(0);
  });

  it("debounces while the roster has changed since the month write", () => {
    expect(ratesSaveDelay(monthSaved(), "month-2")).toBe(2000);
  });

  it("debounces after a load, before anything was written", () => {
    const state = monthLifecycleReducer(initialLifecycleState(SCOPE.monthLabel), {
      type: "LOAD_SUCCESS",
      ...SCOPE,
      monthSignature: "month-1",
      ratesSignature: "rates-0",
    });

    expect(ratesSaveDelay(state, "month-1")).toBe(2000);
  });
});
