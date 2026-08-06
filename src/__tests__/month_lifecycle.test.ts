import { describe, expect, it } from "vitest";
import {
  canSaveForScope,
  initialLifecycleState,
  monthLifecycleReducer,
  type MonthLifecycleState,
} from "../monthLifecycle";
import type { EmployeeInput } from "../types";

const emp = (id: string): EmployeeInput => ({
  id,
  name: id,
  category: "Skilled",
  monthlySalary: 10000,
  daysWorked: 30,
  extraDays: 0,
  otherDeduction: 0,
});

function loaded(): MonthLifecycleState {
  let s = initialLifecycleState("June 2026");
  s = monthLifecycleReducer(s, {
    type: "LOAD_SUCCESS",
    company: "NKPL",
    monthLabel: "June 2026",
    roster: [emp("a")],
  });
  return s;
}

describe("monthLifecycleReducer Scope Guard", () => {
  it("starts loading with null loadedScope", () => {
    const s = initialLifecycleState("June 2026");
    expect(s.status).toBe("loading");
    expect(s.loadedScope).toBeNull();
    expect(canSaveForScope(s, "NKPL", "June 2026")).toBe(false);
  });

  it("LOAD_SUCCESS sets loadedScope and roster", () => {
    const s = loaded();
    expect(s.status).toBe("loaded");
    expect(s.loadedScope).toEqual({ company: "NKPL", monthLabel: "June 2026" });
    expect(s.roster).toHaveLength(1);
    expect(canSaveForScope(s, "NKPL", "June 2026")).toBe(true);
  });

  it("SELECT_SCOPE clears loadedScope so no save can target the old roster", () => {
    let s = loaded();
    s = monthLifecycleReducer(s, {
      type: "SELECT_SCOPE",
      company: "APTUS",
      monthLabel: "July 2026",
    });
    expect(s.status).toBe("loading");
    expect(s.loadedScope).toBeNull();
    expect(canSaveForScope(s, "APTUS", "July 2026")).toBe(false);
    expect(canSaveForScope(s, "NKPL", "June 2026")).toBe(false);
  });

  it("SAVE_REQUEST for a different company is rejected (Scope Guard)", () => {
    let s = loaded();
    s = monthLifecycleReducer(s, { type: "EDIT_ROSTER", roster: [emp("a"), emp("b")] });
    expect(s.status).toBe("dirty");
    const before = s;
    s = monthLifecycleReducer(s, {
      type: "SAVE_REQUEST",
      company: "APTUS",
      monthLabel: "June 2026",
    });
    // Rejected: still dirty, never saving
    expect(s.status).toBe("dirty");
    expect(s).toEqual(before);
  });

  it("SAVE_REQUEST for a different month is rejected", () => {
    let s = loaded();
    s = monthLifecycleReducer(s, { type: "EDIT_ROSTER", roster: [emp("x")] });
    s = monthLifecycleReducer(s, {
      type: "SAVE_REQUEST",
      company: "NKPL",
      monthLabel: "July 2026",
    });
    expect(s.status).toBe("dirty");
  });

  it("SAVE_REQUEST for loadedScope transitions to saving", () => {
    let s = loaded();
    s = monthLifecycleReducer(s, { type: "EDIT_ROSTER", roster: [emp("a"), emp("b")] });
    s = monthLifecycleReducer(s, {
      type: "SAVE_REQUEST",
      company: "NKPL",
      monthLabel: "June 2026",
    });
    expect(s.status).toBe("saving");
  });

  it("SAVE_SUCCESS and SAVE_ERROR update status", () => {
    let s = loaded();
    s = monthLifecycleReducer(s, { type: "EDIT_ROSTER", roster: [emp("a")] });
    s = monthLifecycleReducer(s, {
      type: "SAVE_REQUEST",
      company: "NKPL",
      monthLabel: "June 2026",
    });
    s = monthLifecycleReducer(s, { type: "SAVE_SUCCESS" });
    expect(s.status).toBe("saved");
    s = monthLifecycleReducer(s, { type: "EDIT_ROSTER", roster: [emp("a"), emp("b")] });
    s = monthLifecycleReducer(s, {
      type: "SAVE_REQUEST",
      company: "NKPL",
      monthLabel: "June 2026",
    });
    s = monthLifecycleReducer(s, { type: "SAVE_ERROR", error: "boom" });
    expect(s.status).toBe("error");
    expect(s.saveError).toBe("boom");
  });

  it("RETRY bumps token and returns dirty when scope loaded", () => {
    let s = loaded();
    s = monthLifecycleReducer(s, { type: "SAVE_ERROR", error: "x" });
    s = monthLifecycleReducer(s, { type: "RETRY" });
    expect(s.retryToken).toBe(1);
    expect(s.status).toBe("dirty");
    expect(s.saveError).toBeNull();
  });

  it("EDIT_ROSTER ignored when no loadedScope", () => {
    let s = initialLifecycleState("June 2026");
    s = monthLifecycleReducer(s, { type: "EDIT_ROSTER", roster: [emp("z")] });
    expect(s.roster).toEqual([]);
  });

  it("company switch mid-edit cannot save old roster under new key", () => {
    // Reproduces the APTUS contamination scenario in reducer terms.
    let s = loaded();
    s = monthLifecycleReducer(s, {
      type: "EDIT_ROSTER",
      roster: Array.from({ length: 51 }, (_, i) => emp(`nkpl-${i}`)),
    });
    expect(s.roster).toHaveLength(51);
    s = monthLifecycleReducer(s, {
      type: "SELECT_SCOPE",
      company: "APTUS",
      monthLabel: "July 2026",
    });
    // Even if a stale effect fires SAVE_REQUEST for APTUS with the old roster:
    const rejected = monthLifecycleReducer(s, {
      type: "SAVE_REQUEST",
      company: "APTUS",
      monthLabel: "July 2026",
    });
    expect(rejected.status).toBe("loading");
    expect(canSaveForScope(rejected, "APTUS", "July 2026")).toBe(false);
    // And if somehow requested under old company after select — also blocked
    // because loadedScope is null.
    const rejected2 = monthLifecycleReducer(s, {
      type: "SAVE_REQUEST",
      company: "NKPL",
      monthLabel: "June 2026",
    });
    expect(rejected2.status).toBe("loading");
  });
});
