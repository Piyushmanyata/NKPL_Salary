import { getRedis, redisKeys } from './_lib/redis.js';
import { DEFAULT_COMPANY, firstHeader, normalizeCompany, withApiHandler } from './_lib/http.js';
import { deviceLabel, monthKey, readHistory, readMonth, saveMonth } from './_lib/monthStore.js';

// Legacy pre-multi-Company flat keys kept until a read-only Redis scan
// confirms none remain (issue #26). No scan run in this environment —
// fallback stays. Finding: cannot verify datastore without REDIS credentials.

const STALE_MESSAGE = 'This tab is out of date: newer data was saved after it opened. Reload the page.';

export default withApiHandler('GET,POST', async (req, res) => {
  const { month } = req.query;
  const company = normalizeCompany(req.query.company);
  const redis = getRedis();

  if (req.method === 'GET') {
    if (!month) {
      const months = new Set<string>();
      const keys = await redisKeys(`monthly_salary/${company}/*`);
      for (const key of keys) {
        const rest = key.slice(`monthly_salary/${company}/`.length);
        months.add(rest);
      }

      if (company === DEFAULT_COMPANY) {
        const legacyKeys = await redisKeys('monthly_salary/*');
        for (const key of legacyKeys) {
          const rest = key.slice('monthly_salary/'.length);
          const parts = rest.split('/');
          if (parts.length === 1) {
            months.add(parts[0]);
          }
        }
      }
      return res.status(200).json(Array.from(months));
    }

    const normalized = String(month);
    if (req.query.history) {
      return res.status(200).json(await readHistory(redis, company, normalized));
    }

    let data = await readMonth(redis, monthKey(company, normalized));
    if (!data && company === DEFAULT_COMPANY) {
      const legacy = await readMonth(redis, `monthly_salary/${normalized}`);
      data = legacy && { ...legacy, version: 0 };
    }

    if (!data) {
      return res.status(404).json({ error: 'Not found' });
    }

    return res.status(200).json(data);
  }

  const { monthLabel, days, employees, baseVersion, tabId, checkpoint } = req.body;
  const bodyCompany = normalizeCompany(req.body.company);
  if (!monthLabel) {
    return res.status(400).json({ error: 'Missing monthLabel' });
  }
  if (!Number.isInteger(baseVersion) || typeof tabId !== 'string' || !tabId) {
    return res.status(409).json({ error: STALE_MESSAGE, stale: true });
  }

  const result = await saveMonth(redis, {
    company: bodyCompany,
    monthLabel,
    days,
    employees,
    baseVersion,
    tabId,
    device: deviceLabel(firstHeader(req.headers['user-agent'])),
    checkpoint: checkpoint === true,
  });
  if (!result.ok) {
    const { current } = result;
    return res.status(409).json({
      error: STALE_MESSAGE,
      stale: true,
      current: current && { version: current.version, updatedAt: current.updatedAt, device: current.device },
    });
  }
  return res.status(200).json(result.record);
});
