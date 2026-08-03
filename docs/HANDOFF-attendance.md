# HANDOFF — attendance reconciliation & double shifts

**Read this file completely before running a single tool.** It is designed to be executed in
one pass, top to bottom, without re-deriving any decision. Every ambiguity was already
resolved in the grill session of 2026-08-03. **Do not re-open a decision. Do not redesign.**

If something here contradicts what you think is better: **this file wins.** If something here
is genuinely impossible, stop and report it — do not improvise a substitute.

---

## 0. Skills to load, and when

| Skill | When | Why |
|---|---|---|
| **`lean-ctx`** | immediately, and for **all** file reads/searches/edits | Native `Grep`/`Glob` are **denied by policy** in this environment. Use `ctx_compose` to orient, `ctx_read` to read, `ctx_search` instead of grep, `ctx_glob` instead of glob, `ctx_shell` for commands, `ctx_read(mode="anchored")` → `ctx_patch` to edit. |
| **`ponytail`** | before writing each phase's code | Keeps diffs minimal. This is a payroll app with 99 passing tests — the smallest change that satisfies the spec is the correct change. No new dependencies. No abstractions "for later". |
| **`domain-modeling`** | Phase 9 only | Writing `CONTEXT.md` terms and the five ADRs. |
| **`code-review`** | after Phase 9, optional | Reviews the branch against the spec. |

Do **not** use `Agent`/subagents. Do **not** use `graphify`. Do **not** use deep-research.

---

## 1. Required reading, in order

1. **This file.**
2. **`docs/SPEC-attendance.md`** — authoritative. Read all 12 sections. You will refer back to
   §3 (day resolution), §8 (Extra Days), §9.3 (record shapes) and §11 (invariants) constantly.
3. **`CONTEXT.md`** — vocabulary only. Where it conflicts with the spec, **the spec wins**;
   Phase 9 reconciles them.
4. **`docs/SPEC-payroll.md` §2.3, §4** — the payroll side of the `extraDays` boundary. You are
   changing the *value* fed to `extraDays`, nothing else in payroll.

Skip `AGENTS.md`. Skip `docs/tickets/` — that batch is closed.

---

## 2. Non-negotiable rules

1. **Never change `src/salary.ts` arithmetic.** The only payroll-facing change in this whole
   task is *what number* is assigned to `extraDays` at sync time.
2. **Never add a dependency.** `xlsx`, `react`, `ioredis`, `lucide-react` are what you have.
3. **Never touch `src/officialSheet.ts`.**
4. **Never backfill or recompute a filed month.**
5. **Never delete a roster employee** from the attendance checker. Exclusion is soft (spec §6).
6. **Keep `src/App.tsx` diffs surgical.** It is 3,053 lines and has **zero test coverage**.
   Do not refactor it, do not reformat it, do not extract components from it beyond the one
   new file named in Phase 7.
7. **Run the tests after every phase.** A phase is not done until they are green.
8. **Commit after every phase**, with the message given in that phase.

---

## 3. Environment traps — these will cost you an hour each if you skip this

| Trap | Fix |
|---|---|
| `node -e "..."` is **blocked** by policy | Write a `.mjs` file under `scripts/` and run `node scripts/foo.mjs`. |
| `XLSX.readFile(path)` **throws** `Cannot access file` | The CDN ESM build has no `fs` bound. Use `XLSX.read(fs.readFileSync(path), { type: "buffer" })`. |
| Node cannot read files **outside the repo** | Copy source workbooks into the repo first (see §4), then read them by relative path. |
| Shell is **bash (POSIX)**, not PowerShell | Forward slashes, `/c/Users/...` drive paths. |
| `npm test` runs `vitest run src` | Use `npx vitest run src` directly if the script misbehaves. |

**Baseline before you start.** Record both outputs; they must still hold at the end.

```bash
npx vitest run src 2>&1 | tail -5 && npx tsc --noEmit && echo "TYPECHECK CLEAN"
```

