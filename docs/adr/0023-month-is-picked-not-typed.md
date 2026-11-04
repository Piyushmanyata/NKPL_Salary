# ADR 0023: The month is picked, not typed

## Status

Accepted (2026-11-04).

## Context

The month was a free-text box: type "November 2026", then click outside so the label was tidied
and the month loaded. On a phone that meant opening the keyboard, typing a full name and tapping
somewhere else, and a half-typed label loaded nothing until the blur.

## Decision

The app bar shows `‹ [Month ▾] [Year ▾] ›`. The arrows step one month back or forward; the two
native selects jump straight to any month. Every choice is already a canonical label
(`"November 2026"`), so it loads at once and there is no blur step. Years run from three before
the current year to one after, widened to include the month on screen.

Rejected: `<input type="month">`. Its picker differs by browser (a plain text box in some desktop
browsers) and still needs a confirm step on phones. Rejected: one select listing every saved
month, because a new month could not be opened from it.

## Consequences

- `onMonthLabelBlur` and the typed-label path are gone; `normalizeMonthLabel` stays for labels
  read from browser storage.
- One tap on `›` past the last saved month opens that new month, and Month Carry-Forward fills and
  saves it, exactly as typing its name did before.
