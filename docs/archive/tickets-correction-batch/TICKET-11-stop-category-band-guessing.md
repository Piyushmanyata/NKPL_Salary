# TICKET-11 — `normalizeWageCategory` silently reclassifies employees from salary bands

**Type:** bug · **Priority:** P0 · **Blocks:** 07, 08, 12
**Blocked by:** none (but must land **with** 01) · **Spec:** SPEC-payroll.md §6.1, invariant I9

## Current behaviour

`officialSheet.ts:64-97`:

```ts
export function normalizeWageCategory(value: string, monthlySalary?: number): WageCategory {
  const trimmed = value.trim();
  if (trimmed === "Skilled" || trimmed === "Semi-skilled" || trimmed === "Unskilled") return trimmed;

  const salary = Math.max(0, numberValue(monthlySalary));
  if (salary > 0) {
    if (salary < 12000) return "Unskilled";
    if (salary < 20000) return "Semi-skilled";
    return "Skilled";
  }
  ...
  return "Skilled";       // final fallback
}
```

Any category string that is not an exact match falls through to a **salary-band guess**, and
then to a hardcoded `"Skilled"`.

This runs on the hot path, on every render — `App.tsx:443`:

```ts
calculateSalary({ ...employee, category: normalizeWageCategory(employee.category, employee.monthlySalary) }, ...)
```

and again in `sanitizeEmployee` (`App.tsx:241`), where the guessed value is **persisted back**
over the user's choice.

Two live consequences:

1. Whitespace, casing or punctuation differences (`"skilled"`, `"Semi Skilled"`, `"Semi-Skilled"`)
   are silently re-derived from salary rather than normalized, so an employee's grade can
   change when their salary changes.
2. **After TICKET-01 this destroys the `Special` category.** `"Special"` is not one of the three
   literals, so a Special on ₹60,000 is rewritten to `"Skilled"` before `calculateSalary`
   ever sees it — reintroducing the day rate, the attendance proration and the PF/ESI logic
   that Special is defined to escape.

## Required behaviour

`Category` is authoritative and is preserved end-to-end. Normalization repairs *formatting*
only — never infers grade from money.

## Changes

**`src/officialSheet.ts`** — replace with a pure formatter:

```ts
const CANONICAL: Record<string, Category> = {
  "unskilled": "Unskilled", "labour": "Unskilled", "cooly": "Unskilled", "helper": "Unskilled", "peon": "Unskilled",
  "semiskilled": "Semi-skilled", "semi skilled": "Semi-skilled", "semi-skilled": "Semi-skilled",
  "skilled": "Skilled",
  "special": "Special",
};

export function normalizeCategory(value: unknown): Category | null {
  const key = String(value ?? "").trim().toLowerCase().replace(/[^a-z ]/g, "");
  return CANONICAL[key] ?? CANONICAL[key.replace(/\s+/g, "")] ?? null;
}
```

Returns `null` — not a guess — when the input is unrecognizable.
Delete the `monthlySalary` parameter and the band logic entirely.
Delete `classifyWageCategory` (`:60-62`); use `row.category` directly.

**`src/App.tsx`**

- `:443` — drop the `normalizeWageCategory` wrapper; pass `employee.category` straight through.
- `sanitizeEmployee:241` — `category: normalizeCategory(row.category) ?? "Unskilled"`, and
  when the result is `null`, record a validation warning on the row so the bad value is
  visible rather than silently coerced.
- Roster editor: Category becomes a `<select>` over the four values, so unrecognizable
  strings can no longer be introduced through the UI at all.

**One-time repair** — the band guess may already have corrupted stored categories. Before
deploying, dump every stored roster and diff `category` against what a human expects for the
6 Specials and the 2 security employees. Report before mutating.

## Acceptance criteria

- [ ] `normalizeCategory` never consults salary; the function takes exactly one argument.
- [ ] `normalizeCategory("Special") === "Special"`, and a Special on ₹60,000 stays `"Special"`
      through `sanitizeEmployee` → `calculateSalary` → `buildOfficialRow` (invariant **I9**).
- [ ] `normalizeCategory("semi skilled") === "Semi-skilled"`; `normalizeCategory("Manager") === null`.
- [ ] Changing an employee's `monthlySalary` never changes their `category`.
- [ ] `classifyWageCategory` no longer exists.
