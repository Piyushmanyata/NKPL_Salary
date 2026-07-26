/**
 * Offline verification for TICKET-06 engine clamp (no Redis required).
 * Run: npx tsx scripts/_verify-advance.mjs
 */
import { calculateSalary } from "../src/salary.ts";
import { juneEmployees } from "../src/juneEmployees.ts";

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("OK:", msg);
}

const ashok = juneEmployees.find((e) => e.name === "Ashok Ram");
assert(ashok, "Ashok Ram present in juneEmployees");
assert(ashok.advance === 1500, "bundled June advance already positive (1500)");

const base = { ...ashok, workingDays: 30 };
const pos = calculateSalary({ ...base, advance: 1500 });
const neg = calculateSalary({ ...base, advance: -1500 });
const zero = calculateSalary({ ...base, advance: 0 });

const redPos = Number((zero.netPayable - pos.netPayable).toFixed(2));
const redNeg = Number((zero.netPayable - neg.netPayable).toFixed(2));

assert(redPos === 1500, `advance:1500 reduces net by 1500 (got ${redPos})`);
// Spec §2.4: negative input is clamped to 0 — must NOT *add* to net.
assert(redNeg === 0, `advance:-1500 clamps to 0 (no add); reduction=${redNeg}`);
assert(pos.advance === 1500, `SalaryRow.advance for +1500 is 1500 (got ${pos.advance})`);
assert(neg.advance === 0, `SalaryRow.advance for -1500 is 0 (got ${neg.advance})`);
assert(pos.advance >= 0 && neg.advance >= 0, "SalaryRow.advance always >= 0");

// Spot-check other June advances are non-negative in bundled data
const negatives = juneEmployees.filter((e) => e.advance != null && Number(e.advance) < 0);
assert(negatives.length === 0, "juneEmployees has no negative advances");

console.log("\nAshok figures (current engine, ESI-on-gross):");
console.log({
  gross: pos.grossPayable,
  pf: pos.employeePf,
  esi: pos.esi,
  ptax: pos.professionalTax,
  advance: pos.advance,
  net: pos.netPayable,
});
console.log("\n*** TICKET-06 offline engine checks passed ***");
