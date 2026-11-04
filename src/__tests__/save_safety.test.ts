import { afterEach, describe, expect, it, vi } from "vitest";
import { friendlyError, getMonthData, saveMonthData, takeDraft, writeDraft } from "../db";
import {
  hasUnsavedChanges,
  initialLifecycleState,
  monthLifecycleReducer,
  retryDelay,
  saveStatus,
} from "../monthLifecycle";

function stubStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
  return store;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("error words", () => {
  it("names a timeout and a dropped connection in plain words", () => {
    expect(friendlyError(new DOMException("t", "TimeoutError"))).toBe("The server did not answer in 15 seconds.");
    expect(friendlyError(new TypeError("Failed to fetch"))).toBe(
      "Could not reach the server. Check the internet connection.",
    );
  });

  it("shows the server's message, not its JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Connection is closed." }), { status: 500 }),
    );
    await expect(saveMonthData("NKPL", "October 2026", 31, [], 3)).resolves.toEqual({
      ok: false,
      error: "Connection is closed.",
    });
  });

  it("gives every call a time limit", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("[]"));
    await getMonthData("NKPL", "October 2026");
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("offline copy", () => {
  it("marks a month read from this browser because the server did not answer", async () => {
    stubStorage();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ employees: [], version: 4 }), { status: 200 }),
    );
    await getMonthData("NKPL", "October 2026");
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(getMonthData("NKPL", "October 2026")).resolves.toMatchObject({
      kind: "found",
      fromCache: true,
      record: { version: 4 },
    });
  });
});

describe("unsaved edits kept in the browser", () => {
  const draft = { baseVersion: 7, employees: [{ id: "e1", name: "Ada" }], editedAt: "2026-11-04T10:00:00.000Z" } as never;

  it("puts a draft back only when nothing was saved after it", () => {
    stubStorage();
    writeDraft("NKPL", "October 2026", draft);
    expect(takeDraft("NKPL", "October 2026", 7)).toMatchObject({ current: true });
    expect(takeDraft("NKPL", "October 2026", 7)).toBeNull();
  });

  it("drops a draft that newer saves have passed", () => {
    stubStorage();
    writeDraft("NKPL", "October 2026", draft);
    expect(takeDraft("NKPL", "October 2026", 8)).toMatchObject({ current: false });
  });
});

describe("save status and retries", () => {
  const loaded = monthLifecycleReducer(initialLifecycleState("October 2026"), {
    type: "LOAD_SUCCESS",
    company: "NKPL",
    monthLabel: "October 2026",
    monthSignature: "m1",
    ratesSignature: "r1",
    version: 3,
  });

  it("waits longer after each failed try, up to 30 s", () => {
    expect([0, 1, 2, 3, 9].map(retryDelay)).toEqual([2000, 5000, 15000, 30000, 30000]);
  });

  const october = { company: "NKPL", monthLabel: "October 2026" };

  it("counts an edit as unsaved until its signature is written", () => {
    expect(hasUnsavedChanges(loaded, october, "m1", "r1")).toBe(false);
    expect(hasUnsavedChanges(loaded, october, "m2", "r1")).toBe(true);
    expect(hasUnsavedChanges(loaded, october, "m1", "r2")).toBe(true);
  });

  it("has nothing unsaved while switching to another month", () => {
    expect(hasUnsavedChanges(loaded, { company: "NKPL", monthLabel: "November 2026" }, "m2", "r1")).toBe(false);
  });

  it("never counts edits in an out-of-date tab, which cannot save them", () => {
    const stale = monthLifecycleReducer(loaded, {
      type: "NEWER_ON_SERVER",
      company: "NKPL",
      monthLabel: "October 2026",
      version: 4,
      error: "newer",
    });
    expect(hasUnsavedChanges(stale, october, "m2", "r1")).toBe(false);
    expect(saveStatus(stale, false, false, null)).toEqual({ kind: "stale" });
  });

  it("shows Saving while an edit waits, Not saved after a failure, Saved when clean", () => {
    expect(saveStatus(loaded, true, false, null)).toEqual({ kind: "saving" });
    expect(saveStatus(loaded, false, false, "2026-11-04T10:00:00Z")).toEqual({
      kind: "saved",
      at: "2026-11-04T10:00:00Z",
    });
    expect(saveStatus(loaded, false, true, null)).toEqual({ kind: "offline" });
    const pending = monthLifecycleReducer(loaded, {
      type: "SAVE_REQUEST",
      company: "NKPL",
      monthLabel: "October 2026",
      signature: "m2",
    });
    const failed = monthLifecycleReducer(pending, { type: "SAVE_ERROR", error: "down", kind: "month", signature: "m2" });
    expect(saveStatus(failed, true, false, null)).toEqual({ kind: "retrying" });
  });
});
