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

  it("deduplicates month labels from the remote store", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(["June 2026", "June 2026", "July 2026"]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(getAllMonthLabels("NKPL")).resolves.toEqual(["June 2026", "July 2026"]);
  });
});
