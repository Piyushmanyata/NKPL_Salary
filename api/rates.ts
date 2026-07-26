import type { VercelRequest, VercelResponse } from '@vercel/node';
import { redisGetJson, redisSetJson } from './_lib/redis.js';

const DEFAULT_COMPANY = 'NKPL';

function normalizeCompany(value: unknown): string {
  const text = String(value ?? '').trim();
  return text || DEFAULT_COMPANY;
}

// A single small JSON blob per company holds every employee's per-day rates:
// { [employeeId]: { id, name, salaryPerDay, bonusPerDay } }.
// This is the one piece of employee data meant to persist across every
// month -- everything else (attendance, deductions, bonuses, etc.) still
// lives in the per-month record in api/db.ts.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  if (req.headers.origin) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
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
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
