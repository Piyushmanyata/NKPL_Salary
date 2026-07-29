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
    month: "July 2026",
    days: 31,
    file: "SALARY OLD NKPL.xlsx",
    sheet: "ACTUAL (4)",
    nameCol: 2, // NKPL: C = NAME OF EMPLOYEE
  },
  {
    company: "APTUS",
    month: "July 2026",
    days: 31,
    file: "SALARY OLD APTUS.xlsx",
    sheet: "ACTUALL (4)",
    nameCol: 1, // APTUS: B = NAME OF EMPLOYEE
  },
];

const monthKeyFor = (t) => `monthly_salary/${t.company}/${t.month}`;
const rateKeyFor = (t) => `employee_rates/${t.company}`;

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

/** The workbooks have lived in both data/ and Excel/; take whichever exists. */
const WORKBOOK_DIRS = ["data", "Excel", "."];

function resolveWorkbook(file) {
  for (const dir of WORKBOOK_DIRS) {
    const path = resolve(process.cwd(), dir, file);
    if (existsSync(path)) return path;
  }
  throw new Error(`workbook not found in ${WORKBOOK_DIRS.join(", ")}: ${file}`);
}

function readWorkbook({ file, sheet, nameCol }) {
  const wb = XLSX.read(readFileSync(resolveWorkbook(file)));
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

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const monthKey = (label) => {
  const year = Number(String(label).match(/\b(20\d{2})\b/)?.[1]);
  const idx = MONTHS.findIndex((m) => String(label).toLowerCase().includes(m.slice(0, 3)));
  return idx < 0 || !Number.isFinite(year) ? Number.NaN : year * 12 + idx;
};

/** Most recent month for this company strictly before the target. */
async function latestMonthBefore(t) {
  const prefix = `monthly_salary/${t.company}/`;
  const keys = await redis.keys(`${prefix}*`);
  const target = monthKey(t.month);
  return (
    keys
      .map((k) => k.slice(prefix.length))
      .filter((m) => Number.isFinite(monthKey(m)) && monthKey(m) < target)
      .sort((a, b) => monthKey(a) - monthKey(b))
      .pop() ?? ""
  );
}

function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
}

/**
 * Names that nearly match — a payroll script must never merge these on a guess,
 * but silently dropping someone because of a one-character typo ("Champa" vs
 * "Chapa") is just as bad. Surface them and let a human decide.
 */
function nearMisses(name, candidates) {
  const a = norm(name);
  return candidates.filter((c) => {
    const b = norm(c);
    if (a === b) return false;
    return (
      a.includes(b) ||
      b.includes(a) ||
      editDistance(a, b) <= 2 ||
      (a.slice(0, 5) === b.slice(0, 5) && a.length > 4)
    );
  });
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
    const monthKey = monthKeyFor(t);
    const rateKey = rateKeyFor(t);
    let monthRaw = await redis.get(monthKey);
    const rateRaw = await redis.get(rateKey);

    // The month may not exist yet. Carry the roster forward from the most
    // recent month for this company, resetting the per-month attendance
    // inputs — the same rule App.tsx applies when you open a new month.
    if (!monthRaw) {
      const source = await latestMonthBefore(t);
      if (!source) {
        console.error(`${monthKey}: MISSING and no earlier month to carry from — skipping`);
        continue;
      }
      const src = JSON.parse(await redis.get(`monthly_salary/${t.company}/${source}`));
      const carried = {
        monthLabel: t.month,
        days: t.days,
        company: t.company,
        employees: src.employees.map((e) => {
          const { advance, specialBonus, ...rest } = e;
          return { ...rest, daysWorked: t.days, extraDays: 0 };
        }),
        updatedAt: new Date().toISOString(),
      };
      monthRaw = JSON.stringify(carried);
      console.log(`${monthKey}: created by carrying ${source} forward (attendance reset)`);
    }

    const month = JSON.parse(monthRaw);
    month.days = t.days;
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
      if (w) {
        matched.add(norm(e.name));
        const mNow = num(e.monthlySalary);
        const tNow = num(e.totalSalary);
        const aNow = tNow > mNow ? tNow - mNow : 0;
        if (mNow !== w.K || aNow !== w.N) {
          changes.push({ id: e.id, name: e.name, mNow, aNow, K: w.K, N: w.N });
          // Storage shape is unchanged (ADR-0004): totalSalary is the persisted
          // anchor and is dropped when it does not exceed monthlySalary.
          e.monthlySalary = w.K;
          if (w.N > 0) e.totalSalary = w.K + w.N;
          else delete e.totalSalary;
        }
      }

      // The rate card is what the app overlays onto every month, so it must
      // carry M and T for every employee on this roster — not just the ones the
      // workbook moved, and not only where an entry already existed.
      rates[e.id] = {
        ...(rates[e.id] ?? {}),
        id: e.id,
        name: e.name,
        salaryPerDay: num(rates[e.id]?.salaryPerDay ?? e.salaryPerDay),
        bonusPerDay: num(rates[e.id]?.bonusPerDay ?? e.bonusPerDay),
        monthlySalary: num(e.monthlySalary),
        totalSalary: num(e.totalSalary) > num(e.monthlySalary) ? num(e.totalSalary) : 0,
      };
    }

    // A rate card belongs to one company; drop anyone not on this roster so a
    // cross-company contamination cannot survive a re-run.
    const rosterIds = new Set(month.employees.map((e) => e.id));
    for (const id of Object.keys(rates)) {
      if (!rosterIds.has(id)) delete rates[id];
    }

    console.log(`\n${monthKey}  (${month.employees.length} employees, days=${month.days})`);
    if (!changes.length) console.log("  no changes — already matches the workbook");
    for (const c of changes) {
      console.log(
        `  ${c.id.padEnd(7)} ${c.name.padEnd(24)} M ${String(c.mNow).padStart(9)} -> ${String(c.K).padStart(7)}   allowance ${String(c.aNow).padStart(6)} -> ${String(c.N).padStart(6)}`,
      );
    }

    const unmatched = [...wb.values()].filter((w) => !matched.has(norm(w.name)));
    if (unmatched.length) {
      const roster = month.employees.map((e) => e.name);
      console.log("  in workbook, no matching employee (NOT added):");
      for (const w of unmatched) {
        const near = nearMisses(w.name, roster);
        console.log(
          `    r${w.row} ${w.name}  K=${w.K} N=${w.N}` +
            (near.length ? `   <-- looks like "${near.join('", "')}" — confirm before merging` : ""),
        );
      }
    }

    if (!DRY) {
      mkdirSync("scripts/logs", { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      writeFileSync(
        `scripts/logs/backup-${t.company}-${stamp}.json`,
        JSON.stringify(
          {
            [monthKey]: JSON.parse((await redis.get(monthKey)) ?? "null"),
            [rateKey]: JSON.parse(rateRaw ?? "{}"),
          },
          null,
          2,
        ),
      );
      month.updatedAt = new Date().toISOString();
      await redis.set(monthKey, JSON.stringify(month));
      await redis.set(rateKey, JSON.stringify(rates));
      console.log(`  wrote ${monthKey} and ${rateKey} (backup in scripts/logs/)`);
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
