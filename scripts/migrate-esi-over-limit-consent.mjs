/**
 * Reconcile the two ESI flags on stored month records.
 *
 * A row that was switched on above the ₹21,000 package limit carries
 * `esiOverLimitOptIn: true`, but could still be holding `esiOptIn: false` left
 * over from when such rows were forced off. The engine now ignores that stale
 * flag over the limit (ADR-0011), so this changes no pay figure today — it
 * stops the row from silently turning ESI off if the package ever drops back
 * under ₹21,000, where esiOptIn governs again.
 *
 * Only `esiOptIn: false -> true` on rows that already have
 * `esiOverLimitOptIn === true`. Nothing else is touched.
 *
 * Usage:
 *   node scripts/migrate-esi-over-limit-consent.mjs          # dry-run
 *   node scripts/migrate-esi-over-limit-consent.mjs --apply  # write changes
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

async function listSalaryKeys() {
  const keys = [];
  let cursor = "0";
  do {
    const [next, batch] = await redis.scan(cursor, "MATCH", "monthly_salary/*", "COUNT", 200);
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

  const keys = await listSalaryKeys();
  const changes = [];
  const backups = [];
  const writes = [];

  for (const key of keys) {
    const data = parseRecord(await redis.get(key));
    if (!data || !Array.isArray(data.employees)) continue;

    let changed = false;
    const reconciled = [];
    const employees = data.employees.map((employee) => {
      if (
        !employee ||
        typeof employee !== "object" ||
        employee.esiOverLimitOptIn !== true ||
        employee.esiOptIn !== false
      ) {
        return employee;
      }
      changed = true;
      reconciled.push({ id: employee.id, name: employee.name ?? "(unnamed)" });
      return { ...employee, esiOptIn: true };
    });

    if (!changed) continue;

    changes.push({ key, employeeRows: data.employees.length, reconciled });
    if (APPLY) {
      backups.push({ key, value: data });
      writes.push({ key, value: { ...data, employees } });
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  if (APPLY && backups.length > 0) {
    const backupPath = resolve(
      process.cwd(),
      `scripts/logs/esi-over-limit-consent-backup-${stamp}.json`,
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
    `scripts/logs/esi-over-limit-consent-${APPLY ? "apply" : "dry-run"}-${stamp}.json`,
  );
  writeFileSync(
    logPath,
    JSON.stringify(
      {
        mode: APPLY ? "apply" : "dry-run",
        ranAt: new Date().toISOString(),
        keysScanned: keys.length,
        keysChanged: changes.length,
        rowsReconciled: changes.reduce((sum, change) => sum + change.reconciled.length, 0),
        changes,
        ...(APPLY ? { backups } : {}),
      },
      null,
      2,
    ),
  );

  console.log(`scanned ${keys.length} monthly_salary/* keys`);
  console.log(`keys ${APPLY ? "updated" : "that would change"}: ${changes.length}`);
  console.log(
    `rows reconciled: ${changes.reduce((sum, c) => sum + c.reconciled.length, 0)}`,
  );
  for (const change of changes) {
    for (const row of change.reconciled) {
      console.log(`  ${change.key} :: ${row.name}`);
    }
  }
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
