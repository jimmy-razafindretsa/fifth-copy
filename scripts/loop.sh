#!/usr/bin/env bash
# Orchestration mode C (agents/PROTOCOL.md section 13): one fresh agent session per role per card,
# up to N cards in parallel, each in its own isolated worktree (scripts/worktree.sh).
# Agent-agnostic: AGENT_CMD is any runtime that takes a prompt as its last argument, e.g.
#   AGENT_CMD="claude -p --permission-mode bypassPermissions"  (use the full path if claude is not on PATH,
#   e.g. ~/.local/bin/claude; the CLI needs its own login: run it once and /login)   or   AGENT_CMD="codex exec"
#
#   scripts/loop.sh [--parallel N] [--max-cards N] [--dry-run]
#   scripts/loop.sh --finish <n>     finish a parked card after the human removed needs-human (merge, Done)
#
# Script-owned steps (no agent session): promote (Backlog -> Ready), next, pickup, worktree, check.sh,
# gates (board.ts gate), merge (scripts/merge.sh), cleanup. Agent sessions: explorer (unless tier lite),
# builder or ui, pentester (pentest cards), deliver; builder again only to fix a red check or a merge conflict.
# Tiers (scripts/lib/flow.ts cardTier): lite = no Explorer; standard = Explorer on MODEL_BUILD;
# full = Explorer on MODEL_ANALYSIS.
#
# Env: MODEL_ANALYSIS (default claude-fable-5-1, probed once; fallback MODEL_ANALYSIS_FALLBACK, default
# claude-opus-5-5), MODEL_BUILD (default claude-opus-5-5), MODEL_FLAG (default --model), BOARD_WIP_LIMIT
# (default = --parallel), BOARD_FOCUS_LABEL (only pick cards with this label, e.g. mvp), SWEEP_EVERY (drift sweep after every N delivered cards, default 10, 0 = off),
# HARDENING_EPIC (epic for sweep findings), NOTIFY_CMD (called with one message argument; default: macOS
# notification), LOCK_WAIT_MIN (max minutes a card waits for a hotspot lock, default 180).
# Stop: no startable card and nothing running; --max-cards reached; 3 consecutive blocked cards; main red;
# or `touch .cache/loop/STOP` (running cards finish, nothing new starts).
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(cd "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")" && pwd)"
cd "$ROOT"

PARALLEL=1
MAX_CARDS=10
MAX_BLOCKED_STREAK=3
DRY=0
FINISH=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --parallel) PARALLEL="$2"; shift 2 ;;
    --max-cards) MAX_CARDS="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --finish) FINISH="${2#\#}"; shift 2 ;;
    *) echo "usage: scripts/loop.sh [--parallel N] [--max-cards N] [--dry-run] | --finish <n>"; exit 2 ;;
  esac
done
export BOARD_WIP_LIMIT="${BOARD_WIP_LIMIT:-$PARALLEL}"
MODEL_FLAG="${MODEL_FLAG:---model}"
MODEL_ANALYSIS="${MODEL_ANALYSIS:-claude-fable-5-1}"
MODEL_ANALYSIS_FALLBACK="${MODEL_ANALYSIS_FALLBACK:-claude-opus-5-5}"
MODEL_BUILD="${MODEL_BUILD:-claude-opus-5-5}"
SWEEP_EVERY="${SWEEP_EVERY:-10}"
HARDENING_EPIC="${HARDENING_EPIC:-475}"
LOCK_WAIT_MIN="${LOCK_WAIT_MIN:-180}"
LOG_DIR="$ROOT/.cache/loop"
mkdir -p "$LOG_DIR"
board() { npx tsx scripts/board.ts "$@"; }
exec 3>&1 # progress lines reach the terminal even from background card pipelines
say() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG_DIR/loop.log" >&3; }
unpark() { grep -vx "$1" "$LOG_DIR/parked" >"$LOG_DIR/parked.tmp" 2>/dev/null; mv "$LOG_DIR/parked.tmp" "$LOG_DIR/parked"; }

notify() {
  echo "$(date -u +%FT%TZ) $1" >>"$LOG_DIR/notify.log"
  if [[ -n "${NOTIFY_CMD:-}" ]]; then $NOTIFY_CMD "$1" >/dev/null 2>&1 || true
  elif command -v osascript >/dev/null; then
    osascript -e "display notification \"${1//\"/\'}\" with title \"Fifth Copy loop\"" >/dev/null 2>&1 || true
  fi
}

