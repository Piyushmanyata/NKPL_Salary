/**
 * One-shot: recompute June golden-master expected rows from the live engine.
 * Run: node --import tsx scripts/gen-golden-fixtures.mjs
 *
 * Expectations are derived from the SPEC-aligned TS engine (not the stale
 * 2026-07-07 .xls exports). Review any intentional money change before
 * re-committing the JSON under src/__tests__/fixtures/.
 */
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { juneEmployees } from "../src/juneEmployees.ts";
import { alignReferenceEsi, calculateSalary, clampBasicPercent, roundMoney } from "../src/salary.ts";
import { buildOfficialRow } from "../src/officialSheet.ts";

mkdirSync("src/__tests__/fixtures", { recursive: true });

function goldenRow(emp, D = 30) {
  const share = clampBasicPercent(emp.basicPercent) / 100;
  const raw = calculateSalary(emp, { workingDays: D, basicShare: share });
  if (raw.missingRate) {
    throw new Error(`missingRate for ${emp.name}`);
  }
  const off = buildOfficialRow(raw, D);
  const ref = alignReferenceEsi(raw, off.esi, off.employerEsi);
  return {
    id: emp.id,
    name: emp.name,
    category: emp.category,
    reference: {
      daysWorked: ref.daysWorked,
      monthlySalary: roundMoney(ref.monthlySalary),
      salaryPerDay: roundMoney(ref.salaryPerDay),
      earnedSalary: roundMoney(ref.earnedSalary),
      basicSalary: roundMoney(ref.basicSalary),
      hra: roundMoney(ref.hra),
      travelAllowance: roundMoney(ref.travelAllowance),
      performanceBonus: roundMoney(ref.performanceBonus),
      grossPayable: roundMoney(ref.grossPayable),
      employeePf: roundMoney(ref.employeePf),
      esi: roundMoney(ref.esi),
      professionalTax: ref.professionalTax,
      advance: ref.advance ?? 0,
      otherDeduction: ref.otherDeduction,
      netPayable: roundMoney(ref.netPayable),
      pfOptIn: ref.pfOptIn,
      esiOptIn: ref.esiOptIn,
    },
    official: {
      attendance: off.attendance,
      monthlyBasic: off.monthlyBasic,
      monthlyHra: off.monthlyHra,
      monthlyTravelAllowance: off.monthlyTravelAllowance,
      bonus: off.bonus,
      grossPayable: off.grossPayable,
      pf: off.pf,
      esi: off.esi,
      professionalTax: off.professionalTax,
      advance: off.advance ?? 0,
      otherDeduction: off.otherDeduction,
      netPayable: off.netPayable,
      unpackable: off.unpackable,
    },
  };
}

const nkpl = juneEmployees.map((e) => goldenRow(e, 30));
const aptusInputs = JSON.parse(
  readFileSync("src/__tests__/fixtures/aptus-june-inputs.json", "utf8"),
);
const aptus = aptusInputs.map((e) => goldenRow(e, 30));

const summary = {
  nkpl: {
    n: nkpl.length,
    unpackable: nkpl.filter((r) => r.official.unpackable).length,
    netTotal: roundMoney(nkpl.reduce((s, r) => s + r.reference.netPayable, 0)),
  },
  aptus: {
    n: aptus.length,
    unpackable: aptus.filter((r) => r.official.unpackable).length,
    netTotal: roundMoney(aptus.reduce((s, r) => s + r.reference.netPayable, 0)),
  },
};
console.log(JSON.stringify(summary, null, 2));

writeFileSync(
  "src/__tests__/fixtures/golden-nkpl-june-2026.json",
  JSON.stringify({ monthDays: 30, roster: "juneEmployees", rows: nkpl }, null, 2),
);
writeFileSync(
  "src/__tests__/fixtures/golden-aptus-june-2026.json",
  JSON.stringify({ monthDays: 30, roster: "aptus-june-inputs", rows: aptus }, null, 2),
);
console.log("wrote golden-nkpl-june-2026.json and golden-aptus-june-2026.json");
