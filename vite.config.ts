import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// Serves api/*.ts on the dev server so the app can be clicked through locally. Only on when
// REDIS_URL points at a local Redis, so a dev run can never write the live payroll.
function localApi(): Plugin {
  return {
    name: "local-api",
    configureServer(server) {
      const url = process.env.REDIS_URL ?? "";
      if (!/^redis:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) return;
      server.middlewares.use(async (req, res, next) => {
        const match = req.url?.match(/^\/api\/(db|rates|flags)(\?.*)?$/);
        if (!match) return next();
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const raw = Buffer.concat(chunks).toString();
        const { default: handler } = await server.ssrLoadModule(`/api/${match[1]}.ts`);
        const reply = {
          status(code: number) {
            res.statusCode = code;
            return reply;
          },
          json(body: unknown) {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(body));
            return reply;
          },
          setHeader: (name: string, value: string) => res.setHeader(name, value),
        };
        await handler(
          {
            method: req.method,
            query: Object.fromEntries(new URLSearchParams(match[2] ?? "")),
            headers: req.headers,
            body: raw ? JSON.parse(raw) : {},
          },
          reply,
        );
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localApi()],
  css: {
    modules: {
      // .appbar-identity -> styles.appbarIdentity (and styles['appbar-identity'])
      localsConvention: "camelCase",
    },
  },
  test: {
    // 200k invariant cases need headroom on slower CI runners
    testTimeout: 120_000,
  },
});
