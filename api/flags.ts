import { getRedis } from './_lib/redis.js';
import type { FlagLevel, ResolvedFlag } from '../src/flags';
import { firstHeader, normalizeCompany, withApiHandler } from './_lib/http.js';
import { deviceLabel } from './_lib/monthStore.js';

const LEVELS = new Set<unknown>(['fix', 'check', 'note'] satisfies FlagLevel[]);

const resolvedKey = (company: string, month: string) => `salary_flags_resolved/${company}/${month}`;

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length <= max ? value : null;
}

function scopeKey(company: unknown, month: unknown): string | null {
  const co = normalizeCompany(company);
  const label = text(month, 40);
  return label && !co.includes('/') && !label.includes('/') ? resolvedKey(co, label) : null;
}

async function readResolved(key: string): Promise<ResolvedFlag[]> {
  const stored = await getRedis().hgetall(key);
  const flags: ResolvedFlag[] = [];
  for (const raw of Object.values(stored)) {
    try {
      flags.push(JSON.parse(raw) as ResolvedFlag);
    } catch {
      continue;
    }
  }
  return flags.sort((a, b) => b.resolvedAt.localeCompare(a.resolvedAt));
}

export default withApiHandler('GET,POST', async (req, res) => {
  if (req.method === 'GET') {
    const key = scopeKey(req.query.company, req.query.month);
    if (!key) return res.status(400).json({ error: 'Missing month' });
    return res.status(200).json(await readResolved(key));
  }

  const body = req.body ?? {};
  const key = scopeKey(body.company, body.monthLabel);
  if (!key) return res.status(400).json({ error: 'Missing monthLabel' });

  if (body.action === 'reopen') {
    const flagKey = text(body.key, 2000);
    if (!flagKey) return res.status(400).json({ error: 'Missing key' });
    await getRedis().hdel(key, flagKey);
    return res.status(200).json(await readResolved(key));
  }

  if (body.action !== 'resolve') return res.status(400).json({ error: 'Unknown action' });
  const flag = body.flag ?? {};
  const flagKey = text(flag.key, 2000);
  const name = text(flag.name, 2000);
  const title = text(flag.title, 2000);
  const detail = text(flag.detail, 10000);
  if (!flagKey || !LEVELS.has(flag.level) || name === null || title === null || detail === null) {
    return res.status(400).json({ error: 'Flag is missing a field' });
  }
  const resolved: ResolvedFlag = {
    key: flagKey,
    level: flag.level as FlagLevel,
    name,
    title,
    detail,
    resolvedAt: new Date().toISOString(),
    device: deviceLabel(firstHeader(req.headers['user-agent'])),
  };
  await getRedis().hset(key, resolved.key, JSON.stringify(resolved));
  return res.status(200).json(await readResolved(key));
});
