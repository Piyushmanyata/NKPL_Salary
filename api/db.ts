import { put, list, del } from '@vercel/blob';
import type { VercelRequest, VercelResponse } from '@vercel/node';

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

    if (req.method === 'GET') {
      if (!month) {
        // List all months
        const { blobs } = await list({ prefix: 'monthly_salary/' });
        const months = blobs.map(b => {
          const parts = b.pathname.split('/');
          const filename = parts[parts.length - 1];
          return filename.replace('.json', '');
        });
        return res.status(200).json(months);
      }

      // Get single month data
      const normalized = String(month);
      const { blobs } = await list({ prefix: `monthly_salary/${normalized}.json` });
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
      if (!monthLabel) {
        return res.status(400).json({ error: 'Missing monthLabel' });
      }

      const data = { monthLabel, days, employees, updatedAt: new Date().toISOString() };
      // Save to blob
      const blob = await put(`monthly_salary/${monthLabel}.json`, JSON.stringify(data), {
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
      const { blobs } = await list({ prefix: `monthly_salary/${normalized}.json` });
      if (blobs.length > 0) {
        await del(blobs[0].url);
      }
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
