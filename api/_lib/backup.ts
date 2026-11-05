import type Redis from "ioredis";
import type { NeonQueryFunction } from "@neondatabase/serverless";

export const BACKUP_EVERY_MS = 20 * 60 * 60 * 1000;
export const BACKUP_KEEP_DAYS = 180;

const LIVE_PATTERNS = ["monthly_salary/*", "employee_rates/*", "salary_meta/*", "salary_flags_resolved/*"];
const HISTORY_PATTERN = "salary_history/*";

export type Snapshot = { takenAt: string; keys: Record<string, unknown> };
type Sql = NeonQueryFunction<false, false>;

async function scan(redis: Redis, pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 200);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== "0");
  return keys.sort();
}

function parse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function readKey(redis: Redis, key: string): Promise<unknown> {
  const type = await redis.type(key);
  if (type === "hash") return redis.hgetall(key);
  if (type === "list") return (await redis.lrange(key, 0, -1)).map(parse);
  const raw = await redis.get(key);
  return raw == null ? null : parse(raw);
}

/** Every key the app owns; `withHistory` adds the replaced copies History keeps, which a nightly copy leaves out because the nightly copies are themselves a history. */
export async function readSnapshot(redis: Redis, withHistory = false, now = new Date()): Promise<Snapshot> {
  const patterns = withHistory ? [...LIVE_PATTERNS, HISTORY_PATTERN] : LIVE_PATTERNS;
  const names = new Set<string>();
  for (const pattern of patterns) for (const key of await scan(redis, pattern)) names.add(key);
  if (await redis.exists("monthly_salary")) names.add("monthly_salary");
  const keys: Record<string, unknown> = {};
  for (const key of [...names].sort()) keys[key] = await readKey(redis, key);
  return { takenAt: now.toISOString(), keys };
}

async function ensureTable(sql: Sql): Promise<void> {
  await sql`create table if not exists salary_backups (
    id bigserial primary key,
    taken_at timestamptz not null default now(),
    source text not null,
    key_count int not null,
    data jsonb not null
  )`;
}

export async function lastBackupAt(sql: Sql): Promise<string | null> {
  await ensureTable(sql);
  const rows = await sql`select max(taken_at) as at from salary_backups`;
  const at = rows[0]?.at;
  return at ? new Date(at).toISOString() : null;
}

/** Copies the live keys unless one was taken in the last 20 hours. Keeps 180 days, and the first copy of every month for good. */
export async function backupIfDue(
  sql: Sql,
  redis: Redis,
  source: string,
  now = new Date(),
): Promise<{ took: boolean; lastAt: string }> {
  const last = await lastBackupAt(sql);
  if (last && now.getTime() - Date.parse(last) < BACKUP_EVERY_MS) return { took: false, lastAt: last };
  const snapshot = await readSnapshot(redis, false, now);
  await sql`insert into salary_backups (taken_at, source, key_count, data)
    values (${snapshot.takenAt}, ${source}, ${Object.keys(snapshot.keys).length}, ${JSON.stringify(snapshot.keys)}::jsonb)`;
  await sql`delete from salary_backups
    where taken_at < ${snapshot.takenAt}::timestamptz - make_interval(days => ${BACKUP_KEEP_DAYS})
      and id not in (
        select distinct on (date_trunc('month', taken_at)) id
        from salary_backups order by date_trunc('month', taken_at), taken_at
      )`;
  return { took: true, lastAt: snapshot.takenAt };
}