if (( ! DRY )); then
  : "${AGENT_CMD:?set AGENT_CMD, e.g. AGENT_CMD=\"claude -p --permission-mode bypassPermissions\"}"
  # The build model must answer, or nothing can run: stop before claiming any card
  # (catches a runtime missing from PATH or not logged in).
  # shellcheck disable=SC2086
  if ! $AGENT_CMD $MODEL_FLAG "$MODEL_BUILD" "Reply with the single word OK." >"$LOG_DIR/agent-probe.log" 2>&1 \
    || ! grep -q "OK" "$LOG_DIR/agent-probe.log"; then
    echo "STOP: AGENT_CMD cannot run ($AGENT_CMD $MODEL_FLAG $MODEL_BUILD): $(tail -1 "$LOG_DIR/agent-probe.log")"
    exit 1
  fi
  # One availability probe for the analysis model (PROTOCOL section 12).
  # shellcheck disable=SC2086
  if ! $AGENT_CMD $MODEL_FLAG "$MODEL_ANALYSIS" "Reply with the single word OK." >"$LOG_DIR/model-probe.log" 2>&1; then
    say "model: $MODEL_ANALYSIS unavailable, analysis falls back to $MODEL_ANALYSIS_FALLBACK"
    MODEL_ANALYSIS="$MODEL_ANALYSIS_FALLBACK"
  fi
fi

model_for() { # role tier -> model id
  case "$1" in
    analyst|pentester|sweep) echo "$MODEL_ANALYSIS" ;;
    explorer) [[ "$2" == full ]] && echo "$MODEL_ANALYSIS" || echo "$MODEL_BUILD" ;;
    *) echo "$MODEL_BUILD" ;;
  esac
}

run_role() { # role card tier dir extra
  local role="$1" n="$2" tier="$3" dir="$4" extra="$5"
  local model log k=1
  model="$(model_for "$role" "$tier")"
  while [[ -e "$LOG_DIR/$n-$role-$k.log" ]]; do k=$((k + 1)); done
  log="$LOG_DIR/$n-$role-$k.log"
  local prompt="You are running ONE role of the agent kit. Read AGENTS.md, agents/PROTOCOL.md and agents/roles/$role.md (and no other role file). Your card: #$n (tier $tier). You run in the card worktree $dir: load its env first (set -a; . ./.env; set +a), use only its ports and databases, and never touch other worktrees or the main checkout; other cards run in parallel. $extra Follow the session start and end rituals. End by posting your HANDOFF (BRIEF for explorer, PENTEST for pentester) on the card and print one final line: RESULT: done|partial|blocked."
  say "#$n -> $role ($model) log: ${log#$ROOT/}"
  # shellcheck disable=SC2086
  (cd "$dir" && $AGENT_CMD $MODEL_FLAG "$model" "$prompt") >"$log" 2>&1
  local result
  result="$(grep -Eo 'RESULT: (done|partial|blocked)' "$log" | tail -1 | cut -d' ' -f2)"
  say "#$n <- $role: ${result:-unknown}"
  [[ "$result" == "done" ]]
}

labels_of() { board get "$1" --comments 0 2>/dev/null | sed -n 's/^labels: //p'; }
has_label() { echo ", $(labels_of "$1")," | grep -q ", $2,"; }

checks_in() { # dir -> runs check.sh with the worktree env
  (cd "$1" && set -a && . ./.env && set +a && scripts/check.sh) >"$LOG_DIR/$(basename "$1")-check.log" 2>&1
}

# Merge (local queue), then wait for main CI and the Done gate. Shared by run_card and --finish.
land_card() { # n tier
  local n="$1" tier="$2" wt="$ROOT/.worktrees/$1" rc
  board gate "$n" QA >>"$LOG_DIR/$n.flow.log" 2>&1 || { tail -3 "$LOG_DIR/$n.flow.log"; echo "blocked: QA gate"; return 1; }
  scripts/merge.sh "$n" >>"$LOG_DIR/$n.flow.log" 2>&1; rc=$?
  if (( rc == 4 )) && [[ -d "$wt" ]]; then
    run_role builder "$n" "$tier" "$wt" "Merge conflict only: merge origin/main into the card branch, resolve the conflicts without widening scope, re-run scripts/check.sh until green, push. Do not touch the PR otherwise." \
      && scripts/merge.sh "$n" >>"$LOG_DIR/$n.flow.log" 2>&1; rc=$?
  fi
  (( rc == 0 )) || { echo "blocked: merge (exit $rc, see ${LOG_DIR#$ROOT/}/$n.flow.log)"; return 1; }
  local i out
  for ((i = 0; i < 60; i++)); do
    out="$(board gate "$n" Done 2>&1)" && { echo "$out" >>"$LOG_DIR/$n.flow.log"; break; }
    if echo "$out" | grep -q "merge commit: failure"; then
      touch "$LOG_DIR/STOP"; notify "main is RED after merging #$n. Loop stopped."
      echo "blocked: main red after merge"; return 1
    fi
    sleep 30
  done
  (( i < 60 )) || { echo "blocked: Done gate timeout"; return 1; }
  scripts/worktree.sh --remove "$n" >>"$LOG_DIR/$n.flow.log" 2>&1 || true
  echo "done"
}

