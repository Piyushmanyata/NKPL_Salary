/**
 * Seed June 2026 month records into Redis (REDIS_URL / .env.local).
 * Uses bundled fixtures with SPEC-aligned positive advances.
 *
 *   node --import tsx scripts/seed-june-redis.mjs
 *   node --import tsx scripts/seed-june-redis.mjs --dry-run
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import Redis from "ioredis";
import { juneEmployees } from "../src/juneEmployees.ts";

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvLocal();

const DRY = process.argv.includes("--dry-run");
const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) {
  console.error("REDIS_URL not set");
  process.exit(1);
}

const aptus = JSON.parse(
  readFileSync("src/__tests__/fixtures/aptus-june-inputs.json", "utf8"),
);

function clampAdvances(employees) {
  return employees.map((e) => {
    const adv = e.advance;
    if (adv == null || adv === "") return e;
    const n = Number(adv);
    if (!Number.isFinite(n) || n <= 0) {
      const { advance, ...rest } = e;
      // drop zero/negative; negative should already be fixed in fixtures
      if (n < 0) return { ...rest, advance: Math.abs(n) };
      return rest;
    }
    return { ...e, advance: n };
  });
}

const records = [
  {
    key: "monthly_salary/NKPL/June 2026",
    body: {
      monthLabel: "June 2026",
      days: 30,
      company: "NKPL",
      employees: clampAdvances(juneEmployees),
      updatedAt: new Date().toISOString(),
    },
  },
  {
    key: "monthly_salary/APTUS/June 2026",
    body: {
      monthLabel: "June 2026",
      days: 30,
      company: "APTUS",
      employees: clampAdvances(aptus),
      updatedAt: new Date().toISOString(),
    },
  },
];

const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 2, connectTimeout: 15_000 });

async function main() {
  console.log(DRY ? "MODE: dry-run" : "MODE: apply");
  console.log(`target: ${REDIS_URL.replace(/:[^:@/]+@/, ":***@")}`);
  for (const r of records) {
    const neg = (r.body.employees || []).filter(
      (e) => e.advance != null && Number(e.advance) < 0,
    );
    console.log(
      `${r.key}: employees=${r.body.employees.length} negativeAdvances=${neg.length}`,
    );
    if (!DRY) {
      await redis.set(r.key, JSON.stringify(r.body));
      console.log(`  wrote ${r.key}`);
    }
  }
  await redis.quit();
  console.log(DRY ? "dry-run complete" : "seed complete");
}

main().catch(async (e) => {
  console.error(e);
  try {
    await redis.quit();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
