import type { VercelRequest, VercelResponse } from '@vercel/node';
import { redisGetJson, redisSetJson } from './_lib/redis.js';
import { normalizeCompany, withApiHandler } from './_lib/http.js';

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
    const rates = req.body.rates;
    if (!rates || typeof rates !== 'object') {
      return res.status(400).json({ error: 'Missing rates' });
    }
    await redisSetJson(`employee_rates/${bodyCompany}`, rates);
    return res.status(200).json(rates);
  }

  return res.status(405).json({ error: 'Method not allowed' });
});
