# TICKET-01 — Make `Special` a fourth Category and delete the `isSpecial` flag

**Type:** schema / breaking · **Priority:** P0 · **Blocks:** 07, 08, 09, 11, 12, 14
**Blocked by:** none · **Spec:** SPEC-payroll.md §2.1, §2.2

## Current behaviour

`Category` is a free `string`. `isSpecial` is a separate boolean overlay (`types.ts:34`),
so an employee can be `Special` **and** `Unskilled` at the same time.

`salary.ts:88` decides the rate model from the category string alone:

```ts
const isLabour = cat.includes("unskilled") || cat.includes("labour")
              || cat.includes("cooly")     || cat.includes("helper");
...
if (isLabour) { monthlySalary = roundMoney(workingDays * salaryPerDay); }
```

`isSpecial` is never consulted here. A Special tagged `Unskilled` therefore has their
monthly salary **overwritten** by `workingDays × salaryPerDay` — it rescales with month
length, and collapses to `₹0` when no day rate is stored.

Reproduced in fuzz: `{category:"Unskilled", isSpecial:true, monthlySalary:10000, salaryPerDay:0, D:29}`
→ `monthlySalary = 0`, `grossPayable = 0`, `netPayable = −1500`.

All 6 current Specials (Sonal Goenka, Rahul Somani, Anjali Sodhani, Rishi Jhajharia,
Bindu Chirania, PUNIT SODHANI) are tagged `Skilled`, so the bug is latent, not live.

## Required behaviour

`Category = "Unskilled" | "Semi-skilled" | "Skilled" | "Special"` — mutually exclusive.
`isSpecial` is deleted from the type, the DB record, the UI and every call site.

For `Category === "Special"`: no day rate, `b = 0`, `Xd = 0`, `Dw = D`, `absentDays = 0`,
`pfOptIn = false`, `esiOptIn = false`. Professional Tax still applies. `specialBonus` allowed.

## Changes

**`src/types.ts`**

```ts
export type Category = "Unskilled" | "Semi-skilled" | "Skilled" | "Special";

export type EmployeeInput = {
  ...
  category: Category;      // was: string
  // isSpecial?: boolean;  // DELETE
};
```

**`src/salary.ts`**

- Delete `isSpecialEmployee()` (`:66-72`) — the `string` overload is dead code that always
  returns `false`. Replace every call with `input.category === "Special"`.
- Replace the `isLabour` block (`:87-103`) with an explicit four-way switch:

```ts
switch (input.category) {
  case "Special":
    salaryPerDay = 0;
    bonusPerDay  = 0;
    // monthlySalary is used exactly as stored — never multiplied by workingDays
    break;
  case "Unskilled":
    if (salaryPerDay <= 0 && monthlySalary > 0) salaryPerDay = roundMoney(monthlySalary / workingDays); // TICKET-04
    monthlySalary = roundMoney(workingDays * salaryPerDay);
    break;
  case "Semi-skilled":
  case "Skilled":
    if (monthlySalary > 0)      salaryPerDay  = roundMoney(monthlySalary / workingDays);
    else if (salaryPerDay > 0)  monthlySalary = roundMoney(workingDays * salaryPerDay);
    break;
}
```

**`src/App.tsx`**

- `sanitizeEmployee` (`:201-262`): mirror the same switch; drop `isSpecial` reads at `:231`,
  `:244`, `:247-249`.
- `updateEmployee` (`:655`, `:672-678`): the "Make Special" toggle becomes a Category select.
  When Category is set to `Special`, clear `salaryPerDay`, `bonusPerDay`, `extraDays`, and
  set `daysWorked = effectiveMonthDays`.
- Row settings panel (`:1354`, `:1380`, `:1502-1530`): replace the Special toggle with the
  4-value Category control; keep the `disabled` behaviour keyed on `category === "Special"`.

**Migration** — one-time, on load, in `sanitizeEmployee`:

```ts
if ((row as any).isSpecial === true) row.category = "Special";
```

Keep this shim for one release, then delete. Persist the migrated value on next save.

## Acceptance criteria

- [ ] `EmployeeInput["category"]` is the 4-value union; `isSpecial` does not appear in `src/` or `api/`.
- [ ] A `Special` employee's `monthlySalary` is byte-identical at `D = 28` and `D = 31`.
- [ ] A `Special` employee reports `salaryPerDay === 0`, `bonusPerDay === 0`, `extraDays === 0`,
      `daysWorked === D`, `absentDays === 0`, `employeePf === 0`, `esi === 0`.
- [ ] Professional Tax is still charged (Sonal Goenka at gross ₹60,000 → ₹200).
- [ ] Loading a stored record with `isSpecial: true` yields `category: "Special"`.
- [ ] Invariants **I5** and **I10** pass.
