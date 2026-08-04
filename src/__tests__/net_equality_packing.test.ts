 import { describe, expect, it } from "vitest";
 import { readFileSync } from "node:fs";
 import { join } from "node:path";
 import {
   OFFICIAL_WAGE_DAYS,
   assembleOfficialRow,
   buildOfficialRow,
   pickPackableAttendance,
   wageBoardCategory,
 } from "../officialSheet";
import { alignReferenceEsi, calculateSalary, clampBasicPercent, repairRates, roundMoney } from "../salary";
 import type { Category, EmployeeInput, SalaryRow } from "../types";
 import { juneEmployees } from "../juneEmployees";

 function refFrom(
   partial: EmployeeInput,
   monthDays = 30,
 ): SalaryRow {
   const share = clampBasicPercent(partial.basicPercent) / 100;
  const raw = calculateSalary(partial, { workingDays: monthDays, basicShare: share });
  const official = buildOfficialRow(raw, monthDays);
  return alignReferenceEsi(raw, official.esi, official.employerEsi);
 }

 /** Mulberry32 — deterministic PRNG for seeded fuzz. */
 function mulberry32(seed: number) {
   let t = seed >>> 0;
   return () => {
     t += 0x6d2b79f5;
     let r = Math.imul(t ^ (t >>> 15), 1 | t);
     r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
     return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
   };
 }

 function pick<T>(rng: () => number, items: T[]): T {
   return items[Math.floor(rng() * items.length)]!;
 }

 describe("TICKET-09: Official net computed never copied; unpackable packing", () => {
   it("does not assign netPayable from row.netPayable in officialSheet.ts", () => {
     const src = readFileSync(join(__dirname, "../officialSheet.ts"), "utf8");
     expect(src).not.toMatch(/netPayable\s*:\s*row\.netPayable/);
   });

   it("net is always recomputable from Official components (I2)", () => {
     const ref = refFrom({
       id: "i2",
       name: "I2 Worker",
       category: "Semi-skilled",
       monthlySalary: 18000,
       daysWorked: 28,
       extraDays: 1,
       basicPercent: 60,
       pfOptIn: true,
       esiOptIn: true,
       otherDeduction: 100,
       advance: 500,
     });
     const off = buildOfficialRow(ref, 30);
     const recomputed = roundMoney(
       off.grossPayable -
         off.pf -
         off.esi -
         off.professionalTax -
         (off.advance || 0) -
         off.otherDeduction,
     );
     expect(off.netPayable).toBe(recomputed);
     if (!off.unpackable) {
       expect(off.netPayable).toBeCloseTo(ref.netPayable, 2);
     }
   });

  it("packable rows keep net equality; components stay non-negative", () => {
     const fixtures: EmployeeInput[] = [
       {
         id: "p1",
         name: "Standard",
         category: "Skilled",
         monthlySalary: 20000,
         daysWorked: 30,
         extraDays: 0,
         basicPercent: 70,
         pfOptIn: true,
         esiOptIn: true,
         otherDeduction: 0,
       },
       {
         id: "p2",
         name: "BIDYUT-like",
         category: "Skilled",
         monthlySalary: 15990,
         bonusPerDay: 257,
         daysWorked: 30,
         extraDays: 0,
         basicPercent: 70,
         pfOptIn: true,
         esiOptIn: false,
         otherDeduction: 0,
       },
       {
         id: "p3",
         name: "Labour",
         category: "Unskilled",
         monthlySalary: 0,
         salaryPerDay: 450,
         bonusPerDay: 50,
         daysWorked: 26,
         extraDays: 0,
         basicPercent: 50,
         pfOptIn: true,
         esiOptIn: true,
         otherDeduction: 0,
       },
     ];

     for (const f of fixtures) {
       const ref = refFrom(f, 30);
       const off = buildOfficialRow(ref, 30);
       expect(off.unpackable).toBe(false);
       expect(off.netPayable).toBeCloseTo(ref.netPayable, 2);
       for (const v of [off.monthlyBasic, off.monthlyHra, off.monthlyTravelAllowance, off.bonus, off.grossPayable]) {
         expect(v).toBeGreaterThanOrEqual(0);
       }
    }
  });

  it("uses the Reference Performance Bonus as the Main floor without repacking attendance", () => {
    const ref = refFrom({
      id: "goutam",
      name: "Goutam Patra",
      category: "Skilled",
      monthlySalary: 35000,
      totalSalary: 48000,
      salaryPerDay: 1167,
      bonusPerDay: 433,
      daysWorked: 31,
      extraDays: 4,
      basicPercent: 70,
      pfOptIn: false,
      esiOptIn: false,
      otherDeduction: 0,
    }, 31);
    const off = buildOfficialRow(ref, 31);

    expect(off.unpackable).toBe(false);
    expect(off.attendance).toBe(26);
    expect(off.bonus).toBeGreaterThanOrEqual(ref.performanceBonus);
    expect(off.netPayable).toBeCloseTo(ref.netPayable, 2);
    expect(off.extraDays).toBe(4);
  });

  it("sets the Main bonus floor to zero when Extra Days is zero", () => {
    const ref = refFrom({
      id: "somnath",
      name: "Somnath Parui",
      category: "Unskilled",
      monthlySalary: 6600,
      salaryPerDay: 220,
      bonusPerDay: 10,
      daysWorked: 29,
      extraDays: 0,
      basicPercent: 70,
      pfOptIn: true,
      esiOptIn: true,
      otherDeduction: 0,
    });
    const off = buildOfficialRow(ref, 30);

    expect(ref.performanceBonus).toBe(0);
    expect(off.extraDays).toBe(0);
    expect(off.attendance).toBe(17);
    expect(off.bonus).toBeGreaterThanOrEqual(0);
  });

  it("when no A packs, unpackable is true, bonus is 0, net still from components", () => {
     // Low package + ₹21,100 ESI-off floor → targetGross < basic at every A.
     const ref = refFrom({
       id: "unp",
       name: "Unpackable Case",
       category: "Unskilled",
       monthlySalary: 0,
       salaryPerDay: 100,
       bonusPerDay: 0,
       daysWorked: 1,
       extraDays: 0,
       basicPercent: 50,
       pfOptIn: false,
       esiOptIn: false,
       otherDeduction: 0,
     });
     const off = buildOfficialRow(ref, 30);
     expect(off.unpackable).toBe(true);
     expect(off.bonus).toBe(0);
     expect(off.attendance).toBe(1); // aMin when Dw > 0
     const recomputed = roundMoney(
       off.grossPayable -
         off.pf -
         off.esi -
         off.professionalTax -
         (off.advance || 0) -
         off.otherDeduction,
     );
     expect(off.netPayable).toBe(recomputed);
     // Honest net may differ from Reference — that is the warning.
     expect(Math.abs(off.netPayable - ref.netPayable)).toBeGreaterThan(0.01);
   });

   it("pickPackableAttendance returns unpackable when nothing packs", () => {
     const ref = refFrom({
       id: "pick",
       name: "Pick",
       category: "Skilled",
       monthlySalary: 5000,
       daysWorked: 2,
       extraDays: 0,
       pfOptIn: false,
       esiOptIn: false,
       otherDeduction: 0,
     });
     const wage = wageBoardCategory(ref.category);
     const result = pickPackableAttendance(ref, wage, 26, 1);
     expect(result.unpackable).toBe(true);
     expect(result.attendance).toBe(1);
   });

   it("June NKPL roster: 0 unpackable rows; every row net-equal", () => {
     let unpackable = 0;
     for (const emp of juneEmployees) {
       const ref = refFrom(emp, 30);
       const off = buildOfficialRow(ref, 30);
       if (off.unpackable) unpackable += 1;
       else expect(off.netPayable).toBeCloseTo(ref.netPayable, 2);
       expect(off.attendance).toBeLessThanOrEqual(OFFICIAL_WAGE_DAYS);
     }
     expect(unpackable).toBe(0);
   });

   it("seeded fuzz: unpackable=false ⇒ |officialNet−referenceNet|≤0.01; all components ≥0", () => {
     const rng = mulberry32(7);
     const categories: Category[] = ["Unskilled", "Semi-skilled", "Skilled", "Special"];
     const N = 20_000;
     let unpackable = 0;
     let computed = 0;
     let i1 = 0;
     let i2 = 0;
     let i4 = 0;

     for (let i = 0; i < N; i += 1) {
       const D = pick(rng, [28, 29, 30, 31]);
       const category = pick(rng, categories);
       let salaryPerDay = rng() < 0.3 ? 0 : Math.floor(150 + rng() * 2850);
       let monthlySalary = rng() < 0.3 ? 0 : Math.floor(4000 + rng() * 116000);
       if (salaryPerDay === 0 && monthlySalary === 0) monthlySalary = 10000;

       const repaired = repairRates(category, monthlySalary, salaryPerDay, 0, D);
       if (repaired.missingRate) continue;

       const input: EmployeeInput = {
         id: `f-${i}`,
         name: `Fuzz ${i}`,
         category,
         monthlySalary: repaired.monthlySalary,
         salaryPerDay: repaired.salaryPerDay,
         bonusPerDay: rng() < 0.5 ? 0 : Math.floor(1 + rng() * 500),
         daysWorked: Math.floor(rng() * (D + 1)),
         extraDays: pick(rng, [0, 0, 0, 1, 2, 4]),
         basicPercent: pick(rng, [50, 54, 60, 70, 76, 100]),
         pfOptIn: rng() < 0.6,
         esiOptIn: rng() < 0.6,
         advance: pick(rng, [0, 0, 500, 1500, 20000]),
         otherDeduction: pick(rng, [0, 0, 100, 15000]),
         specialBonus: pick(rng, [0, 0, 0, 5000]),
       };

       const raw = calculateSalary(input, {
         workingDays: D,
         basicShare: clampBasicPercent(input.basicPercent) / 100,
       });
       if (raw.missingRate) continue;

       const off = buildOfficialRow(raw, D);
       const ref = alignReferenceEsi(raw, off.esi, off.employerEsi);
       computed += 1;
       if (off.unpackable) unpackable += 1;

       const recomputed = roundMoney(
         off.grossPayable -
           off.pf -
           off.esi -
           off.professionalTax -
           (off.advance || 0) -
           off.otherDeduction,
       );
       if (Math.abs(recomputed - off.netPayable) > 0.01) i2 += 1;

       if (!off.unpackable && Math.abs(off.netPayable - ref.netPayable) > 0.01) i1 += 1;

       if (
         Math.min(
           off.monthlyBasic,
           off.monthlyHra,
           off.monthlyTravelAllowance,
           off.bonus,
           off.grossPayable,
         ) < -1e-9
       ) {
         i4 += 1;
       }
     }

     // Report rate for the ticket AC.
     // eslint-disable-next-line no-console
     console.log(
       `fuzz N=${N} computed=${computed} unpackable=${unpackable} (${((100 * unpackable) / Math.max(1, computed)).toFixed(2)}%) I1=${i1} I2=${i2} I4=${i4}`,
     );

     expect(computed).toBeGreaterThan(1000);
     expect(i1).toBe(0);
     expect(i2).toBe(0);
     expect(i4).toBe(0);
   });

   it("assembleOfficialRow marks unpackable and forces bonus 0", () => {
     const ref = refFrom({
       id: "asm",
       name: "Assemble",
       category: "Unskilled",
       monthlySalary: 0,
       salaryPerDay: 250,
       daysWorked: 3,
       extraDays: 0,
       pfOptIn: false,
       esiOptIn: false,
       otherDeduction: 0,
     });
     const wage = wageBoardCategory(ref.category);
     const packed = assembleOfficialRow(ref, wage, 1, true);
     expect(packed.unpackable).toBe(true);
     expect(packed.bonus).toBe(0);
     expect(packed.netPayable).toBe(
       roundMoney(
         packed.grossPayable -
           packed.pf -
           packed.esi -
           packed.professionalTax -
           (packed.advance || 0) -
           packed.otherDeduction,
       ),
     );
   });
 });