Expected: **16 files, 99 tests passed**, and a clean typecheck.

---

## 4. Source data for fixtures

Copy these four real files into `.tmp-att/` at the repo root (create it, and **add `.tmp-att/`
to `.gitignore`**):

```
C:\Users\piyus\OneDrive\Documents\attendance\JULY 26\ATTANDANCE 2026 (3).xlsx   → NKPL manual
C:\Users\piyus\OneDrive\Documents\attendance\JULY 26\31AttendanceRecord.xls     → NKPL biometric
\\Tally-server\d\Salary\aptus\Attendance sheet Daily Basis 2026-27.xlsx         → APTUS manual
\\Tally-server\d\Salary\aptus\001_2026_5_MON.XLS                                → APTUS biometric
```

```bash
mkdir -p .tmp-att && cp "/c/Users/piyus/OneDrive/Documents/attendance/JULY 26/ATTANDANCE 2026 (3).xlsx" "/c/Users/piyus/OneDrive/Documents/attendance/JULY 26/31AttendanceRecord.xls" "//Tally-server/d/Salary/aptus/001_2026_5_MON.XLS" "//Tally-server/d/Salary/aptus/Attendance sheet Daily Basis 2026-27.xlsx" .tmp-att/
```

**Fixtures use the real files** (the repo already commits real payroll workbooks under
`data/`). Generate JSON fixtures under `src/__tests__/fixtures/` from them — commit the
**generated JSON**, not the workbooks. Delete `.tmp-att/` when finished.

If a path is unreachable, **stop and report it.** Do not invent fixture data.

---

## 5. Ground-truth numbers

These are measured from the real files. Your code must reproduce them exactly. If a number
disagrees, **your code is wrong** — do not adjust the number.

**NKPL, July 2026** (`D = 31`, threshold 21, Sundays 5/12/19/26):

| Fact | Value |
|---|---|
| manual sheet employees | 44 |
| biometric employees | 38 |
| cells with value `2` | **4** — `MONAJ CHATTERJEE` d12, d26; `PARIMAL GHOSH` d5, d19 |
| days with both `A` and `B` marked | **0** |
| agreeing employee-days | 1,064 |
| `sheet-present-short-stay` | 73 |
| `sheet-present-no-punch` | 10 |
| `punched-sheet-absent` | 49 |
| `missing-biometric` | 7 — `TANMOY DASTANTI`, `KEYA PATRA`, `MONAJ CHATTERJEE`, `PARIMAL GHOSH`, `GOUTAM MALIK`, `PINTU POREL`, `PANCHA MALIK` |
| `unmapped-biometric` | 1 — `Joy Das` |
| `namesMatch` clean 1:1 | 23 / 44 |

Both guards: `present = 29`, `doubles = 2`, `Dw = 29`, `Xd = 2`.

**APTUS, May 2026** (`D = 31`):

| Fact | Value |
|---|---|
| manual employees | 32 · biometric employees | 32 |
| manual value histogram | `P` 719 · `A` 138 · blank 135 — **no `2`** |
| `namesMatch` clean 1:1 | 24 / 32 |
| `Somnath Parui` (SECQURITY) | sheet `P=31 SUN=5 TOT=36`; **app must compute `Dw=31`, `Xd=0`** |
| `Rajesh Kr Singh` | sheet `TOT=30`; app must compute `Dw=30` |
| `Debnath pal` | sheet `TOT=17`; app must compute `Dw=17` |

---

## 6. Phase order

Strictly sequential. Do not start a phase until the previous one is committed green.

```
1  fixtures + characterization tests   (locks current behaviour)
2  types + T2 codec
3  attendance.ts parser & rules
4  reconciliation engine (new pure module)
5  persistence (api + db)
6  sync & salary wiring
7  UI
8  reliability
9  docs (CONTEXT.md + 5 ADRs)
```

---

