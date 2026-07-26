#!/usr/bin/env bash
# Create the payroll-correction batch as GitHub issues.
#
# Conventions follow docs/agents/issue-tracker.md (gh CLI, native issue
# dependencies) and docs/agents/triage-labels.md (label vocabulary).
#
# Idempotent: an issue whose title already exists is skipped, not duplicated.
# Safe to re-run after a partial failure.
#
#   ./scripts/create-issues.sh --dry-run     # print what would happen
#   ./scripts/create-issues.sh               # create for real
#
# Requires: gh (authenticated), jq. Run from the repo root.

set -euo pipefail

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

command -v gh >/dev/null || { echo "error: gh not found — https://cli.github.com"; exit 1; }
command -v jq >/dev/null || { echo "error: jq not found"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "error: gh not authenticated — run 'gh auth login'"; exit 1; }
[[ -d docs/tickets ]] || { echo "error: run this from the repo root"; exit 1; }

REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
MAP=.scratch-payroll-issue-map.txt        # "TICKET-NN <issue-number>" per line
: > "$MAP.tmp"
echo "repo: $REPO"
[[ $DRY_RUN == 1 ]] && echo "MODE: dry run — nothing will be created"
echo

# ---------------------------------------------------------------- labels ----
# name|color|description
LABELS=(
  "ready-for-agent|0E8A16|Fully specified, ready for an AFK agent"
  "ready-for-human|D93F0B|Requires human implementation or a business decision"
  "payroll-correction|5319E7|2026-07-26 payroll spec correction batch"
  "priority:P0|B60205|Blocks the batch; money or correctness at risk"
  "priority:P1|FBCA04|Important, not blocking"
  "priority:P2|C2E0C6|Cleanup"
  "money|B60205|Directly changes rupees paid to an employee"
  "needs-migration|FEF2C0|Requires a data migration alongside the code change"
)
echo "── labels ──"
for spec in "${LABELS[@]}"; do
  IFS='|' read -r name color desc <<< "$spec"
  if gh label list --limit 200 --json name --jq '.[].name' | grep -qx "$name"; then
    echo "  = $name (exists)"
  elif [[ $DRY_RUN == 1 ]]; then
    echo "  + $name (would create)"
  else
    gh label create "$name" --color "$color" --description "$desc" >/dev/null && echo "  + $name"
  fi
done
echo

# --------------------------------------------------------------- issues ----
# TICKET|file|labels (comma-separated)
ISSUES=(
  "TICKET-01|docs/tickets/TICKET-01-category-four-values.md|ready-for-agent,payroll-correction,priority:P0,needs-migration"
  "TICKET-02|docs/tickets/TICKET-02-persist-is-security.md|ready-for-agent,payroll-correction,priority:P0,money"
  "TICKET-03|docs/tickets/TICKET-03-month-days-from-label.md|ready-for-agent,payroll-correction,priority:P1"
  "TICKET-04|docs/tickets/TICKET-04-unskilled-zero-salary.md|ready-for-agent,payroll-correction,priority:P0,money"
  "TICKET-05|docs/tickets/TICKET-05-seed-roster-salary-conflation.md|ready-for-agent,payroll-correction,priority:P1"
  "TICKET-06|docs/tickets/TICKET-06-advance-sign-flip.md|ready-for-human,payroll-correction,priority:P0,money,needs-migration"
  "TICKET-07|docs/tickets/TICKET-07-unify-official-path.md|ready-for-agent,payroll-correction,priority:P0"
  "TICKET-08|docs/tickets/TICKET-08-official-basic-rules.md|ready-for-agent,payroll-correction,priority:P0"
  "TICKET-09|docs/tickets/TICKET-09-net-equality-never-copy.md|ready-for-agent,payroll-correction,priority:P0"
  "TICKET-10|docs/tickets/TICKET-10-dead-input-fields.md|ready-for-agent,payroll-correction,priority:P2"
  "TICKET-11|docs/tickets/TICKET-11-stop-category-band-guessing.md|ready-for-agent,payroll-correction,priority:P0"
  "TICKET-12|docs/tickets/TICKET-12-special-on-official-sheet.md|ready-for-agent,payroll-correction,priority:P1"
  "TICKET-13|docs/tickets/TICKET-13-docs-and-adr.md|ready-for-agent,payroll-correction,priority:P1"
  "TICKET-14|docs/tickets/TICKET-14-test-suite.md|ready-for-agent,payroll-correction,priority:P0"
  "TICKET-15|docs/tickets/TICKET-15-stale-exports-build-divergence.md|ready-for-human,payroll-correction,priority:P1"
)

