# 0022 — Adding an employee opens a form

## Context

**Add** used to insert a row named "New Employee" (Skilled, ₹0) at the top of the sheet and save
it straight away. Every real detail was then typed in three places: the name cell, the category
dropdown, and the gear panel for salary, travelling, PF/ESI and notes. A half-filled row saved as
"Missing rate", and a forgotten one stayed on the sheet with ₹0.

## Decision

**Add** opens a pop-up that asks for everything once: name, category, salary (per day for
Unskilled, per month for the rest), bonus or travelling, days worked, extra days, PF, ESI, advance
and notes. It shows Total Salary and this month's net before saving. Nothing is written until
**Add employee** is pressed; then the row goes in through `setEmployees`, so it saves by the same
versioned path as any edit (ADR 0021).

The form builds the employee by replaying the same `applyEmployeeEdit` handlers the sheet uses,
so the money rules (Special forces full month and no PF/ESI; ESI above ₹21,000 is explicit
consent, ADR 0011) cannot drift from editing an existing row.

Escape closes it only while it is still empty, so a typed form is never lost to a stray key. The
out-of-date-tab check (ADR 0021) runs when the pop-up opens and again when **Add employee** is
pressed. Name and salary are required. A name already on the month only warns ("Add anyway"), because two
people can share a name.

## Rejected

- **Keep the blank row and open its gear panel.** Still saves a ₹0 row before anything is typed,
  and the panel is laid out for editing, not first entry.
- **A per-day/per-month toggle in the form.** The category already decides the anchor (SPEC §2.2);
  the rare exception can still switch in the gear panel after adding.