run_card() { # n tier branch ; prints the final status line to $LOG_DIR/<n>.status
  local n="$1" tier="$2" branch="$3" wt="$ROOT/.worktrees/$1" builder=builder
  finish() { echo "$1" >"$LOG_DIR/$n.status"; say "#$n $1"; }
  scripts/worktree.sh "$n" "$branch" >>"$LOG_DIR/$n.flow.log" 2>&1 || { finish "blocked: worktree bootstrap"; return; }
  if [[ "$tier" != lite ]]; then
    run_role explorer "$n" "$tier" "$wt" "Produce the BRIEF. Label the card touches:<hotspot> for every hotspot path the plan touches (PROTOCOL section 7)." \
      || { finish "blocked: explorer"; return; }
  fi
  local waited=0
  until board locks "$n" >>"$LOG_DIR/$n.flow.log" 2>&1; do
    (( waited >= LOCK_WAIT_MIN )) && { finish "blocked: hotspot lock wait > ${LOCK_WAIT_MIN}m"; return; }
    sleep 60; waited=$((waited + 1))
  done
  has_label "$n" ui && builder=ui
  run_role "$builder" "$n" "$tier" "$wt" "Implement the card in this worktree and open the PR." || { finish "blocked: $builder"; return; }
  if ! checks_in "$wt"; then
    run_role "$builder" "$n" "$tier" "$wt" "scripts/check.sh is red in this worktree (log .cache/check/). Fix it within the card's scope, push, update the HANDOFF." \
      && checks_in "$wt" || { finish "blocked: check.sh red after one fix cycle"; return; }
  fi
  if has_label "$n" pentest; then
    run_role pentester "$n" "$tier" "$wt" "Attack the change in the PR on localhost only (this worktree's ports) and post the PENTEST comment." \
      || { finish "blocked: pentester"; return; }
  fi
  board gate "$n" "In Review" >>"$LOG_DIR/$n.flow.log" 2>&1 || { finish "blocked: In Review gate ($(grep FAIL "$LOG_DIR/$n.flow.log" | tail -1))"; return; }
  run_role deliver "$n" "$tier" "$wt" "Review, QA and verdict. Do not merge: the loop's merge queue (scripts/merge.sh) merges after your pass verdict." \
    || { has_label "$n" needs-human && { finish "parked: needs-human"; return; }; finish "blocked: deliver"; return; }
  if has_label "$n" needs-human; then finish "parked: needs-human"; return; fi
  finish "$(land_card "$n" "$tier" | tail -1)"
}

if [[ -n "$FINISH" ]]; then
  [[ "$FINISH" =~ ^[0-9]+$ ]] || { echo "usage: --finish <n>"; exit 2; }
  if has_label "$FINISH" needs-human; then echo "STOP: #$FINISH still carries needs-human"; exit 1; fi
  r="$(land_card "$FINISH" standard | tail -1)"; echo "$r" >"$LOG_DIR/$FINISH.status"; say "#$FINISH $r"
  unpark "$FINISH" 2>/dev/null || true
  [[ "$r" == done ]]; exit $?
fi

if (( DRY )); then
  board promote --dry-run | tail -3
  board next | tail -4
  echo "[dry-run] would run up to $PARALLEL card(s) in parallel, max $MAX_CARDS"
  exit 0
fi

if [[ "$(git branch --show-current)" != main ]] || ! git diff --quiet || ! git diff --cached --quiet; then
  echo "STOP: run the loop from a clean main checkout ($ROOT is on $(git branch --show-current))"; exit 1
fi
git pull -q --ff-only origin main || { echo "STOP: cannot fast-forward main"; exit 1; }

COORD="$LOG_DIR/coordinator.lock"
mkdir "$COORD" 2>/dev/null || { echo "STOP: another loop.sh is running ($COORD)"; exit 1; }
trap 'rm -rf "$COORD"' EXIT
rm -f "$LOG_DIR/STOP"
touch "$LOG_DIR/parked"
say "loop: parallel=$PARALLEL wip=$BOARD_WIP_LIMIT max-cards=$MAX_CARDS models: analysis=$MODEL_ANALYSIS build=$MODEL_BUILD"

