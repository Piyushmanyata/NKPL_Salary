import { getRedis } from './_lib/redis.js';
import { normalizeCompany, withApiHandler } from './_lib/http.js';
import { deviceLabel } from './_lib/monthStore.js';

const LEVELS = new Set(['fix', 'check', 'note']);

const resolvedKey = (company: string, month: string) => `salary_flags_resolved/${company}/${month}`;

type ResolvedFlag = {
  key: string;
  level: string;
  name: string;
  title: string;
  detail: string;
  resolvedAt: string;
  device: string;
};

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length <= max ? value : null;
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
    const month = text(req.query.month, 40);
    if (!month) return res.status(400).json({ error: 'Missing month' });
    return res.status(200).json(await readResolved(resolvedKey(normalizeCompany(req.query.company), month)));
  }

  const body = req.body ?? {};
  const month = text(body.monthLabel, 40);
  if (!month) return res.status(400).json({ error: 'Missing monthLabel' });
  const key = resolvedKey(normalizeCompany(body.company), month);

  if (body.action === 'reopen') {
    const flagKey = text(body.key, 300);
    if (!flagKey) return res.status(400).json({ error: 'Missing key' });
    await getRedis().hdel(key, flagKey);
    return res.status(200).json(await readResolved(key));
  }

  if (body.action !== 'resolve') return res.status(400).json({ error: 'Unknown action' });
  const flag = body.flag ?? {};
  const record = {
    key: text(flag.key, 300),
    level: LEVELS.has(flag.level) ? flag.level : null,
    name: text(flag.name, 200),
    title: text(flag.title, 200),
    detail: text(flag.detail, 2000),
  };
  if (!record.key || !record.level || record.name === null || record.title === null || record.detail === null) {
    return res.status(400).json({ error: 'Flag is missing a field' });
  }
  const resolved: ResolvedFlag = {
    ...(record as Omit<ResolvedFlag, 'resolvedAt' | 'device'>),
    resolvedAt: new Date().toISOString(),
    device: deviceLabel(firstHeader(req.headers['user-agent'])),
  };
  await getRedis().hset(key, resolved.key, JSON.stringify(resolved));
  return res.status(200).json(await readResolved(key));
});

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
