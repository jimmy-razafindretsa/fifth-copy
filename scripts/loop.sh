#!/usr/bin/env bash
# Orchestration mode C (agents/PROTOCOL.md section 13): one fresh agent session per role per card.
# Agent-agnostic: AGENT_CMD is any runtime that takes a prompt as its last argument, e.g.
#   AGENT_CMD="claude -p"   or   AGENT_CMD="codex exec"
# Models per role (PROTOCOL section 12), passed as "--model <id>" (MODEL_FLAG to change the flag):
#   MODEL_ANALYSIS (explorer, analyst, pentester) default claude-fable-5-1, MODEL_BUILD (builder, ui, deliver, picker)
#   default claude-opus-5-5. Fable is probed once per run; if the probe fails, MODEL_ANALYSIS_FALLBACK (default
#   claude-opus-5-5) is used.
#
#   scripts/loop.sh [--max-cards N] [--dry-run]
#
# The durable handoff is the GitHub board (issues + project) + repo, never this script's memory. Stop conditions follow PROTOCOL section 8.
set -uo pipefail
cd "$(dirname "$0")/.."

MAX_CARDS=10
MAX_BLOCKED_STREAK=3
DRY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --max-cards) MAX_CARDS="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    *) echo "usage: scripts/loop.sh [--max-cards N] [--dry-run]"; exit 2 ;;
  esac
done
: "${AGENT_CMD:?set AGENT_CMD, e.g. AGENT_CMD=\"claude -p\"}"
MODEL_FLAG="${MODEL_FLAG:---model}"
MODEL_ANALYSIS="${MODEL_ANALYSIS:-claude-fable-5-1}"
MODEL_ANALYSIS_FALLBACK="${MODEL_ANALYSIS_FALLBACK:-claude-opus-5-5}"
MODEL_BUILD="${MODEL_BUILD:-claude-opus-5-5}"
LOG_DIR=.cache/loop
mkdir -p "$LOG_DIR"
board() { npx tsx scripts/board.ts "$@"; }

# One availability probe for the analysis model (PROTOCOL section 12: Fable if available, else Opus).
if (( ! DRY )); then
  # shellcheck disable=SC2086
  if ! $AGENT_CMD $MODEL_FLAG "$MODEL_ANALYSIS" "Reply with the single word OK." >"$LOG_DIR/model-probe.log" 2>&1; then
    echo "model: $MODEL_ANALYSIS unavailable, analysis roles fall back to $MODEL_ANALYSIS_FALLBACK (log: $LOG_DIR/model-probe.log)"
    MODEL_ANALYSIS="$MODEL_ANALYSIS_FALLBACK"
  fi
fi
echo "models: analysis=$MODEL_ANALYSIS (explorer, analyst, pentester) build=$MODEL_BUILD (builder, ui, deliver, picker)"

model_for() { # role -> model id
  case "$1" in
    explorer|analyst|pentester) echo "$MODEL_ANALYSIS" ;;
    *) echo "$MODEL_BUILD" ;;
  esac
}

run_role() { # role, card (#n), extra instructions
  local role="$1" card="$2" extra="$3" log="$LOG_DIR/${2#\#}-$1.log"
  local model; model="$(model_for "$role")"
  local prompt="You are running ONE role of the agent kit. Read AGENTS.md, agents/PROTOCOL.md and agents/roles/$role.md (and no other role file). Your card: $card. $extra Follow the session start and end rituals. End by posting your HANDOFF (BRIEF for explorer, PENTEST for pentester) on the card and print one final line: RESULT: done|partial|blocked."
  echo "  -> $role ($card) model: $model log: $log"
  if (( DRY )); then echo "     [dry-run] $AGENT_CMD $MODEL_FLAG $model \"<prompt for $role>\""; echo "RESULT: done" >"$log"; return 0; fi
  # shellcheck disable=SC2086
  $AGENT_CMD $MODEL_FLAG "$model" "$prompt" >"$log" 2>&1
  local result
  result="$(grep -Eo 'RESULT: (done|partial|blocked)' "$log" | tail -1 | cut -d' ' -f2)"
  echo "     result: ${result:-unknown}"
  [[ "$result" == "done" ]]
}

card_labels() { board get "${1#\#}" --comments 0 2>/dev/null | sed -n 's/^labels: //p'; }

blocked_streak=0
for ((n = 1; n <= MAX_CARDS; n++)); do
  echo "== iteration $n"
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "STOP: working tree on $(git branch --show-current) is not clean"; exit 1
  fi
  next_out="$(board next 2>&1)"; rc=$?
  echo "$next_out" | tail -5 | sed 's/^/  /'
  if (( rc != 0 )); then echo "STOP: $(echo "$next_out" | grep -E '^(STOP|board):' | tail -1)"; exit 0; fi
  card="$(echo "$next_out" | sed -n 's/^next: //p' | tail -1)"
  [[ -z "$card" ]] && { echo "STOP: picker returned no card"; exit 1; }
  labels="$(card_labels "$card")"
  builder=builder
  if echo ", $labels," | grep -q ", ui,"; then builder=ui; fi

  ok=1
  run_role picker "$card" "Pick up this card: verify Ready -> In Progress preconditions, move it, post PICKUP with the contract hash, create the worktree. Do not dispatch other roles; this script does." || ok=0
  (( ok )) && { run_role explorer "$card" "Produce the BRIEF." || ok=0; }
  (( ok )) && { run_role "$builder" "$card" "Implement the card in the worktree named in PICKUP and open the PR." || ok=0; }
  # Pen tester only when the Explorer's analysis labeled the card (PROTOCOL section 12).
  labels="$(card_labels "$card")"
  if (( ok )) && echo ", $labels," | grep -q ", pentest,"; then
    run_role pentester "$card" "Attack the change in the PR on localhost only and post the PENTEST comment." || ok=0
  fi
  (( ok )) && { run_role picker "$card" "Gate check only: verify In Progress -> In Review preconditions yourself (re-run scripts/check.sh in the worktree; PENTEST comment present if the card carries pentest) and move the card if they hold." || ok=0; }
  (( ok )) && { run_role deliver "$card" "Review, QA and deliver this card." || ok=0; }
  (( ok )) && { run_role picker "$card" "Gate check only: verify In Review -> QA -> Done preconditions per PROTOCOL section 5 and move the card if they hold. Never move on a role's claim alone." || ok=0; }

  labels="$(card_labels "$card")"
  if (( ok )) && [[ "$labels" != *needs-* ]]; then
    blocked_streak=0
  else
    blocked_streak=$((blocked_streak + 1))
    echo "  card $card did not complete (labels: ${labels:-?}); blocked streak $blocked_streak/$MAX_BLOCKED_STREAK"
    if (( blocked_streak >= MAX_BLOCKED_STREAK )); then echo "STOP: $MAX_BLOCKED_STREAK consecutive blocked cards"; exit 1; fi
  fi
  if [[ "$labels" == *autonomy:hitl* ]]; then
    echo "STOP: $card is autonomy:hitl. Human: review the PR and the Deliver HANDOFF on $card."; exit 0
  fi
done
echo "STOP: reached --max-cards $MAX_CARDS"
