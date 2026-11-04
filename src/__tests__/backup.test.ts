import Redis from "ioredis";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { BACKUP_EVERY_MS, backupIfDue, readSnapshot } from "../../api/_lib/backup";

const url = process.env.TEST_REDIS_URL;

type Call = { text: string; values: unknown[] };

function fakeStore(lastAt: string | null) {
  const calls: Call[] = [];
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("$").replace(/\s+/g, " ").trim();
    calls.push({ text, values });
    return text.startsWith("select max") ? [{ at: lastAt }] : [];
  }) as never;
  return { sql, calls };
}

describe.skipIf(!url)("salary backup against a real Redis", () => {
  const redis = new Redis(url ?? "", { db: 1 });

  beforeEach(async () => {
    await redis.flushdb();
    await redis.set("monthly_salary/NKPL/October 2026", JSON.stringify({ monthLabel: "October 2026", employees: [] }));
    await redis.set("employee_rates/NKPL", JSON.stringify({ e1: { salaryPerDay: 500 } }));
    await redis.hset("salary_meta/NKPL/October 2026", { version: "3", tab: "t1" });
    await redis.lpush("salary_history/NKPL/October 2026", JSON.stringify({ version: 2 }));
    await redis.set("unrelated", "x");
  });

  afterAll(async () => {
    await redis.quit();
  });

  it("copies every month, rate card and version, and leaves History to the download", async () => {
    const nightly = await readSnapshot(redis);
    expect(Object.keys(nightly.keys)).toEqual([
      "employee_rates/NKPL",
      "monthly_salary/NKPL/October 2026",
      "salary_meta/NKPL/October 2026",
    ]);
    expect(nightly.keys["salary_meta/NKPL/October 2026"]).toEqual({ version: "3", tab: "t1" });
    const full = await readSnapshot(redis, true);
    expect(full.keys["salary_history/NKPL/October 2026"]).toEqual([{ version: 2 }]);
  });

  it("takes a copy when the last one is older than 20 hours, and prunes old ones", async () => {
    const now = new Date("2026-11-05T02:00:00Z");
    const old = new Date(now.getTime() - BACKUP_EVERY_MS - 1).toISOString();
    const { sql, calls } = fakeStore(old);
    await expect(backupIfDue(sql, redis, "nightly", now)).resolves.toEqual({ took: true, lastAt: now.toISOString() });
    const insert = calls.find((call) => call.text.startsWith("insert"));
    expect(insert?.values.slice(0, 3)).toEqual([now.toISOString(), "nightly", 3]);
    expect(calls.some((call) => call.text.startsWith("delete from salary_backups"))).toBe(true);
  });

  it("skips when a copy was taken in the last 20 hours", async () => {
    const now = new Date("2026-11-05T02:00:00Z");
    const recent = new Date(now.getTime() - 60_000).toISOString();
    const { sql, calls } = fakeStore(recent);
    await expect(backupIfDue(sql, redis, "app", now)).resolves.toEqual({ took: false, lastAt: recent });
    expect(calls.some((call) => call.text.startsWith("insert"))).toBe(false);
  });
});
