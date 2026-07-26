# TICKET-09 — Official net must be computed, never copied; add attendance walk-down and an `unpackable` flag

**Type:** bug / correctness · **Priority:** P0 · **Blocks:** 14
**Blocked by:** 07, 08 · **Spec:** SPEC-payroll.md §6.5, §6.6

## Current behaviour

`officialSheet.ts:180`, in `buildReferenceOfficialRow`:

```ts
return {
  ...
  netPayable: row.netPayable,              // ← copied from Reference, never verified
  referenceNetPayable: row.netPayable,
};
```

The row's own components (`monthlyBasic`, `monthlyHra`, `monthlyTravelAllowance`, `bonus`,
`pf`, `esi`) are computed independently. When they do not reconcile, the sheet prints a net
that its own arithmetic does not produce.

The reconciliation breaks whenever `targetGross < monthlyBasic`. At `:137` and `:140`:

```ts
const remainingForHraTa = isOptOut ? Math.max(0, targetGross - monthlyBasic) : ...;
const bonus = isOptOut ? 0 : Math.max(0, roundMoney(targetGross - (...)));
```

Both clamp to `0`, so `grossPayable` collapses to `monthlyBasic` — a value **larger** than
`targetGross` — and the shortfall is absorbed silently by the copied `netPayable`.

**Measured over 200,000 randomly generated valid inputs:**

| Failure | Count | Rate |
|---|---|---|
| `officialNet ≠ referenceNet` | 33,954 | **17.0%** |
| Reported net ≠ net implied by the row's own components | 26,276 | **13.1%** |
| Negative component | 0 | 0% |

Worked failure: `{Unskilled, M:38438, r:0, b:75, Dw:17, D:29, pf:off, esi:on}` →
Reference net `6,227.94`; Official components yield `8,785.33`; the sheet **prints `6,227.94`**.
A ₹2,557 discrepancy, invisible.

The current June rosters happen not to trigger it. That is luck, not correctness.

## Required behaviour

1. `officialNet` is always computed from the row's own components.
2. Before assembling, search for an attendance value that packs.
3. If none packs, flag the row and block export. Never print an unverifiable net.

## Changes

**`src/officialSheet.ts`** — add to `OfficialRow`: `unpackable: boolean`.

```ts
function pickPackableAttendance(row, wageCategory, aMax, aMin): { attendance: number; unpackable: boolean } {
  for (let A = aMax; A >= aMin; A--) {
    const basic  = officialBasicForAttendance(row, wageCategory, A);
    const pf     = officialPf(row, basic);
    const esi    = officialEsi(row, basic);
    const target = row.netPayable + pf + esi + row.professionalTax + row.advance + row.otherDeduction;
    if (target >= basic) return { attendance: A, unpackable: false };
  }
  return { attendance: aMin, unpackable: true };
}
```

Note this replaces the existing loop condition at `:228`:

```ts
if ((candidateGross >= candidateProratedTotalSalary && candidateGross >= candidateBasic) || candidate === minCandidate)
```

The `candidateGross >= candidateProratedTotalSalary` clause is dropped — it is not required
for packability and it needlessly walks attendance down, understating the register.

**Component split** (replaces `calculateStatutoryComponents:132-143`):

```ts
const basic          = officialBasicForAttendance(row, wageCategory, A);
const pf             = officialPf(row, basic);
const esi            = officialEsi(row, basic);
const targetGross    = row.netPayable + pf + esi + row.professionalTax + row.advance + row.otherDeduction;
const proratedTotal26= roundMoney((row.totalSalary / OFFICIAL_WAGE_DAYS) * A);
const base           = Math.min(proratedTotal26, targetGross);

const remainder = Math.max(0, base - basic);
const hra       = roundMoney(remainder * HRA_SHARE_OF_BALANCE);
const ta        = roundMoney(remainder - hra);
const bonus     = roundMoney(targetGross - (basic + hra + ta));      // >= 0 when packable
const gross     = roundMoney(basic + hra + ta + bonus);
const netPayable= roundMoney(gross - pf - esi - row.professionalTax - row.advance - row.otherDeduction);
```

`bonus >= 0` is guaranteed: packability gives `targetGross >= basic`, and `base <= targetGross`
gives `remainder <= targetGross − basic`. Assert it in dev builds.

**`src/App.tsx`**

- Official sheet table: render an `unpackable` row with a warning badge and a tooltip showing
  `referenceNet` vs `officialNet`.
- Export handlers (`:1034`): refuse to export when any row is `unpackable`; show a toast
  naming the affected employees.
- Totals row (`:564-580`): exclude `unpackable` rows from the reconciliation summary, or
  surface the delta explicitly.

## Acceptance criteria

- [ ] `netPayable: row.netPayable` does not appear in `officialSheet.ts`.
- [ ] Over a 200,000-case seeded fuzz: `unpackable === false` ⟹ `|officialNet − referenceNet| <= 0.01`,
      **zero** exceptions (invariants **I1**, **I2**).
- [ ] `bonus`, `hra`, `ta`, `basic`, `gross` are all `>= 0` in every fuzz case (invariant **I4**).
- [ ] The `unpackable` rate over the fuzz is reported in the test output; both June rosters
      produce `0` unpackable rows.
- [ ] Export is blocked, with a named-employee message, when any row is `unpackable`.
- [ ] The dropped `candidateGross >= candidateProratedTotalSalary` clause does not lower
      Official attendance for any employee in either June roster.
