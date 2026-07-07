import { kv } from '@vercel/kv';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const DEFAULT_COMPANY = 'NKPL';

function normalizeCompany(value: unknown): string {
  const text = String(value ?? '').trim();
  return text || DEFAULT_COMPANY;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,DELETE,POST,PUT,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const { month } = req.query;
    const company = normalizeCompany(req.query.company);

    if (req.method === 'GET') {
      if (!month) {
        const months = new Set<string>();
        // List keys under the company's namespace: e.g. monthly_salary/${company}/*
        const keys = await kv.keys(`monthly_salary/${company}/*`);
        for (const key of keys) {
          const rest = key.slice(`monthly_salary/${company}/`.length);
          months.add(rest);
        }

        // If DEFAULT_COMPANY (NKPL), also load legacy flat-path keys
        if (company === DEFAULT_COMPANY) {
          const legacyKeys = await kv.keys('monthly_salary/*');
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

      // Get single month data for this company
      const normalized = String(month);
      const primaryPath = `monthly_salary/${company}/${normalized}`;
      let data = await kv.get(primaryPath);

      if (!data && company === DEFAULT_COMPANY) {
        // Fall back to the legacy flat path used before multi-company support
        const legacyPath = `monthly_salary/${normalized}`;
        data = await kv.get(legacyPath);
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
      // Save to KV, namespaced by company
      await kv.set(`monthly_salary/${bodyCompany}/${monthLabel}`, data);

      return res.status(200).json(data);
    }

    if (req.method === 'DELETE') {
      if (!month) {
        return res.status(400).json({ error: 'Missing month' });
      }
      const normalized = String(month);
      const primaryPath = `monthly_salary/${company}/${normalized}`;
      await kv.del(primaryPath);

      if (company === DEFAULT_COMPANY) {
        const legacyPath = `monthly_salary/${normalized}`;
        await kv.del(legacyPath);
      }

      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