### Phase 1 — fixtures and characterization tests

**Goal:** freeze today's behaviour so Phase 3 changes are visible.

1. Write `scripts/gen-attendance-fixtures.mjs`. It reads the four files from `.tmp-att/` and
   writes to `src/__tests__/fixtures/`:
   - `nkpl-july-2026-manual.json`, `nkpl-july-2026-biometric.json`
   - `aptus-may-2026-manual.json`, `aptus-may-2026-biometric.json`

   Each fixture is the **raw `rows` array** (`XLSX.utils.sheet_to_json(sheet, {header:1,
   defval:null, raw:true})`) — the exact shape `parseAttendanceExcel` already consumes. This
   keeps fixtures dumb and stable.

2. Write `src/__tests__/attendance_fixtures.test.ts` asserting every number in §5 that is
   observable **today**: employee counts, the four `2` cells, zero `A`+`B` days, the APTUS
   histogram, the `namesMatch` 23/44 and 24/32 rates.

**Gate:** `npx vitest run src` → **16 files + 1 new, all green.**
**Commit:** `test(attendance): characterization fixtures from real NKPL and APTUS files`

---

### Phase 2 — types and the T2 codec

**Files:** `src/types.ts`, new `src/attendanceCodec.ts`, new
`src/__tests__/attendance_codec.test.ts`

1. Add to `src/types.ts`, verbatim from spec §9.3: `AttendanceRecordV1`, `AttendanceRowV1`,
   `AttendanceMetaV1`.

2. Extend the existing `AttendanceEmployee["daysDetail"]` element with:
   ```ts
   isDoubleShift?: boolean;
   ambiguousSpan?: boolean;
   ```
   and extend `AttendanceEmployee` with:
   ```ts
   doubleShiftDays: number;
   extraDaysTotal: number;
   sheetMarks?: string;   // the D-character verdict string, for the diff view
   ```

3. Create `src/attendanceCodec.ts` with exactly these four exports:
   ```ts
   export function encodeAttendance(
     company: string, monthLabel: string, employees: AttendanceEmployee[]
   ): AttendanceRecordV1;

   export function decodeAttendance(
     record: AttendanceRecordV1 | null, monthLabel: string
   ): AttendanceEmployee[];   // [] for null or unknown v

   export function encodePunches(daysDetail, D: number): string;   // "0805-2009;;0802-2004"
   export function decodePunches(p: string, D: number): string[][];
   ```

   Rules (spec §9.3): `p` and `s` always have exactly `D` slots/characters — **pad, never
   truncate**. Omit `o` entirely when empty. Unknown `v` → treat as no saved attendance;
   never throw.

4. Tests: round-trip (**A9**), padding (**A11**), unknown-`v` returns `[]`, and a size
   assertion — encoding the NKPL July fixture must be **under 20 KB** of JSON.

**Gate:** all green; size assertion passes.
**Commit:** `feat(attendance): compact V1 record shape and codec`

---

### Phase 3 — parser and rules

**File:** `src/attendance.ts`. This is the highest-risk phase. Change only what is listed.

**3a. `analyzePunches` — decouple presence from duration, add `ambiguousSpan`.**

Replace the body's tail with exactly this logic (spec §4.1):

```ts
let duration = 0;
let ambiguousSpan = false;
if (times.length >= 2) {
  const minutes = times.map((t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; });
  const raw = (Math.max(...minutes) - Math.min(...minutes)) / 60;
  if (shift === "Night" && raw > 12) {
    duration = 24 - raw;
    ambiguousSpan = duration < 5;
  } else {
    duration = raw;
  }
}
const isShortStay = punchedIn && duration < 5;
// Presence no longer depends on duration — SPEC-attendance §4 / ADR-0005.
return { shift, duration, isShortStay, ambiguousSpan, punchedIn };
```

`analyzePunches` **no longer returns `isPresent`.** Every call site must be updated to get
presence from `resolveDay` (3b).