running=""          # "pid:n pid:n ..."
started=0 delivered=0 swept=0 blocked_streak=0 exhausted=0
last_promote=0 last_parked_scan=0 last_next=0
sweep_since="$(git rev-parse origin/main 2>/dev/null)"

while :; do
  # Reap finished cards.
  still=""
  for entry in $running; do
    pid="${entry%%:*}" n="${entry#*:}"
    if kill -0 "$pid" 2>/dev/null; then still="$still $entry"; continue; fi
    wait "$pid" 2>/dev/null
    st="$(cat "$LOG_DIR/$n.status" 2>/dev/null || echo "blocked: no status")"
    case "$st" in
      done) delivered=$((delivered + 1)); blocked_streak=0 ;;
      parked*) echo "$n" >>"$LOG_DIR/parked"; blocked_streak=0
        notify "#$n needs your review (major design choice). Remove needs-human to let the loop merge it." ;;
      *) blocked_streak=$((blocked_streak + 1)); notify "#$n $st" ;;
    esac
  done
  running="$still"

  stop_reason=""
  [[ -f "$LOG_DIR/STOP" ]] && stop_reason="STOP file present"
  (( blocked_streak >= MAX_BLOCKED_STREAK )) && stop_reason="$MAX_BLOCKED_STREAK consecutive blocked cards"
  (( started >= MAX_CARDS )) && stop_reason="${stop_reason:-reached --max-cards $MAX_CARDS}"

  now=$(date +%s)
  # Parked cards the human released (needs-human removed): land them.
  if (( now - last_parked_scan > 120 )) && [[ -s "$LOG_DIR/parked" ]]; then
    last_parked_scan=$now
    for n in $(sort -u "$LOG_DIR/parked"); do
      case " $running " in *":$n "*) continue ;; esac
      if ! has_label "$n" needs-human; then
        unpark "$n"
        say "#$n released by the human, landing"
        ( r="$(land_card "$n" standard | tail -1)"; echo "$r" >"$LOG_DIR/$n.status"; say "#$n $r" ) &
        running="$running $!:$n"
      fi
    done
  fi

  # Claim new cards while slots are free. Claiming is serialized here (single coordinator).
  # When the queue was empty, re-poll the board at most every 2 minutes (GraphQL budget).
  if [[ -z "$stop_reason" ]] && (( ! exhausted || now - last_next > 120 )); then
    last_next=$now
    if (( now - last_promote > 600 )); then board promote >"$LOG_DIR/promote.log" 2>&1; last_promote=$now; fi
    set -- $running
    while (( $# < PARALLEL && started < MAX_CARDS )); do
      next_out="$(board next 2>&1)"
      card="$(echo "$next_out" | sed -n 's/^next: #//p' | tail -1)"
      if [[ -z "$card" ]]; then exhausted=1; echo "$next_out" | tail -3 >"$LOG_DIR/next.log"; break; fi
      exhausted=0
      if ! pick="$(board pickup "$card" 2>&1)"; then say "pickup #$card refused: $(echo "$pick" | tail -1)"; exhausted=1; break; fi
      tier="$(echo "$pick" | sed -n 's/^tier: \([a-z]*\).*/\1/p')"
      branch="$(echo "$pick" | sed -n 's/^branch: //p')"
      rm -f "$LOG_DIR/$card.status"
      say "picked #$card tier=${tier:-standard} branch=$branch"
      run_card "$card" "${tier:-standard}" "$branch" >>"$LOG_DIR/$card.flow.log" 2>&1 &
      running="$running $!:$card"
      started=$((started + 1))
      set -- $running
    done
  fi

  # Drift sweep after every SWEEP_EVERY delivered cards (read-only; files findings as cards).
  if (( SWEEP_EVERY > 0 && delivered - swept >= SWEEP_EVERY )); then
    swept=$delivered
    head="$(git fetch -q origin main && git rev-parse origin/main)"
    ( run_role sweep "sweep-$(date +%s)" full "$ROOT" "There is no card: review the range $sweep_since..$head (git diff $sweep_since $head). Hardening epic: ${HARDENING_EPIC:-see agents/BOARD.md}." ) &
    sweep_since="$head"
  fi

  set -- $running
  if (( $# == 0 )); then
    if [[ -n "$stop_reason" ]]; then say "STOP: $stop_reason (delivered $delivered)"; exit 0; fi
    if (( exhausted )); then say "STOP: no startable card ($(tail -1 "$LOG_DIR/next.log")); delivered $delivered"; exit 0; fi
  fi
  sleep 20
done
