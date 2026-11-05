export const DEFAULT_COMPANY = "NKPL";

export function normalizeCompany(value: unknown): string {
  const text = String(value ?? "").trim();
  return text || DEFAULT_COMPANY;
}

export function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The parts of Vercel's Node request and response helpers these routes use. */
export type ApiRequest = {
  method?: string;
  query: Record<string, string | string[] | undefined>;
  headers: Record<string, string | string[] | undefined>;
  body: any;
};
export type ApiResponse = {
  status(code: number): ApiResponse;
  json(body: unknown): ApiResponse;
  setHeader(name: string, value: string): void;
};

type RouteHandler = (req: ApiRequest, res: ApiResponse) => Promise<void | ApiResponse>;

/**
 * Shared method check and error wrapper for serverless routes. The app calls them from its own page only, so no CORS
 * headers: a page on another site cannot read or change salaries with the visitor's Vercel login.
 */
export function withApiHandler(methods: string, handler: RouteHandler) {
  const allowed = methods.split(",");
  return async (req: ApiRequest, res: ApiResponse) => {
    if (!allowed.includes(req.method ?? "")) {
      res.setHeader("Allow", methods);
      return res.status(405).json({ error: "Method not allowed" });
    }
    try {
      await handler(req, res);
    } catch (error: any) {
      console.error(error);
      return res.status(500).json({ error: error?.message || String(error) });
    }
  };
}