**3b. New exported `resolveDay`** implementing spec §3 exactly — R1–R4 in order, the
`doubleShift` rule, and the `doubleShift ⇒ present` guard (**A3**).

**3c. `calculateEmployeeAttendanceStats`** — presence via `resolveDay`; count
`doubleShiftDays`; return `extraDaysTotal` per spec §8:

```
Special  → 0        (caller supplies category)
Security → doubleShiftDays
else     → sundaysEligible + doubleShiftDays
```

`avgHours` must **exclude `ambiguousSpan` days** from both numerator and denominator.
`meetsMonthThreshold` is unchanged and still measured **before** auto-paid Sundays.

**3d. `2` as the double-shift marker** in both manual formats:
- `double-shift` branch: cell `2` ⇒ present **and** `isDoubleShift`. Keep `1`/non-empty ⇒ present.
- `aptus-daily` branch: currently accepts only `"P"`. Accept `"P"` ⇒ present, `"2"` ⇒ present +
  `isDoubleShift`, `"A"`/blank ⇒ absent.

**3e. `getBestWorksheet` must not guess** (spec §10.1). Change the return to
`{ sheet, sheetName }`; on no match and no `Logs`/`Attendance` sheet, **throw** an Error whose
message lists `workbook.SheetNames`. Update the caller.

**3f. Harden name matching.** Keep `namesMatch` as-is for *suggestions*. Add:
```ts
export function findUniqueMatch(employees: EmployeeInput[], rawName: string): EmployeeInput | null;
```
It returns a match **only when exactly one** candidate matches (**A12**). Replace
`findMatchedEmployee` usage with it.

**3g. Export `detectFormat(rows)` and `formatKind(format)`** for the upload validator
(spec §10).

**Tests:** new `src/__tests__/attendance_double_shift.test.ts` covering A1–A6, A8, A12, the
`ANUPAM MAHESH d8 ["00:21","23:19"]` ambiguous span, the four `2` cells, and both guards
resolving to `Dw=29, Xd=2`.

**Gate:** all green. `issue1_attendance.test.ts` asserts old short-stay behaviour — update it
to the new rule and **state in the commit body which assertions changed and why**.
**Commit:** `feat(attendance): double shifts, short stay no longer absent, safer sheet pick`

---

### Phase 4 — reconciliation engine

**New file:** `src/reconcile.ts`. Pure functions only — no React, no fetch, no Redis.

```ts
export type ConflictKind =
  | "sheet-present-no-punch" | "sheet-present-short-stay" | "punched-sheet-absent"
  | "double-no-corroboration" | "missing-biometric" | "unmapped-biometric";

export type Conflict = {
  kind: ConflictKind; employeeId: string; name: string;
  day?: number; sheet?: string; punches?: string[];
};

export function reconcile(args: {
  manual: AttendanceEmployee[] | null;
  biometric: AttendanceEmployee[] | null;
  roster: EmployeeInput[];
  meta: AttendanceMetaV1;
  monthLabel: string;
}): { employees: AttendanceEmployee[]; conflicts: Conflict[] };

export function suggestMapping(
  biometric: AttendanceEmployee[], roster: EmployeeInput[], meta: AttendanceMetaV1
): Array<{ biometricId: string; biometricName: string; suggestedRosterId: string | null }>;
```

Join rules (spec §5.1): biometric joins by `meta.map[biometricId]` **only**; manual joins by
`findUniqueMatch`. Excluded people (`meta.excluded`) are dropped before anything else (**A7**).
`missing-biometric` keeps the manual `Dw` untouched (**A8**).

**Tests:** `src/__tests__/reconcile.test.ts` must reproduce **every count in §5** for both
companies. This is the phase's whole point — if the counts do not match, do not proceed.

**Gate:** all §5 counts reproduced exactly.
**Commit:** `feat(attendance): reconciliation engine with conflict classification`

---

### Phase 5 — persistence

