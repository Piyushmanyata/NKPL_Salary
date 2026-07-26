/**
 * TICKET-06 — Flip legacy negative `advance` values to positive.
 *
 * Convention (SPEC §2.4 / TICKET-06):
 *   advance is stored positive = "₹X was advanced and is recovered this month".
 *   The engine always subtracts. Negative input is clamped at the boundary.
 *
 * Historical data (pre 2026-07-24 rework) stored negatives because the engine
 * used to *add* advance to net. After the operator flipped to subtract without
 * a migration, those rows double-wrong: a stored −1500 became +1500 on net.
 *
 * Usage (from repo root):
 *   node scripts/migrate-advance-sign.mjs            # dry-run (default)
 *   node scripts/migrate-advance-sign.mjs --apply    # write changes
 *
 * Requires REDIS_URL in the environment (or .env.local).
 * Logs every touched row. Idempotent: already-positive advances are left alone.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import Redis from "ioredis";

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
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

const APPLY = process.argv.includes("--apply");
const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
  console.error("error: REDIS_URL is not set (check .env.local)");
  process.exit(1);
}

const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 2,
  connectTimeout: 15_000,
  // Redis Cloud / Upstash may require TLS; ioredis enables it for rediss://
});

function parseValue(raw) {
  if (raw == null) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function listSalaryKeys() {
  const keys = new Set();
  let cursor = "0";
  do {
    const [next, batch] = await redis.scan(cursor, "MATCH", "monthly_salary/*", "COUNT", 200);
    cursor = next;
    for (const k of batch) keys.add(k);
  } while (cursor !== "0");
  return [...keys].sort();
}

async function main() {
  console.log(APPLY ? "MODE: APPLY (writes enabled)" : "MODE: dry-run (no writes)");
  console.log(`target: ${REDIS_URL.replace(/:[^:@/]+@/, ":***@")}`);
  console.log();

  const keys = await listSalaryKeys();
  console.log(`scanned ${keys.length} monthly_salary/* keys`);

  const touches = [];
  let recordsTouched = 0;

  for (const key of keys) {
    const raw = await redis.get(key);
    const data = parseValue(raw);
    if (!data || !Array.isArray(data.employees)) {
      continue;
    }

    let changed = false;
    const nextEmployees = data.employees.map((emp) => {
      if (emp == null || typeof emp !== "object") return emp;
      const adv = emp.advance;
      if (adv == null || adv === "" || Number(adv) >= 0) return emp;
      const flipped = Math.abs(Number(adv));
      touches.push({
        key,
        company: data.company ?? "(legacy)",
        month: data.monthLabel ?? key,
        id: emp.id ?? null,
        name: emp.name ?? "(unnamed)",
        from: Number(adv),
        to: flipped,
      });
      changed = true;
      return { ...emp, advance: flipped };
    });

    if (!changed) continue;
    recordsTouched += 1;

    if (APPLY) {
      const next = {
        ...data,
        employees: nextEmployees,
        updatedAt: new Date().toISOString(),
        advanceSignMigratedAt: new Date().toISOString(),
      };
      await redis.set(key, JSON.stringify(next));
    }
  }

  console.log();
  console.log(`records with negative advances: ${recordsTouched}`);
  console.log(`employee rows flipped: ${touches.length}`);
  console.log();
  if (touches.length === 0) {
    console.log("nothing to do — no negative advances found.");
  } else {
    console.log("touches:");
    for (const t of touches) {
      console.log(
        `  ${t.company} | ${t.month} | ${t.name} (${t.id})  ${t.from} → ${t.to}  [${t.key}]`
      );
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = resolve(
    process.cwd(),
    `scripts/logs/advance-sign-migration-${APPLY ? "apply" : "dry-run"}-${stamp}.json`
  );
  const { mkdirSync } = await import("node:fs");
  mkdirSync(resolve(process.cwd(), "scripts/logs"), { recursive: true });
  writeFileSync(
    logPath,
    JSON.stringify(
      {
        mode: APPLY ? "apply" : "dry-run",
        ranAt: new Date().toISOString(),
        keysScanned: keys.length,
        recordsTouched,
        touches,
      },
      null,
      2
    )
  );
  console.log();
  console.log(`log written: ${logPath}`);

  await redis.quit();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await redis.quit();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
