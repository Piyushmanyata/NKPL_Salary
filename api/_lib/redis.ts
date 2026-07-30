/**
 * Shared Redis client for serverless API routes — the app's only database.
 * REDIS_URL is a standard redis:// / rediss:// connection string, so any
 * provider works (Upstash, Redis Cloud, self-hosted); swapping providers is an
 * env var change, not a code change.
 */
import Redis from "ioredis";

let client: Redis | null = null;

export function getRedis(): Redis {
  const url = process.env.REDIS_URL;
  if (!url || !/^rediss?:\/\//i.test(url)) {
    throw new Error(
      "REDIS_URL is missing or not ready (expected redis:// or rediss:// from Vercel Redis).",
    );
  }
  if (!client) {
    client = new Redis(url, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      lazyConnect: false,
      // Serverless: avoid hanging sockets after the response is sent
      connectTimeout: 10_000,
    });
  }
  return client;
}

export async function redisGetJson<T = unknown>(key: string): Promise<T | null> {
  const raw = await getRedis().get(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function redisSetJson(key: string, value: unknown): Promise<void> {
  await getRedis().set(key, JSON.stringify(value));
}

export async function redisDel(key: string): Promise<void> {
  await getRedis().del(key);
}

export async function redisKeys(pattern: string): Promise<string[]> {
  const redis = getRedis();
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 200);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== "0");
  return keys;
}