**Files:** new `api/attendance.ts`, new `api/attendance-meta.ts`, `src/db.ts`.

Copy the structure of `api/db.ts` exactly — same CORS headers, same `normalizeCompany`, same
`redisGetJson`/`redisSetJson` helpers from `api/_lib/redis.js`.

Keys: `attendance/<COMPANY>/<Month Label>` and `attendance_meta/<COMPANY>` (spec §9.2).
`GET` returns `404` when absent. **No `SCAN` in either handler.**

In `src/db.ts` add `getAttendance`, `saveAttendance`, `getAttendanceMeta`, `saveAttendanceMeta`,
following the existing localStorage-cache-plus-fetch pattern. **Do not touch `saveMonthData`
in this phase** — that is Phase 8.

**Gate:** typecheck clean; existing tests green.
**Commit:** `feat(attendance): persist attendance and mapping metadata in Redis`

---

### Phase 6 — sync and salary wiring

**File:** `src/App.tsx`, the `onSyncAttendance` handler (currently around line 1964).

Replace the `extraDays` assignment (currently line ~1981):

```ts
extraDays: isSpecialCategory(emp.category)
  ? 0
  : isSecurity
    ? matched.doubleShiftDays
    : matched.sundaysEligible + matched.doubleShiftDays,
```

Apply the same rule to the new-employee import branch (~line 2008). `daysWorked` still comes
from `matched.presentDays` — **never add doubles to it** (**A6**).

**Gate:** green. Manually verify both guards land on `daysWorked=29, extraDays=2`.
**Commit:** `feat(salary): pay double shifts as extra days, including for security`

---

### Phase 7 — UI

**Files:** `src/App.tsx`, `src/styles.css`, and **one** new component file
`src/AttendanceUpload.tsx` for the two-slot uploader. No other extraction.

1. **Two upload slots** — `Biometric Export` and `Manual Sheet`. Validate with
   `detectFormat` + `formatKind`; reject a mismatch naming both the slot and the detected
   format (spec §10). Handle all four combinations in the table in §10.

2. **Left table columns become `Name | Days | Extra Days`.** Delete the `Stay` and `Status`
   `<th>`/`<td>` (currently lines ~2456–2461 and ~2476–2487). Sort fields become
   `"name" | "presentDays" | "extraDays"`. **Keep `avgHours` computed** — the right-hand
   detail panel still shows it.

3. **Day grid:** a `Double Shift` toggle beside the existing Present / Approved / Unapproved
   buttons, writing decision flag `D`/`d`. Conflict highlighting, one distinct style per
   `ConflictKind`, plus a marker for `ambiguousSpan`.

4. **Mapping screen:** modal listing unmapped biometric rows, each with a roster dropdown
   pre-selected from `suggestMapping`. Save writes `attendance_meta`.

5. **Exclude action:** per-row button → confirm → adds `normalizeKey(name)` to
   `meta.excluded`, persists, removes from view. Collapsed `Excluded (n)` section with
   Restore. **It must not touch the roster** (spec §6).

6. **Overwrite guard:** uploading into a month that already has saved attendance must confirm
   first (**A10**).

**Gate:** `npx tsc --noEmit` clean; tests green; `npm run build` succeeds.
**Commit:** `feat(attendance): dual upload, reconciliation view, double-shift toggle`

---

### Phase 8 — reliability

**Files:** `src/db.ts`, `src/App.tsx`.

1. **Visible save failures.** `saveMonthData` currently swallows errors into `console.error`
   — a failed Redis write is indistinguishable from a success. Return
   `{ ok: boolean; error?: string }`; in `App.tsx` show a persistent banner with a Retry
   action while `ok === false`. Same for `saveEmployeeRates`.

2. **Cut the write budget.** Raise the month-record debounce from 500 ms to **2000 ms**, and
   **skip the write when the serialized payload is identical to the last successfully written
   one**. Do the same for the rate card. (Upstash free tier is capped on *commands*, not bytes.)

