# HANDOFF — payroll correction batch

**Read this first, every session.** It is the entry point for executing the 15 tickets
created on 2026-07-26. One ticket per session unless a ticket explicitly says otherwise.

---

## 1. What this batch is

The payroll engine has correctness defects that reach real money. A grill session on
2026-07-26 resolved every ambiguous rule, produced an authoritative spec, and decomposed
the gap into 15 tickets.

| Artefact | Path | Role |
|---|---|---|
| **Spec** | `docs/SPEC-payroll.md` | Authoritative. Supersedes `CONTEXT.md` on any conflict. |
| **Batch index** | `docs/tickets/INDEX.md` | Waves, dependencies, severity. |
| **Tickets** | `docs/tickets/TICKET-NN-*.md` | One per defect. Mirrored as GitHub issues. |
| **Oracle** | `scripts/reference-oracle.py` | Executable form of the spec. The engine must agree with it. |
| **Issue creation** | `scripts/create-issues.sh` | Idempotent; creates issues, labels, dependencies. |

If the GitHub issues do not exist yet, run `./scripts/create-issues.sh --dry-run`, then
without the flag. It requires an authenticated `gh` and `jq`, and is safe to re-run.

---

## 2. Required reading, in order

**Every session, before touching code:**

1. This file.
2. `docs/SPEC-payroll.md` — at minimum §1 (notation), §2 (employee model), §7 (invariants),
   plus the sections your ticket cites.
3. Your ticket file, in full.
4. `CONTEXT.md` — for vocabulary. **Where it disagrees with the spec, the spec wins** until
   `TICKET-13` reconciles them.
5. `docs/adr/` — ADR-0001 (equal nets) and ADR-0002 (ESI bases) are still in force.

**Skip unless relevant:** `AGENTS.md` is a 1,100-line multi-agent protocol. These tickets are
pre-planned and pre-reviewed, so its Phase 0–4 (goal setting, recon, grilling, planning,
adversarial review) are already done and should **not** be re-run. What still applies:

- §3 Non-Negotiable Operating Rules
- §13 Batch Loop, steps 2 (baseline), 5 (integrate), 6 (verify), 7 (review)
- §14 Testing Strategy
- §17 Definition of Done

**Repo conventions:** `docs/agents/issue-tracker.md` (gh usage), `docs/agents/triage-labels.md`
(label vocabulary), `docs/agents/domain.md` (how to consume domain docs).

---

## 3. Execution order

Strict. Do not start a ticket with an open blocker.

```
Wave 0  ── independent, no shared files
   06 ── advance sign flip          ⚠ SHIP FIRST. Money. Ships WITH a data migration.
   03 ── month days from label
   15 ── deployed-build + P-Tax investigation   (no code; unblocks 14's fixtures)

Wave 1  ── schema foundation
   01 + 11 ── MUST land in the SAME commit
   02      ── persist isSecurity

Wave 2  ── depends on the new schema
   04 ── Unskilled day-rate back-fill
   05 ── fix the bundled June roster
   10 ── remove dead input fields

Wave 3  ── Official sheet, strictly sequential, one session each
   07 → 08 → 09 → 12

Wave 4  ── close out
   14 ── tests
   13 ── docs + ADR-0003
```

**Why 01 and 11 are one commit:** `App.tsx:443` re-runs `normalizeWageCategory` on every
render. Its salary-band fallback rewrites `"Special"` to `"Skilled"`. Shipping 01 alone
silently reverts it, and the tests will pass because they never re-render.

**Why 06 ships first:** it is the only ticket where the current build is actively paying the
wrong amount. It has no code dependencies, so there is no reason to wait.

**Frontier rule** (from `docs/agents/issue-tracker.md`): list open issues labelled
`payroll-correction`, drop any with an open blocker or an existing assignee, take the first
in wave order. Claim it with `gh issue edit <n> --add-assignee @me` as the session's first
write.

---

## 4. Per-session protocol

1. **Claim** the issue (`--add-assignee @me`).
2. **Baseline** — `npm test` and `python3 scripts/reference-oracle.py`. Record both.
   Until `TICKET-14` lands, `npm test` fails to start (see §6); note it and move on.
3. **Read** the ticket's cited `file:line` locations before editing. Line numbers drift as
   the batch progresses — locate by the quoted code, not by the number.
4. **Implement** exactly the ticket's scope. If you find an adjacent defect, **open a new
   issue**; do not widen the ticket.
5. **Verify** against §5 below. Every acceptance checkbox must be ticked with evidence.
6. **Commit** as `fix(<area>): <summary> (#<issue>)`, matching the existing log style
   (`feat(statutory): …`, `fix(attendance): …`).
7. **Close** with a comment containing: the acceptance evidence, the before/after oracle
   output, and the June net delta if any figure moved.

**Scope discipline.** `App.tsx` is 2,823 lines and several tickets touch it. Keep diffs
minimal and localized. Do not opportunistically refactor — a large diff in this file makes
the money changes unreviewable.

---

## 5. Verification gates

A ticket is not done until all four pass.

**Gate 1 — invariants.** `python3 scripts/reference-oracle.py` → 0 violations of I1–I10.
The oracle is the spec made executable. If your TS change makes the engine disagree with the
oracle, one of them is wrong; resolve it before closing.

**Gate 2 — real rosters.** Recompute both June 2026 rosters. Every rupee that moves must be
attributable to a ticket in this batch. An unexplained delta is a new bug — stop and open an
issue.

**Gate 3 — the ticket's own acceptance criteria.** Every box, with evidence pasted into the
close comment.

**Gate 4 — regression direction.** For any ticket with a test in `TICKET-14`, confirm the
test **fails** when your fix is reverted. A test that passes both ways is not a test.

**Known-good reference figures** (post-fix, June 2026):

