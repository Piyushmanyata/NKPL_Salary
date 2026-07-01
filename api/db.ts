import { put, list, del } from '@vercel/blob';
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
        // List all months for this company. A single prefix list covers both the
        // current per-company layout (monthly_salary/{company}/{month}.json) and
        // the legacy flat layout (monthly_salary/{month}.json), which only ever
        // held NKPL data before companies existed.
        const { blobs } = await list({ prefix: 'monthly_salary/' });
        const months = new Set<string>();
        for (const blob of blobs) {
          const rest = blob.pathname.slice('monthly_salary/'.length);
          const parts = rest.split('/');
          if (parts.length === 1) {
            if (company === DEFAULT_COMPANY) {
              months.add(parts[0].replace(/\.json$/, ''));
            }
          } else if (parts.length === 2 && parts[0] === company) {
            months.add(parts[1].replace(/\.json$/, ''));
          }
        }
        return res.status(200).json(Array.from(months));
      }

      // Get single month data for this company
      const normalized = String(month);
      const primaryPath = `monthly_salary/${company}/${normalized}.json`;
      let blobs = (await list({ prefix: primaryPath })).blobs.filter((b) => b.pathname === primaryPath);

      if (blobs.length === 0 && company === DEFAULT_COMPANY) {
        // Fall back to the legacy flat path used before multi-company support
        const legacyPath = `monthly_salary/${normalized}.json`;
        blobs = (await list({ prefix: legacyPath })).blobs.filter((b) => b.pathname === legacyPath);
      }

      if (blobs.length === 0) {
        return res.status(404).json({ error: 'Not found' });
      }

      // Fetch the file content
      const fileRes = await fetch(blobs[0].url);
      const data = await fileRes.json();
      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      const { monthLabel, days, employees } = req.body;
      const bodyCompany = normalizeCompany(req.body.company);
      if (!monthLabel) {
        return res.status(400).json({ error: 'Missing monthLabel' });
      }

      const data = { monthLabel, days, employees, company: bodyCompany, updatedAt: new Date().toISOString() };
      // Save to blob, namespaced by company
      const blob = await put(`monthly_salary/${bodyCompany}/${monthLabel}.json`, JSON.stringify(data), {
        access: 'public',
        addRandomSuffix: false,
      });

      return res.status(200).json(blob);
    }

    if (req.method === 'DELETE') {
      if (!month) {
        return res.status(400).json({ error: 'Missing month' });
      }
      const normalized = String(month);
      const primaryPath = `monthly_salary/${company}/${normalized}.json`;
      const blobs = (await list({ prefix: primaryPath })).blobs.filter((b) => b.pathname === primaryPath);
      for (const blob of blobs) {
        await del(blob.url);
      }

      if (company === DEFAULT_COMPANY) {
        const legacyPath = `monthly_salary/${normalized}.json`;
        const legacyBlobs = (await list({ prefix: legacyPath })).blobs.filter((b) => b.pathname === legacyPath);
        for (const blob of legacyBlobs) {
          await del(blob.url);
        }
      }

      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
