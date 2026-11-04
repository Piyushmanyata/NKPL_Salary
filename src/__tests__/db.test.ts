import { afterEach, describe, expect, it, vi } from "vitest";
import { getAllMonthLabels, getMonthData } from "../db";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("client month persistence results", () => {
  it("distinguishes a missing month from an unavailable datastore", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 404 }),
    );
    await expect(getMonthData("NKPL", "Missing 2026")).resolves.toEqual({ kind: "empty" });

    fetchMock.mockResolvedValueOnce(
      new Response("redis offline", { status: 503 }),
    );
    await expect(getMonthData("NKPL", "Unavailable 2026")).resolves.toEqual({
      kind: "unavailable",
      error: "redis offline",
    });
  });

  it("returns a normalized found record", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ employees: [{ id: "e1", name: "Ada" }], updatedAt: "today" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(getMonthData("NKPL", "June 2026")).resolves.toMatchObject({
      kind: "found",
      record: {
        id: "NKPL::June 2026",
        company: "NKPL",
        monthLabel: "June 2026",
        days: 0,
        employees: [{ id: "e1", name: "Ada" }],
        updatedAt: "today",
      },
    });
  });

  it("treats a month only in this browser's cache as never saved on the server", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ employees: [], version: 4 }), { status: 200 }),
    );
    await getMonthData("NKPL", "Cached 2026");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 404 }));
    const result = await getMonthData("NKPL", "Cached 2026");
    expect(result).toMatchObject({ kind: "found", record: { version: 0 } });
    vi.unstubAllGlobals();
  });

  it("deduplicates month labels from the remote store", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(["June 2026", "June 2026", "July 2026"]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(getAllMonthLabels("NKPL")).resolves.toEqual({
      kind: "found",
      labels: ["June 2026", "July 2026"],
    });
  });

  it("reports an unavailable month list when no local fallback exists", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("redis offline", { status: 503 }),
    );

    await expect(getAllMonthLabels("APTUS")).resolves.toEqual({
      kind: "unavailable",
      error: "redis offline",
    });
  });
});
