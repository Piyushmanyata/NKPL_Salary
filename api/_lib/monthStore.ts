import type Redis from "ioredis";

export const HISTORY_KEEP = 40;
export const CHECKPOINT_WINDOW_MS = 10 * 60 * 1000;

export const monthKey = (company: string, month: string) => `monthly_salary/${company}/${month}`;
const metaKey = (company: string, month: string) => `salary_meta/${company}/${month}`;
const historyKey = (company: string, month: string) => `salary_history/${company}/${month}`;

// One script so the version check, the history copy and the write cannot interleave with another save.
const SAVE_SCRIPT = `
local cur = redis.call('GET', KEYS[1])
local meta = redis.call('HMGET', KEYS[2], 'version', 'tab', 'pushedAt')
local version = tonumber(meta[1]) or (cur and 1 or 0)
if tonumber(ARGV[1]) ~= version then return {0, version} end
local now = tonumber(ARGV[4])
if cur and (ARGV[5] == '1' or meta[2] ~= ARGV[3] or now - (tonumber(meta[3]) or 0) >= tonumber(ARGV[7])) then
  redis.call('LPUSH', KEYS[3], cur)
  redis.call('LTRIM', KEYS[3], 0, tonumber(ARGV[6]) - 1)
  redis.call('HSET', KEYS[2], 'pushedAt', ARGV[4])
end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('HSET', KEYS[2], 'version', version + 1, 'tab', ARGV[3])
return {1, version + 1}
`;

export type StoredMonth = {
  monthLabel: string;
  days: number;
  employees: unknown[];
  company: string;
  updatedAt: string;
  version: number;
  device?: string;
};

export type SaveInput = {
  company: string;
  monthLabel: string;
  days: number;
  employees: unknown[];
  baseVersion: number;
  tabId: string;
  device: string;
  checkpoint: boolean;
  now?: Date;
};

export type SaveResult =
  | { ok: true; record: StoredMonth }
  | { ok: false; currentVersion: number };

export async function saveMonth(redis: Redis, input: SaveInput): Promise<SaveResult> {
  const now = input.now ?? new Date();
  const record: StoredMonth = {
    monthLabel: input.monthLabel,
    days: input.days,
    employees: input.employees,
    company: input.company,
    updatedAt: now.toISOString(),
    version: input.baseVersion + 1,
    device: input.device,
  };
  const [ok, version] = (await redis.eval(
    SAVE_SCRIPT,
    3,
    monthKey(input.company, input.monthLabel),
    metaKey(input.company, input.monthLabel),
    historyKey(input.company, input.monthLabel),
    String(input.baseVersion),
    JSON.stringify(record),
    input.tabId,
    String(now.getTime()),
    input.checkpoint ? "1" : "0",
    String(HISTORY_KEEP),
    String(CHECKPOINT_WINDOW_MS),
  )) as [number, number];
  return ok === 1 ? { ok: true, record } : { ok: false, currentVersion: version };
}

export async function readMonth(redis: Redis, key: string): Promise<StoredMonth | null> {
  const raw = await redis.get(key);
  if (raw == null) return null;
  try {
    const data = JSON.parse(raw) as StoredMonth;
    return { ...data, version: data.version ?? 1 };
  } catch {
    return null;
  }
}

export async function readHistory(redis: Redis, company: string, month: string): Promise<StoredMonth[]> {
  const raw = await redis.lrange(historyKey(company, month), 0, -1);
  return raw.flatMap((item) => {
    try {
      const data = JSON.parse(item) as StoredMonth;
      return [{ ...data, version: data.version ?? 1 }];
    } catch {
      return [];
    }
  });
}

export function deviceLabel(userAgent: string | undefined): string {
  const ua = userAgent ?? "";
  const os = /iPhone/.test(ua) ? "iPhone"
    : /iPad/.test(ua) ? "iPad"
    : /Android/.test(ua) ? "Android"
    : /Windows/.test(ua) ? "Windows PC"
    : /Macintosh/.test(ua) ? "Mac"
    : /Linux/.test(ua) ? "Linux"
    : "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Safari\//.test(ua) ? "Safari"
    : "";
  return browser ? `${os} · ${browser}` : os;
}
