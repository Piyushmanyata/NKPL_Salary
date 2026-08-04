/**
 * Remove the retired `allowanceExpr` field from the stored employee rate
 * records.
 *
 * The allowance-as-a-sum experiment ("400+500+600") was replaced by a free-text
 * `notes` field per employee, which is where increments are recorded now. This
 * migration only DELETES allowanceExpr — salaryPerDay, bonusPerDay,
 * monthlySalary and totalSalary are left untouched, so no pay figure moves.
 *
 * Usage:
 *   node scripts/migrate-drop-allowance-expression.mjs          # dry-run
 *   node scripts/migrate-drop-allowance-expression.mjs --apply  # write changes
 *
 * Requires REDIS_URL in the environment or .env.local.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import Redis from "ioredis";

const APPLY = process.argv.includes("--apply");
const RETIRED_FIELD = "allowanceExpr";

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
    const cleared = [];
    const next = {};
    for (const [id, rate] of Object.entries(rates)) {
      if (
        !rate ||
        typeof rate !== "object" ||
        !Object.prototype.hasOwnProperty.call(rate, RETIRED_FIELD)
      ) {
        next[id] = rate;
        continue;
      }
      const { [RETIRED_FIELD]: dropped, ...rest } = rate;
      next[id] = rest;
      cleared.push({ id, name: rate.name ?? "(unnamed)", dropped });
      changed = true;
    }

    if (!changed) continue;

    changes.push({ key, employees: Object.keys(rates).length, cleared });
    if (APPLY) {
      backups.push({ key, value: rates });
      writes.push({ key, value: next });
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  if (APPLY && backups.length > 0) {
    const backupPath = resolve(
      process.cwd(),
      `scripts/logs/drop-allowance-expression-backup-${stamp}.json`,
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
    `scripts/logs/drop-allowance-expression-${APPLY ? "apply" : "dry-run"}-${stamp}.json`,
  );
  writeFileSync(
    logPath,
    JSON.stringify(
      {
        mode: APPLY ? "apply" : "dry-run",
        ranAt: new Date().toISOString(),
        keysScanned: keys.length,
        keysChanged: changes.length,
        rowsCleared: changes.reduce((sum, change) => sum + change.cleared.length, 0),
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
    `rows cleared of ${RETIRED_FIELD}: ${changes.reduce((sum, c) => sum + c.cleared.length, 0)}`,
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
