import { describe, expect, it } from "vitest";
import {
  canSaveForScope,
  canWriteForScope,
  initialLifecycleState,
  monthLifecycleReducer,
  type MonthLifecycleState,
} from "../monthLifecycle";

const SCOPE = { company: "NKPL", monthLabel: "June 2026" };

function loaded(): MonthLifecycleState {
  return monthLifecycleReducer(initialLifecycleState(SCOPE.monthLabel), {
    type: "LOAD_SUCCESS",
    ...SCOPE,
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
    expect(state.suppressNextSave).toBe(true);
    expect(state.lastMonthSignature).toBeNull();
    expect(state.lastRatesSignature).toBeNull();
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

  it("consumes the one post-load suppression without entering saving", () => {
    const state = requestMonth(loaded());

    expect(state.status).toBe("loaded");
    expect(state.suppressNextSave).toBe(false);
    expect(state.pendingWrite).toBeNull();
  });

  it("accepts a changed month payload after suppression is consumed", () => {
    const state = requestMonth(requestMonth(loaded(), "month-0"), "month-1");

    expect(state.status).toBe("saving");
    expect(state.pendingWrite).toEqual({
      kind: "month",
      company: SCOPE.company,
      monthLabel: SCOPE.monthLabel,
      signature: "month-1",
    });
  });

  it("rejects a month payload whose signature was already written", () => {
    let state = requestMonth(requestMonth(loaded(), "month-0"), "month-1");
    state = monthLifecycleReducer(state, { type: "SAVE_SUCCESS" });
    const before = state;

    expect(requestMonth(state, "month-1")).toEqual(before);
  });

  it("uses the same signature gate for the Rate Card", () => {
    let state = requestRates(requestMonth(requestMonth(loaded(), "month-0"), "month-1"), "rates-1");
    state = monthLifecycleReducer(state, { type: "SAVE_SUCCESS" });
    state = requestRates(state, "rates-2");
    expect(state.pendingWrite?.kind).toBe("rates");
    state = monthLifecycleReducer(state, { type: "SAVE_SUCCESS" });
    expect(requestRates(state, "rates-2")).toEqual(state);
  });

  it("rejects a scope mismatch before any signature check", () => {
    let state = requestMonth(requestMonth(loaded(), "month-0"), "month-1");
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
    let state = requestMonth(requestMonth(loaded(), "month-0"), "month-1");
    state = monthLifecycleReducer(state, { type: "SAVE_ERROR", error: "offline" });
    expect(state.status).toBe("error");
    expect(state.lastMonthSignature).toBeNull();
    expect(state.pendingWrite).toBeNull();

    state = monthLifecycleReducer(state, { type: "RETRY" });
    expect(state.status).toBe("dirty");
    expect(state.saveError).toBeNull();
    expect(state.retryToken).toBe(1);
    expect(requestMonth(state, "month-1").status).toBe("saving");
  });

  it("drops a write failure that outlived its scope", () => {
    let state = requestMonth(requestMonth(loaded(), "month-0"), "month-1");
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
