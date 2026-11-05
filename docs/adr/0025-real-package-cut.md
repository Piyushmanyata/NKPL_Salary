# ADR 0025: A Real Package below Total Salary is cut every month, by days paid, as Advance

## Status

Accepted (2026-11-05).

## Context

Some PF opt-out employees must show a ₹25,100 basic at full attendance on the Official sheet, so
their Total Salary is set to 25,100 while their real pay is lower (S K Sajamal, NKPL: real
22,700). The gap was cut by hand as an Advance: ₹2,500 in September 2026, then forgotten in
October 2026, so ₹2,245 was overpaid. Keeping Total Salary at the real figure does not work: the
Official sheet cannot print more gross than the Reference pays, so a full month shows 22,204 at
23/26 days instead of 25,100.

## Decision

- A standing **Real Package** on the Rate Card, next to the Full Attendance Basic, carried into
  every new month.
- The engine computes **Package Cut** = (Total Salary − Real Package) ÷ month days × (days
  worked + extra days), rounded to the nearest ₹100 (owner's call: a round figure, not 2,245).
  Any category but Special (which has no day count), whenever Total Salary is above the Real
  Package. Capped so Net never goes below zero.
- A Real Package change raises a Check flag against last month, like an Advance change.
- Gross stays on Total Salary. The cut comes off Net, and Official packs it like an advance,
  so a full month still prints the pinned basic at 26/26 and Official net equals Reference net.
- It is shown and exported inside **Advance** (Official sheet and both exports), because Tally
  books it on the ADVANCE TO STAFF & LABOUR pay head, as September was. The Reference sheet keeps
  the typed advance editable and shows "+cut auto" under it.
- Employer cost is reduced by the cut.

Rejected: a second typed Advance every month (what failed in October); Total Salary at the real
figure (breaks the full-attendance basic); a separate export column (changes the sheet Tally
staff key from).

## Consequences

- Set per person in the settings panel. Today only S K Sajamal (Real Package 22,700).
- Rounding to ₹100 means the cut can differ from the exact gap by up to ₹50 a month.
- Known, separate: in a 31-day month a full-attendance Reference gross is 25,099.99 (day-rate
  rounding), so Official packs at 25/26 days, not 26/26. Affects every pinned row, not just this.
