import type { VercelRequest, VercelResponse } from "@vercel/node";
import { redisGetJson, redisSetJson } from "./_lib/redis.js";

const DEFAULT_COMPANY = "NKPL";

function normalizeCompany(value: unknown): string {
  const text = String(value ?? "").trim();
  return text || DEFAULT_COMPANY;
}

function metaKey(company: string) {
  return `attendance_meta/${company}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  if (req.headers.origin) {
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version"
  );

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  try {
    const company = normalizeCompany(req.query.company);

    if (req.method === "GET") {
      const data = await redisGetJson(metaKey(company));
      if (!data) {
        return res.status(404).json({ error: "Not found" });
      }
      return res.status(200).json(data);
    }

    if (req.method === "POST") {
      const bodyCompany = normalizeCompany(req.body.company);
      const record = {
        v: 1,
        c: bodyCompany,
        u: new Date().toISOString(),
        map: req.body.map && typeof req.body.map === "object" ? req.body.map : {},
        excluded: Array.isArray(req.body.excluded) ? req.body.excluded : [],
      };
      await redisSetJson(metaKey(bodyCompany), record);
      return res.status(200).json(record);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
