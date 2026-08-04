/**
 * Seed `allowanceExpr` on the stored employee rate records.
 *
 * The monthly allowance is now typed as the running sum of the raises that
 * built it ("400+500+600"). Existing records only know the total, so this
 * migration writes that total as the first (and so far only) term — every
 * later raise is appended in the UI and stays visible from then on.
 *
 * Only employee_rates/* keys are touched, and only by ADDING the new field:
 * salaryPerDay, bonusPerDay, monthlySalary and totalSalary are left byte-wise
 * alone. Rows with no allowance (totalSalary <= monthlySalary) are skipped —
 * there is no raise history to record.
 *
 * Usage:
 *   node scripts/migrate-allowance-expression.mjs          # dry-run
 *   node scripts/migrate-allowance-expression.mjs --apply  # write changes
 *
 * Requires REDIS_URL in the environment or .env.local.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import Redis from "ioredis";

const APPLY = process.argv.includes("--apply");

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvLocal();

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) {
  console.error("error: REDIS_URL is not set (check .env.local)");
  process.exit(1);
}

const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 2,
  connectTimeout: 15_000,
});

async function listRateKeys() {
  const keys = [];
  let cursor = "0";
  do {
    const [next, batch] = await redis.scan(cursor, "MATCH", "employee_rates/*", "COUNT", 200);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== "0");
  return keys.sort();
}

function parseRecord(raw) {
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const money = (value) => Math.round(Math.max(0, Number(value) || 0) * 100) / 100;

async function main() {
  console.log(APPLY ? "MODE: APPLY (writes enabled)" : "MODE: dry-run (no writes)");
  console.log(`target: ${REDIS_URL.replace(/:[^:@/]+@/, ":***@")}`);

  const keys = await listRateKeys();
  const changes = [];
  const backups = [];
  const writes = [];

  for (const key of keys) {
    const rates = parseRecord(await redis.get(key));
    if (!rates || typeof rates !== "object" || Array.isArray(rates)) continue;

    let changed = false;
    const seeded = [];
    const next = {};
    for (const [id, rate] of Object.entries(rates)) {
      if (!rate || typeof rate !== "object") {
        next[id] = rate;
        continue;
      }
      const allowance = money(rate.totalSalary) - money(rate.monthlySalary);
      if (rate.allowanceExpr || allowance <= 0) {
        next[id] = rate;
        continue;
      }
      const allowanceExpr = String(money(allowance));
      next[id] = { ...rate, allowanceExpr };
      seeded.push({ id, name: rate.name ?? "(unnamed)", allowanceExpr });
      changed = true;
    }

    if (!changed) continue;

    changes.push({ key, employees: Object.keys(rates).length, seeded });
    if (APPLY) {
      backups.push({ key, value: rates });
      writes.push({ key, value: next });
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  if (APPLY && backups.length > 0) {
    const backupPath = resolve(
      process.cwd(),
      `scripts/logs/allowance-expression-migration-backup-${stamp}.json`,
    );
    writeFileSync(
      backupPath,
      JSON.stringify({ createdAt: new Date().toISOString(), records: backups }, null, 2),
    );
    console.log(`backup written before Redis writes: ${backupPath}`);
  }
  for (const write of writes) {
    await redis.set(write.key, JSON.stringify(write.value));
  }

  const logPath = resolve(
    process.cwd(),
    `scripts/logs/allowance-expression-migration-${APPLY ? "apply" : "dry-run"}-${stamp}.json`,
  );
  writeFileSync(
    logPath,
    JSON.stringify(
      {
        mode: APPLY ? "apply" : "dry-run",
        ranAt: new Date().toISOString(),
        keysScanned: keys.length,
        keysChanged: changes.length,
        rowsSeeded: changes.reduce((sum, change) => sum + change.seeded.length, 0),
        changes,
        ...(APPLY ? { backups } : {}),
      },
      null,
      2,
    ),
  );

  console.log(`scanned ${keys.length} employee_rates/* keys`);
  console.log(`keys ${APPLY ? "updated" : "that would change"}: ${changes.length}`);
  console.log(
    `rows seeded with allowanceExpr: ${changes.reduce((sum, c) => sum + c.seeded.length, 0)}`,
  );
  console.log(`log written: ${logPath}`);
  await redis.quit();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await redis.quit();
  } catch {
    // ignore cleanup errors
  }
  process.exit(1);
});
