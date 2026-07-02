import { put, list } from '@vercel/blob';
import type { VercelRequest, VercelResponse } from '@vercel/node';

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
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
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
    const path = `employee_rates/${company}.json`;

    if (req.method === 'GET') {
      const blobs = (await list({ prefix: path })).blobs.filter((b) => b.pathname === path);
      if (blobs.length === 0) {
        return res.status(200).json({});
      }

      const fileRes = await fetch(`${blobs[0].url}?t=${Date.now()}`, {
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
        },
      });
      const data = await fileRes.json();
      return res.status(200).json(data && typeof data === 'object' ? data : {});
    }

    if (req.method === 'POST') {
      const bodyCompany = normalizeCompany(req.body.company);
      const rates = req.body.rates;
      if (!rates || typeof rates !== 'object') {
        return res.status(400).json({ error: 'Missing rates' });
      }

      const blob = await put(`employee_rates/${bodyCompany}.json`, JSON.stringify(rates), {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
      });

      return res.status(200).json(blob);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
