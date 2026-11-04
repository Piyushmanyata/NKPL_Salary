import Redis from "ioredis";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import handler from "../../api/db";
import { CHECKPOINT_WINDOW_MS, HISTORY_KEEP, readHistory, saveMonth } from "../../api/_lib/monthStore";

const url = process.env.TEST_REDIS_URL;

type Reply = { code: number; body: any };

async function call(method: string, query: Record<string, string>, body?: unknown): Promise<Reply> {
  const reply: Reply = { code: 0, body: null };
  const res = {
    status(code: number) {
      reply.code = code;
      return res;
    },
    json(value: unknown) {
      reply.body = value;
      return res;
    },
    setHeader() {},
  };
  await handler({ method, query, body, headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0" } }, res);
  return reply;
}

const post = (body: Record<string, unknown>) =>
  call("POST", {}, { company: "APTUS", monthLabel: "October 2026", days: 31, ...body });

describe.skipIf(!url)("month store against a real Redis", () => {
  const redis = new Redis(url ?? "");

  beforeEach(async () => {
    process.env.REDIS_URL = url;
    await redis.flushdb();
  });

  afterAll(async () => {
    await redis.quit();
  });

  it("refuses a save from a tab that loaded an older version", async () => {
    expect((await post({ employees: [{ id: "a", daysWorked: 25 }], baseVersion: 0, tabId: "A" })).code).toBe(200);
    const fresh = await post({ employees: [{ id: "a", daysWorked: 24 }], baseVersion: 1, tabId: "B" });
    expect(fresh.body.version).toBe(2);

    const stale = await post({ employees: [{ id: "a", daysWorked: 31 }], baseVersion: 1, tabId: "A" });
    expect(stale.code).toBe(409);
    expect(stale.body.current).toMatchObject({ version: 2, device: "Windows PC · Chrome" });

    const now = await call("GET", { company: "APTUS", month: "October 2026" });
    expect(now.body.employees).toEqual([{ id: "a", daysWorked: 24 }]);
  });

  it("refuses a save that carries no version, as an app tab opened before this change would", async () => {
    await post({ employees: [], baseVersion: 0, tabId: "A" });
    const old = await post({ employees: [{ id: "x" }] });
    expect(old.code).toBe(409);
    expect((await call("GET", { company: "APTUS", month: "October 2026" })).body.employees).toEqual([]);
  });

  it("reads a month saved before versions existed as version 1 and accepts a save on it", async () => {
    await redis.set("monthly_salary/APTUS/October 2026", JSON.stringify({ monthLabel: "October 2026", employees: [] }));
    expect((await call("GET", { company: "APTUS", month: "October 2026" })).body.version).toBe(1);
    expect((await post({ employees: [], baseVersion: 0, tabId: "A" })).code).toBe(409);
    expect((await post({ employees: [{ id: "a" }], baseVersion: 1, tabId: "A" })).body.version).toBe(2);
    const history = await call("GET", { company: "APTUS", month: "October 2026", history: "1" });
    expect(history.body).toEqual([{ monthLabel: "October 2026", employees: [], version: 1 }]);
  });

  it("keeps the replaced copy when another tab saves, newest first", async () => {
    await post({ employees: [{ id: "a", daysWorked: 25 }], baseVersion: 0, tabId: "A" });
    await post({ employees: [{ id: "a", daysWorked: 24 }], baseVersion: 1, tabId: "B" });
    await post({ employees: [{ id: "a", daysWorked: 23 }], baseVersion: 2, tabId: "A" });
    const history = await readHistory(redis, "APTUS", "October 2026");
    expect(history.map((entry) => entry.version)).toEqual([2, 1]);
    expect(history[0].employees).toEqual([{ id: "a", daysWorked: 24 }]);
  });

  it("keeps one copy per 10 minutes while the same tab keeps typing, and always on a restore", async () => {
    const base = Date.parse("2026-11-04T10:00:00Z");
    const save = (version: number, minutes: number, checkpoint = false) =>
      saveMonth(redis, {
        company: "NKPL",
        monthLabel: "October 2026",
        days: 31,
        employees: [{ id: "a", daysWorked: version }],
        baseVersion: version,
        tabId: "A",
        device: "Mac",
        checkpoint,
        now: new Date(base + minutes * 60_000),
      });
    await save(0, 0);
    await save(1, 1);
    await save(2, 2);
    await save(3, 3);
    expect((await readHistory(redis, "NKPL", "October 2026")).map((e) => e.version)).toEqual([1]);

    await save(4, 1 + CHECKPOINT_WINDOW_MS / 60_000);
    await save(5, 12, true);
    expect((await readHistory(redis, "NKPL", "October 2026")).map((e) => e.version)).toEqual([5, 4, 1]);
  });

  it(`keeps only the last ${HISTORY_KEEP} copies`, async () => {
    for (let version = 0; version < HISTORY_KEEP + 5; version += 1) {
      await post({ employees: [], baseVersion: version, tabId: `tab-${version}` });
    }
    const history = await readHistory(redis, "APTUS", "October 2026");
    expect(history).toHaveLength(HISTORY_KEEP);
    expect(history[0].version).toBe(HISTORY_KEEP + 4);
  });

  it("no longer deletes months", async () => {
    await post({ employees: [], baseVersion: 0, tabId: "A" });
    expect((await call("DELETE", { company: "APTUS", month: "October 2026" })).code).toBe(405);
  });
});
