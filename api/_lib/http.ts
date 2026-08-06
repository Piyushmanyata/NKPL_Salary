import type { VercelRequest, VercelResponse } from "@vercel/node";

export const DEFAULT_COMPANY = "NKPL";

export function normalizeCompany(value: unknown): string {
  const text = String(value ?? "").trim();
  return text || DEFAULT_COMPANY;
}

export function applyCors(req: VercelRequest, res: VercelResponse, methods: string) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  if (req.headers.origin) {
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version",
  );
}

type RouteHandler = (req: VercelRequest, res: VercelResponse) => Promise<void | VercelResponse>;

/** Shared CORS + OPTIONS + error wrapper for serverless routes. */
export function withApiHandler(methods: string, handler: RouteHandler) {
  return async (req: VercelRequest, res: VercelResponse) => {
    applyCors(req, res, methods);
    if (req.method === "OPTIONS") {
      res.status(200).end();
      return;
    }
    try {
      await handler(req, res);
    } catch (error: any) {
      console.error(error);
      return res.status(500).json({ error: error?.message || String(error) });
    }
  };
}
