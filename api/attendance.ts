import type { VercelRequest, VercelResponse } from "@vercel/node";
import { redisGetJson, redisSetJson } from "./_lib/redis.js";

const DEFAULT_COMPANY = "NKPL";

function normalizeCompany(value: unknown): string {
  const text = String(value ?? "").trim();
  return text || DEFAULT_COMPANY;
}

function attendanceKey(company: string, month: string) {
  return `attendance/${company}/${month}`;
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
    const month = req.query.month ? String(req.query.month) : "";

    if (req.method === "GET") {
      if (!month) {
        return res.status(400).json({ error: "Missing month" });
      }
      const data = await redisGetJson(attendanceKey(company, month));
      if (!data) {
        return res.status(404).json({ error: "Not found" });
      }
      return res.status(200).json(data);
    }

    if (req.method === "POST") {
      const bodyCompany = normalizeCompany(req.body.company);
      const monthLabel = String(req.body.monthLabel || req.body.m || "");
      if (!monthLabel) {
        return res.status(400).json({ error: "Missing monthLabel" });
      }
      const record = {
        ...req.body,
        v: req.body.v ?? 1,
        c: bodyCompany,
        m: monthLabel,
        u: new Date().toISOString(),
      };
      await redisSetJson(attendanceKey(bodyCompany, monthLabel), record);
      return res.status(200).json(record);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