3. **Fix the `getBestWorksheet` caller** if Phase 3e left any `[0]` fallback.

**Gate:** green; a forced fetch failure surfaces a visible banner.
**Commit:** `fix(reliability): surface save failures and cut redundant Redis writes`

---

### Phase 9 — documentation

Load the **`domain-modeling`** skill.

1. **`CONTEXT.md`** — add terms: `Double Shift`, `Manual Sheet`, `Biometric Export`,
   `Attendance Conflict`, `Biometric ID`, `Excluded Employee`. Amend: `Present Day`,
   `Short Stay`, `Extra Days`, `Security Employee`. Each with an `_Avoid_:` line, matching the
   existing style.

2. **Five ADRs** in `docs/adr/`, following the format of `0004-*`:

   | | Title |
   |---|---|
   | `0005` | Short Stay no longer forces absence |
   | `0006` | Manual Sheet is the presence authority; Biometric is evidence |
   | `0007` | Attendance persisted as inputs and decisions in a separate key |
   | `0008` | Security denied the Sunday package in both companies |
   | `0009` | Roster as join hub via stored Biometric ID |

   Each must state the decision, the measured evidence from spec §2.2/§5.1/§7/§9.1, and the
   consequences. **ADR-0008 must record explicitly** that it diverges from the APTUS sheet by
   5 days/month on `Somnath Parui`.

3. Delete `.tmp-att/`.

**Commit:** `docs(attendance): glossary terms and ADR-0005..0009`

---

## 7. Definition of done

- [ ] `npx vitest run src` green — 99 original tests **plus** the new suites.
- [ ] `npx tsc --noEmit` clean.
- [ ] `npm run build` succeeds.
- [ ] Every count in §5 reproduced by `reconcile.test.ts` for both companies.
- [ ] Both NKPL guards compute `daysWorked=29, extraDays=2`.
- [ ] `Somnath Parui` computes `Dw=31, Xd=0` while the APTUS sheet says 36 — divergence
      **surfaced**, not reproduced.
- [ ] Invariants A1–A12 each have at least one test.
- [ ] Encoded NKPL July record under 20 KB.
- [ ] `.tmp-att/` deleted; no workbook committed.
- [ ] Nine commits, one per phase.

---

## 8. Traps that will bite you

1. **`analyzePunches` no longer returns `isPresent`.** Four call sites read it today. Miss one
   and presence silently reverts to the old rule.
2. **The `2` reads as present today** — non-empty, non-`A`, non-`0`. So the *day* already
   counts; only the *extra day* is being lost. Do not double-count it into `daysWorked`.
3. **Both guards are absent from the biometric file.** Any code path that requires a biometric
   row will delete the only four double shifts in the data.
4. **`missing-biometric` is normal**, not an error — 7 of 44 NKPL people. Never zero them.
5. **APTUS truncates names to 12 characters.** Never widen `namesMatch` to compensate; that is
   what the stored mapping is for.
6. **`clampDays` clamps `daysWorked` to `D`.** A double added to `daysWorked` vanishes silently.
7. **`getBestWorksheet` currently returns `SheetNames[0]`** — the NKPL workbook's first tab is
   `JULY 2026`, so a parse failure imports July into any month you are editing.
8. **`issue1_attendance.test.ts` asserts the old short-stay rule.** It *should* fail in Phase 3.
   Update it deliberately; do not delete it.

---

## 9. If you get stuck

Report and stop. Do **not**:
- invent fixture data when a source path is unreachable
- widen fuzzy name matching to raise the match rate
- make the biometric authoritative "because it is objective" — measured, it is wrong 83 times
  one way and 49 the other
- merge attendance into `monthly_salary/...` to avoid a new endpoint
- refactor `App.tsx`

Every one of those was considered and rejected with evidence. The reasoning is in
`docs/SPEC-attendance.md`.
