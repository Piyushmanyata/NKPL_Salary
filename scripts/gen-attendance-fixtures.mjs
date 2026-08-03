/**
 * Generate raw-row JSON fixtures from real attendance workbooks in .tmp-att/.
 * Run: node scripts/gen-attendance-fixtures.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as XLSX from "xlsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const tmp = path.join(root, ".tmp-att");
const outDir = path.join(root, "src", "__tests__", "fixtures");

const files = [
  {
    src: "ATTANDANCE 2026 (3).xlsx",
    sheet: "JULY 2026",
    out: "nkpl-july-2026-manual.json",
  },
  {
    src: "31AttendanceRecord.xls",
    sheet: "AttendanceRecord",
    out: "nkpl-july-2026-biometric.json",
  },
  {
    src: "Attendance sheet Daily Basis 2026-27.xlsx",
    sheet: "MAY",
    out: "aptus-may-2026-manual.json",
  },
  {
    src: "001_2026_5_MON.XLS",
    sheet: "Logs",
    out: "aptus-may-2026-biometric.json",
  },
];

fs.mkdirSync(outDir, { recursive: true });

for (const f of files) {
  const srcPath = path.join(tmp, f.src);
  if (!fs.existsSync(srcPath)) {
    console.error(`Missing source: ${srcPath}`);
    process.exit(1);
  }
  const buf = fs.readFileSync(srcPath);
  const workbook = XLSX.read(buf, { type: "buffer" });
  if (!workbook.SheetNames.includes(f.sheet)) {
    console.error(
      `Sheet "${f.sheet}" not in ${f.src}. Sheets: ${workbook.SheetNames.join(", ")}`
    );
    process.exit(1);
  }
  const sheet = workbook.Sheets[f.sheet];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    raw: true,
  });
  const outPath = path.join(outDir, f.out);
  fs.writeFileSync(outPath, JSON.stringify(rows));
  console.log(`Wrote ${f.out} (${rows.length} rows)`);
}

console.log("Done.");
