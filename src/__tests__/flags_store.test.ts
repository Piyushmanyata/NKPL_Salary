import Redis from "ioredis";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import handler from "../../api/flags";

const url = process.env.TEST_REDIS_URL && `${process.env.TEST_REDIS_URL.replace(/\/\d*$/, "")}/1`;

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

const flag = (key: string, detail = "Days 40, but October 2026 has 31.") => ({
  key,
  level: "fix",
  name: "Laltu Malik",
  title: "More days than the month has",
  detail,
});

const resolve = (key: string, company = "APTUS") =>
  call("POST", {}, { action: "resolve", company, monthLabel: "October 2026", flag: flag(key) });

const list = (company = "APTUS", month = "October 2026") => call("GET", { company, month });

describe.skipIf(!url)("resolved flags against a real Redis", () => {
  const redis = new Redis(url ?? "");

  beforeEach(async () => {
    process.env.REDIS_URL = url;
    await redis.flushdb();
  });

  afterAll(async () => {
    await redis.quit();
  });

  it("saves a resolved flag with when and on which device, kept per company and month", async () => {
    const saved = await resolve("fix|days-over:a");
    expect(saved.code).toBe(200);
    expect(saved.body).toEqual([
      expect.objectContaining({ ...flag("fix|days-over:a"), device: "Windows PC · Chrome", resolvedAt: expect.any(String) }),
    ]);
    expect((await list()).body).toHaveLength(1);
    expect((await list("NKPL")).body).toEqual([]);
    expect((await list("APTUS", "September 2026")).body).toEqual([]);
  });

  it("two tabs resolving at once both land, and Undo removes only its own flag", async () => {
    await Promise.all([resolve("fix|days-over:a"), resolve("check|net:b")]);
    expect((await list()).body.map((item: { key: string }) => item.key).sort()).toEqual(["check|net:b", "fix|days-over:a"]);
    const undone = await call("POST", {}, { action: "reopen", company: "APTUS", monthLabel: "October 2026", key: "check|net:b" });
    expect(undone.body.map((item: { key: string }) => item.key)).toEqual(["fix|days-over:a"]);
  });

  it("refuses a flag with a missing field or an unknown action", async () => {
    const missing = await call("POST", {}, { action: "resolve", company: "APTUS", monthLabel: "October 2026", flag: { key: "x" } });
    expect(missing.code).toBe(400);
    expect((await call("POST", {}, { action: "wipe", monthLabel: "October 2026" })).code).toBe(400);
    expect((await call("GET", { company: "APTUS" })).code).toBe(400);
    expect((await list()).body).toEqual([]);
  });
});
