/**
 * Remove retired attendance-checker fields from stored payroll month records.
 *
 * This migration preserves every monthly_salary/* key and every employee row.
 * It only removes fields that are no longer part of EmployeeInput:
 * isSecurity, performanceBonus, officialAttendance, and officialBonus.
 * Raw legacy attendance keys are intentionally left untouched for historical
 * recovery and are no longer read by the application.
 *
 * Usage:
 *   node scripts/migrate-remove-attendance-fields.mjs          # dry-run
 *   node scripts/migrate-remove-attendance-fields.mjs --apply  # write changes
 *
 * Requires REDIS_URL in the environment or .env.local.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import Redis from "ioredis";

const APPLY = process.argv.includes("--apply");
const RETIRED_FIELDS = ["isSecurity", "performanceBonus", "officialAttendance", "officialBonus"];

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

function removeRetiredFields(employee) {
  if (!employee || typeof employee !== "object" || Array.isArray(employee)) {
    return { employee, removed: [] };
  }

  const next = { ...employee };
  const removed = [];
  for (const field of RETIRED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(next, field)) {
      delete next[field];
      removed.push(field);
    }
  }
  return { employee: next, removed };
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
    const removed = new Set();
    const employees = data.employees.map((employee) => {
      const result = removeRetiredFields(employee);
      if (result.removed.length > 0) {
        changed = true;
        result.removed.forEach((field) => removed.add(field));
      }
      return result.employee;
    });

    if (!changed) continue;

    changes.push({
      key,
      company: data.company ?? "(legacy)",
      month: data.monthLabel ?? key,
      employeeRows: data.employees.length,
      fields: [...removed].sort(),
    });

    if (APPLY) {
      backups.push({ key, value: data });
      writes.push({ key, value: { ...data, employees } });
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  if (APPLY && backups.length > 0) {
    const backupPath = resolve(
      process.cwd(),
      `scripts/logs/attendance-field-migration-backup-${stamp}.json`,
    );
    writeFileSync(
      backupPath,
      JSON.stringify(
        { createdAt: new Date().toISOString(), records: backups },
        null,
        2,
      ),
    );
    console.log(`backup written before Redis writes: ${backupPath}`);
  }
  for (const write of writes) {
    await redis.set(write.key, JSON.stringify(write.value));
  }

  const logPath = resolve(
    process.cwd(),
    `scripts/logs/attendance-field-migration-${APPLY ? "apply" : "dry-run"}-${stamp}.json`,
  );
  const log = {
    mode: APPLY ? "apply" : "dry-run",
    ranAt: new Date().toISOString(),
    keysScanned: keys.length,
    recordsChanged: changes.length,
    fields: RETIRED_FIELDS,
    changes,
    ...(APPLY ? { backups } : {}),
  };
  writeFileSync(logPath, JSON.stringify(log, null, 2));

  console.log(`scanned ${keys.length} monthly_salary/* keys`);
  console.log(`records ${APPLY ? "updated" : "that would change"}: ${changes.length}`);
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
