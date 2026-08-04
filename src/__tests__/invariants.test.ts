 /**
  * TICKET-14 — property suite over I1–I10 (SPEC-payroll.md §7).
  * Mirrors scripts/reference-oracle.py fuzz (seed=7, N=200_000).
  */
 import { describe, expect, it } from "vitest";
 import { buildOfficialRow } from "../officialSheet";
 import {
   calculateSalary,
   clampBasicPercent,
   isSpecialCategory,
   repairRates,
   roundMoney,
 } from "../salary";
 import type { Category, EmployeeInput } from "../types";

 const N = 200_000;
 const SEED = 7;
 const OFFICIAL_WAGE_DAYS = 26;

 /** Mulberry32 — deterministic PRNG (same family as net_equality_packing fuzz). */
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

 function randInt(rng: () => number, lo: number, hi: number): number {
   return lo + Math.floor(rng() * (hi - lo + 1));
 }

 describe("TICKET-14: invariants I1–I10 over 200k seeded cases", () => {
   it(
     "0 violations of I1–I10; reports unpackable rate",
     () => {
       const rng = mulberry32(SEED);
       const categories: Category[] = ["Unskilled", "Semi-skilled", "Skilled", "Special"];
       const v: Record<string, number> = {
         I1: 0,
         I2: 0,
         I3: 0,
         I4: 0,
         I5: 0,
         I6: 0,
         I7: 0,
         I8: 0,
         I9: 0,
         I10: 0,
       };
       let unpackable = 0;
       let missing = 0;
       let computed = 0;

       for (let i = 0; i < N; i += 1) {
         const D = pick(rng, [28, 29, 30, 31]);
         const category = pick(rng, categories);
         let salaryPerDay = pick(rng, [0 as number, randInt(rng, 150, 3000)]);
         let monthlySalary = pick(rng, [0 as number, randInt(rng, 4000, 120000)]);
         if (salaryPerDay === 0 && monthlySalary === 0) monthlySalary = 10000;

         const bonusPerDay = pick(rng, [0 as number, randInt(rng, 1, 500)]);
         const repaired = repairRates(category, monthlySalary, salaryPerDay, bonusPerDay, D);
         if (repaired.missingRate) {
           missing += 1;
           continue;
         }

         const input: EmployeeInput = {
           id: `inv-${i}`,
           name: `Inv ${i}`,
           category,
           monthlySalary: repaired.monthlySalary,
           salaryPerDay: repaired.salaryPerDay,
           bonusPerDay: repaired.bonusPerDay,
           daysWorked: randInt(rng, 0, D),
           extraDays: pick(rng, [0, 0, 0, 1, 2, 4, 8]),
           basicPercent: pick(rng, [50, 54, 60, 70, 76, 100]),
           pfOptIn: rng() < 0.6,
           esiOptIn: rng() < 0.6,
           // include negative to prove clamp (oracle does the same)
           advance: pick(rng, [0, 0, 500, 1500, -1500, 20000]),
           otherDeduction: pick(rng, [0, 0, 100, 15000]),
           specialBonus: pick(rng, [0, 0, 0, 5000]),
         };

         const share = clampBasicPercent(input.basicPercent) / 100;
         const ref = calculateSalary(input, { workingDays: D, basicShare: share });
         if (ref.missingRate) {
           missing += 1;
           continue;
         }

         const off = buildOfficialRow(ref, D);
         computed += 1;
         if (off.unpackable) unpackable += 1;

         // I1 — packable ⇒ nets equal
         if (!off.unpackable && Math.abs(off.netPayable - ref.netPayable) > 0.01) {
           v.I1 += 1;
         }

         // I2 — official net recomputable from Official components
         const recomputed = roundMoney(
           off.grossPayable -
             off.pf -
             off.esi -
             off.professionalTax -
             (off.advance || 0) -
             off.otherDeduction,
         );
         if (Math.abs(recomputed - off.netPayable) > 0.01) v.I2 += 1;

         // I3 — attendance in [0, 26]
         if (off.attendance < 0 || off.attendance > OFFICIAL_WAGE_DAYS) v.I3 += 1;

         // I4 — non-negative components
         if (
           Math.min(
             off.monthlyBasic,
             off.monthlyHra,
             off.monthlyTravelAllowance,
             off.bonus,
             off.grossPayable,
             ref.basicSalary,
             ref.hra,
             ref.travelAllowance,
             ref.grossPayable,
           ) < -1e-9
         ) {
           v.I4 += 1;
         }

         // I5 — Special forces full attendance, zero statutory
         if (category === "Special") {
           if (
             !(
               ref.daysWorked === D &&
               ref.absentDays === 0 &&
               ref.extraDays === 0 &&
               ref.employeePf === 0 &&
               ref.esi === 0 &&
               off.pf === 0 &&
               off.esi === 0
             )
           ) {
             v.I5 += 1;
           }
         }

          // I6 — Special never earns extra-day performance.
         if (isSpecialCategory(ref.category) && !(ref.extraDays === 0 && ref.performanceBonus === 0)) {
           v.I6 += 1;
         }

         // I7 — present days with anchor ⇒ non-zero gross
         if (ref.daysWorked > 0 && ref.grossPayable === 0) v.I7 += 1;

         // I8 — PF and ESI independent: ESI opt-out is not overridden by PF on
         if (input.esiOptIn === false && category !== "Special" && (ref.esi > 0 || off.esi > 0)) {
           v.I8 += 1;
         }
         if (input.pfOptIn === false && category !== "Special" && ref.employeePf > 0) {
           // PF may auto-off for high basic; when user opts out it must stay 0
           v.I8 += 1;
         }
         if (ref.pfOptIn && !ref.esiOptIn && off.esi > 0) v.I8 += 1;

         // I9 — category preserved end-to-end
         if (ref.category !== category || off.sourceCategory !== category) v.I9 += 1;

         // I10 — M invariant for fixed-monthly categories when D changes (sample 5%)
         if (i % 20 === 0) {
           const a = calculateSalary(input, { workingDays: 28, basicShare: share });
           const b = calculateSalary(input, { workingDays: 31, basicShare: share });
           if (category === "Semi-skilled" || category === "Skilled" || category === "Special") {
             if (Math.abs(a.monthlySalary - b.monthlySalary) > 0.01) v.I10 += 1;
           } else if (Math.abs(b.monthlySalary - (a.monthlySalary * 31) / 28) > 1.0) {
             v.I10 += 1;
           }
         }
       }

       const rate = (100 * unpackable) / Math.max(1, computed);
       // eslint-disable-next-line no-console
       console.log(
         `invariants N=${N} computed=${computed} missingRate=${missing} unpackable=${unpackable} (${rate.toFixed(2)}%) ` +
           Object.entries(v)
             .map(([k, n]) => `${k}=${n}`)
             .join(" "),
       );

       expect(computed).toBeGreaterThan(100_000);
       expect(v.I1).toBe(0);
       expect(v.I2).toBe(0);
       expect(v.I3).toBe(0);
       expect(v.I4).toBe(0);
       expect(v.I5).toBe(0);
       expect(v.I6).toBe(0);
       expect(v.I7).toBe(0);
       expect(v.I8).toBe(0);
       expect(v.I9).toBe(0);
       expect(v.I10).toBe(0);
     },
     120_000,
   );
 });