echo "── issues ──"
for spec in "${ISSUES[@]}"; do
  IFS='|' read -r key file labels <<< "$spec"
  [[ -f "$file" ]] || { echo "error: missing $file"; exit 1; }

  title=$(head -1 "$file" | sed 's/^# //')
  existing=$(gh issue list --state all --limit 300 --search "$key in:title" \
             --json number,title --jq ".[] | select(.title | startswith(\"$key\")) | .number" | head -1)

  if [[ -n "$existing" ]]; then
    echo "  = #$existing  $key (exists)"
    echo "$key $existing" >> "$MAP.tmp"
    continue
  fi

  if [[ $DRY_RUN == 1 ]]; then
    echo "  + $key  [$labels]"
    echo "    $title"
    echo "$key DRYRUN" >> "$MAP.tmp"
    continue
  fi

  body=$(printf '%s\n\n---\n\nSpec: `docs/SPEC-payroll.md` · Batch: `docs/tickets/INDEX.md` · Handoff: `HANDOFF.md`\n' "$(cat "$file")")
  url=$(gh issue create --title "$title" --body "$body" --label "$labels")
  num="${url##*/}"
  echo "  + #$num  $key"
  echo "$key $num" >> "$MAP.tmp"
done
mv "$MAP.tmp" "$MAP"
echo

# --------------------------------------------------- native dependencies ----
# child:blocker[,blocker...]   — mirrors docs/tickets/INDEX.md
DEPS=(
  "TICKET-04:TICKET-01"
  "TICKET-05:TICKET-01"
  "TICKET-07:TICKET-01"
  "TICKET-08:TICKET-07"
  "TICKET-09:TICKET-07,TICKET-08"
  "TICKET-10:TICKET-01"
  "TICKET-12:TICKET-01,TICKET-07,TICKET-11"
  "TICKET-13:TICKET-01,TICKET-07,TICKET-08,TICKET-09"
  "TICKET-14:TICKET-01,TICKET-02,TICKET-03,TICKET-04,TICKET-05,TICKET-06,TICKET-07,TICKET-08,TICKET-09,TICKET-10,TICKET-11,TICKET-12"
)

num_for() { grep "^$1 " "$MAP" | awk '{print $2}'; }
db_id()   { gh api "repos/$REPO/issues/$1" --jq .id; }

echo "── dependencies ──"
for spec in "${DEPS[@]}"; do
  child_key="${spec%%:*}"; blockers="${spec#*:}"
  child=$(num_for "$child_key")
  [[ -n "$child" ]] || { echo "  ! no issue for $child_key"; continue; }

  IFS=',' read -ra list <<< "$blockers"
  for bk in "${list[@]}"; do
    b=$(num_for "$bk")
    [[ -n "$b" ]] || { echo "  ! no issue for $bk"; continue; }
    if [[ $DRY_RUN == 1 ]]; then
      echo "  + $child_key blocked by $bk"
      continue
    fi
    if gh api --method POST "repos/$REPO/issues/$child/dependencies/blocked_by" \
         -F "issue_id=$(db_id "$b")" >/dev/null 2>&1; then
      echo "  + #$child blocked by #$b"
    else
      # Dependencies unavailable on this repo — fall back to a body line
      # (docs/agents/issue-tracker.md, "Where dependencies aren't available").
      echo "  ~ #$child blocked by #$b (API unavailable — add 'Blocked by: #$b' to the body manually)"
    fi
  done
done

echo
echo "done. issue map written to $MAP"
echo "next: read HANDOFF.md, then start with TICKET-06."
