import { redisDel, redisGetJson, redisKeys, redisSetJson } from './_lib/redis.js';
import { DEFAULT_COMPANY, normalizeCompany, withApiHandler } from './_lib/http.js';

// Legacy pre-multi-Company flat keys kept until a read-only Redis scan
// confirms none remain (issue #26). No scan run in this environment —
// fallback stays. Finding: cannot verify datastore without REDIS credentials.

export default withApiHandler('GET,DELETE,POST,PUT,OPTIONS', async (req, res) => {
  const { month } = req.query;
  const company = normalizeCompany(req.query.company);

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
    const primaryPath = `monthly_salary/${company}/${normalized}`;
    let data = await redisGetJson(primaryPath);

    if (!data && company === DEFAULT_COMPANY) {
      data = await redisGetJson(`monthly_salary/${normalized}`);
    }

    if (!data) {
      return res.status(404).json({ error: 'Not found' });
    }

    return res.status(200).json(data);
  }

  if (req.method === 'POST') {
    const { monthLabel, days, employees } = req.body;
    const bodyCompany = normalizeCompany(req.body.company);
    if (!monthLabel) {
      return res.status(400).json({ error: 'Missing monthLabel' });
    }

    const data = { monthLabel, days, employees, company: bodyCompany, updatedAt: new Date().toISOString() };
    await redisSetJson(`monthly_salary/${bodyCompany}/${monthLabel}`, data);
    return res.status(200).json(data);
  }

  if (req.method === 'DELETE') {
    if (!month) {
      return res.status(400).json({ error: 'Missing month' });
    }
    const normalized = String(month);
    await redisDel(`monthly_salary/${company}/${normalized}`);
    if (company === DEFAULT_COMPANY) {
      await redisDel(`monthly_salary/${normalized}`);
    }
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
});
