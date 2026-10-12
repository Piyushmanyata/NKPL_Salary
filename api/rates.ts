import { redisGetJson, redisSetJson } from './_lib/redis.js';
import { normalizeCompany, withApiHandler } from './_lib/http.js';
import { applyRateCardPatch, isRateCardPatch, isRecord } from './_lib/rateCard.js';

// A single small JSON value per company holds every employee's per-day rates.
// This is the one piece of employee data meant to persist across every month.
export default withApiHandler('GET,POST,OPTIONS', async (req, res) => {
  const company = normalizeCompany(req.query.company);
  const path = `employee_rates/${company}`;

  if (req.method === 'GET') {
    const data = await redisGetJson(path);
    return res.status(200).json(data && typeof data === 'object' ? data : {});
  }

  if (req.method === 'POST') {
    const bodyCompany = normalizeCompany(req.body.company);
    const patch = req.body.patch;
    if (!isRateCardPatch(patch)) {
      return res.status(400).json({ error: 'Missing patch' });
    }
    const key = `employee_rates/${bodyCompany}`;
    // ponytail: read-merge-write is not atomic; two saves in the same instant lose one. Use WATCH/MULTI if the app gains concurrent writers.
    const stored = await redisGetJson<Record<string, object>>(key);
    if (stored !== null && !isRecord(stored)) {
      return res.status(500).json({ error: 'Stored Rate Card is not an object' });
    }
    const rates = applyRateCardPatch(stored ?? {}, patch);
    await redisSetJson(key, rates);
    return res.status(200).json(rates);
  }

  return res.status(405).json({ error: 'Method not allowed' });
});