| Employee | Figure | Value |
|---|---|---|
| BIDYUT RAY | Official basic / PF / gross / net | 12,584.00 / 1,510.08 / 23,866.92 / 22,226.84 |
| Ashok Ram | Reference net | 16,527.87 |
| Both rosters | Max Official attendance | 26 |
| Both rosters | `unpackable` rows | 0 |
| NKPL | Net total change vs 2026-07-07 export | −₹2,547.75 |
| APTUS | Net total change vs 2026-07-07 export | −₹628.13 |

---

## 6. Environment notes

- **`npm test` is broken on a clean checkout** — `Cannot find module @rollup/rollup-linux-x64-gnu`.
  Workaround: `rm -rf node_modules package-lock.json && npm install`. `TICKET-14` fixes it
  properly. Until then the four existing suites give **zero** signal.
- **`issue4_e2e_month_proof.test.ts` contains a tautological assertion.** It asserts Official
  net equals Reference net on rows where Official net is *copied from* Reference net. Do not
  trust a green result from it. `TICKET-14` replaces it.
- **Data lives in Redis** (`api/db.ts`, `REDIS_URL` in `.env.local`), one record per
  company-month (`monthly_salary/<company>/<month>`), plus a cross-month rate card
  (`employee_rates/<company>`, `api/rates.ts`). Redis is the **only** datastore — the browser
  keeps a localStorage read-cache and nothing else. Two tickets (01, 06) need
  migrations against it. **Dry-run every migration and keep the log.**
- **Deployment is Vercel.** `VERCEL_GIT_COMMIT_SHA` in `.env.local` is empty, so it does not
  tell you what is live — check the Vercel dashboard (`TICKET-15`).

---

## 7. History you need, or you will re-litigate settled decisions

**The ESI base has flipped three times.** `56eadc0` (2026-07-03) is literally titled
_"revert ESI calculation to earnedSalary on reference sheet while keeping basic salary for
main sheet"_ — so ESI-on-earned was a deliberate choice, not a bug. The 2026-07-24 rework
(`e341587`) silently changed it to gross. On 2026-07-26 the owner was shown both numbers and
**re-confirmed gross** (ADR-0002). This is settled. Do not "fix" it back.

**The `.xls` files in the repo root are stale.** Dated 2026-07-07, they predate the rework
and compute ESI on earned salary. They are **not** an oracle. Do not seed test fixtures from
them (`TICKET-14`), and do not treat a delta against them as a regression — `TICKET-15`
archives them.

**`ee2f4ac` mentions TDS** ("keeping only Professional Tax and TDS") but TDS is not modelled
anywhere in `src/`. The two ₹0 professional-tax rows (PUNIT SODHANI, Nawneet Sodhani) both
carry large `otherDeduction` values (₹15,000 / ₹20,000) that look like TDS entered by hand.
`TICKET-15` asks the business about this. Do not invent a TDS field.

**The Official sheet has been rewritten many times** — `edf658a`, `c7b090e`, `f0a9809`,
`8e876b6` are all attempts at the same net-equality problem. `TICKET-09` fixes the root
cause (net was copied, never computed) rather than the symptom. Resist the urge to add
another reverse-engineering loop.

---

## 8. Decisions already made — do not reopen

Settled in the 2026-07-26 grill. Reopening one costs a re-derivation of the whole batch.

| Question | Decision |
|---|---|
| Rate anchor per grade | Unskilled → day rate. Semi-skilled / Skilled → fixed monthly. Special → fixed monthly, no day rate. |
| Does full pay vary with month length? | Only for Unskilled with a stored day rate. |
| Is `Special` a category or a flag? | **Category.** Fourth value, mutually exclusive. |
| Reference ESI base | **Gross Payable** (ADR-0002). |
| Official ESI base | **Official Monthly Basic** (ADR-0002). |
| Official basic when PF is on | **Wage board** (400 / 440 / 484 × attendance), uncapped. |
| ₹15,000 | EPF *contribution* ceiling only. Never caps a displayed basic. |
| Official attendance | `clamp(26 − calendar absences, 0, 26)` for **everyone**. |
| Unpackable rows | Flag, warn, block export. Never print an unverifiable net. |
| Security identification | Persisted `isSecurity` boolean, not a name-string match. |
| Advance sign | Stored **positive**, always subtracted. |
| Missing rate | One-time back-fill at load; then assert. Never back-fill per calculation. |

---

## 9. Still open — needs a human, not an agent

Both sit in `TICKET-15` and block `TICKET-14`'s fixtures.

1. **Are PUNIT SODHANI and Nawneet Sodhani professional-tax exempt?** The current code cannot
   produce the ₹0 their sheets show. If yes → a new `professionalTaxExempt` field and a
   follow-up ticket. If no → they owe ₹200 each, and that is arrears.
2. **Which commit is deployed?** If production predates `9425051`, the July 24 rework is not
   live and the ESI base has been wrong in production the whole time.

Also flagged as spec assumptions (`docs/SPEC-payroll.md` §9), implemented as stated unless
overridden: Specials borrow the Skilled wage-board display row; employer PF mirrors employee
PF with no EPS split; professional tax is charged on prorated rather than full-month gross.

---

## 10. Definition of done for the batch

- [ ] All 15 issues closed.
- [ ] `npm test` green from a clean clone.
- [ ] `scripts/reference-oracle.py` → 0 violations, and the TS engine agrees with it.
- [ ] Both June rosters re-exported and diffed; every changed rupee attributed to a ticket.
- [ ] `CONTEXT.md`, ADR-0003 and `SPEC-payroll.md` mutually consistent.
- [ ] Advance migration executed, dry-run log retained.
- [ ] Payroll sign-off informed of the advance correction and any P-Tax arrears.
