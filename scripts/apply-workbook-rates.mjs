/**
 * Apply Monthly Salary (`K`) and Monthly Allowance (`N`) from a Source Workbook
 * sheet onto a month record in Redis, plus the shared rate card.
 *
 *   node --import tsx scripts/apply-workbook-rates.mjs --dry-run
 *   node --import tsx scripts/apply-workbook-rates.mjs
 *
 * Why both keys: `applyEmployeeRates` in App.tsx overlays `employee_rates/<CO>`
 * on top of whatever month snapshot was loaded, so writing the month record
 * alone is silently reverted on the next page load. The rate card is the
 * authoritative store for M and T; the month record is a snapshot.
 *
 * Only the fixed-monthly rows are touched. The workbook's grade rows (`I` =
 * A/B/C/D) type `L` and `M` directly and carry no `K`/`N` — those are Labour,
 * whose day-rate anchoring already matches (ADR-0004 / issue #24).
 *
 * A timestamped backup of every key it writes is dropped in scripts/logs/.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import Redis from "ioredis";
import * as XLSX from "xlsx";

const TARGETS = [
  {
    company: "NKPL",
    monthKey: "monthly_salary/NKPL/July 2026",
    rateKey: "employee_rates/NKPL",
    file: "Excel/SALARY OLD NKPL.xlsx",
    sheet: "ACTUAL (4)",
    nameCol: 2, // NKPL: C = NAME OF EMPLOYEE
  },
];

// Workbook column map, 0-indexed. Identical across both workbooks.
const COL_TOTAL = 9; //  J — TOTAL Salary P.M (typed; see the J != K+N check)
const COL_SALARY = 10; // K — Salary P.M            -> Monthly Salary
const COL_INCREASE = 13; // N — Increase in Salary Amount -> Monthly Allowance

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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Names differ in case, spacing and "(Security)" suffixes across the two sources. */
const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z]/g, "");

function readWorkbook({ file, sheet, nameCol }) {
  const wb = XLSX.read(readFileSync(file));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], {
    header: 1,
    raw: true,
    defval: null,
  });
  const out = new Map();
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i] || [];
    const name = String(r[nameCol] ?? "").trim();
    if (!name || /^total/i.test(name)) continue;
    const K = num(r[COL_SALARY]);
    const N = num(r[COL_INCREASE]);
    const J = num(r[COL_TOTAL]);
    // Grade rows carry no K and no J — they anchor on L/M and are out of scope.
    if (K <= 0 && J <= 0) continue;
    out.set(norm(name), { row: i + 1, name, K, N, J });
  }
  return out;
}

loadEnvLocal();
const DRY = process.argv.includes("--dry-run");
const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) {
  console.error("REDIS_URL not set");
  process.exit(1);
}

const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 2, connectTimeout: 15_000 });

async function main() {
  console.log(DRY ? "MODE: dry-run" : "MODE: apply");
  console.log(`target: ${REDIS_URL.replace(/:[^:@/]+@/, ":***@")}\n`);

  for (const t of TARGETS) {
    const wb = readWorkbook(t);
    const monthRaw = await redis.get(t.monthKey);
    const rateRaw = await redis.get(t.rateKey);
    if (!monthRaw) {
      console.error(`${t.monthKey}: MISSING — skipping`);
      continue;
    }
    const month = JSON.parse(monthRaw);
    const rates = rateRaw ? JSON.parse(rateRaw) : {};

    // Workbook rows whose typed J disagrees with K + N. J is a typed constant on
    // these sheets, not a formula, so it goes stale; K and N are what the app
    // stores. Report loudly, apply K/N.
    for (const w of wb.values()) {
      if (Math.abs(w.J - (w.K + w.N)) > 0.51) {
        console.log(
          `  !! ${t.sheet} r${w.row} ${w.name}: typed J=${w.J} != K+N=${w.K + w.N} — applying K/N, verify this row`,
        );
      }
    }

    const matched = new Set();
    const changes = [];
    for (const e of month.employees) {
      const w = wb.get(norm(e.name));
      if (!w) continue;
      matched.add(norm(e.name));

      const mNow = num(e.monthlySalary);
      const tNow = num(e.totalSalary);
      const aNow = tNow > mNow ? tNow - mNow : 0;
      if (mNow === w.K && aNow === w.N) continue;

      changes.push({ id: e.id, name: e.name, mNow, aNow, K: w.K, N: w.N });

      // Storage shape is unchanged (ADR-0004): totalSalary is the persisted
      // anchor and is dropped when it does not exceed monthlySalary.
      e.monthlySalary = w.K;
      if (w.N > 0) e.totalSalary = w.K + w.N;
      else delete e.totalSalary;

      const rate = rates[e.id];
      if (rate) {
        rate.monthlySalary = w.K;
        rate.totalSalary = w.N > 0 ? w.K + w.N : 0;
      }
    }

    console.log(`\n${t.monthKey}  (${month.employees.length} employees, days=${month.days})`);
    if (!changes.length) console.log("  no changes — already matches the workbook");
    for (const c of changes) {
      console.log(
        `  ${c.id.padEnd(7)} ${c.name.padEnd(24)} M ${String(c.mNow).padStart(9)} -> ${String(c.K).padStart(7)}   allowance ${String(c.aNow).padStart(6)} -> ${String(c.N).padStart(6)}`,
      );
    }

    const unmatched = [...wb.values()].filter((w) => !matched.has(norm(w.name)));
    if (unmatched.length) {
      console.log("  in workbook, no matching employee (NOT added):");
      for (const w of unmatched) console.log(`    r${w.row} ${w.name}  K=${w.K} N=${w.N}`);
    }

    if (!DRY && changes.length) {
      mkdirSync("scripts/logs", { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      writeFileSync(
        `scripts/logs/backup-${t.company}-${stamp}.json`,
        JSON.stringify({ [t.monthKey]: JSON.parse(monthRaw), [t.rateKey]: JSON.parse(rateRaw ?? "{}") }, null, 2),
      );
      month.updatedAt = new Date().toISOString();
      await redis.set(t.monthKey, JSON.stringify(month));
      if (rateRaw) await redis.set(t.rateKey, JSON.stringify(rates));
      console.log(`  wrote ${t.monthKey}${rateRaw ? ` and ${t.rateKey}` : ""} (backup in scripts/logs/)`);
    }
  }

  await redis.quit();
  console.log(DRY ? "\ndry-run complete" : "\napply complete");
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
