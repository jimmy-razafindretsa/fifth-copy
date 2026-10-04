#!/usr/bin/env bash
# Local merge queue (agents/PROTOCOL.md section 7). The repo is private on a free plan: no GitHub merge queue,
# branch protection or auto-merge. This gives the same guarantee: one merge at a time, and a PR merges only
# when its head contains the current main AND every CI check on that head is green.
#
#   scripts/merge.sh <n>        merge card n's open PR (branch from its PICKUP comment)
#
# Exit: 0 merged | 1 checks failed or PR not mergeable | 4 merge conflict with main (resolve in the worktree,
# push, re-run) | 5 queue lock timeout.
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(cd "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")" && pwd)"
REPO="${BOARD_REPO:-jimmy-razafindretsa/fifth-copy}"
n="${1:-}"; n="${n#\#}"
[[ "$n" =~ ^[0-9]+$ ]] || { echo "usage: scripts/merge.sh <n>"; exit 2; }

branch="$(npx tsx scripts/board.ts get "$n" --comments 100 | grep -Eo "^PICKUP #$n contract_hash=[0-9a-f]+ branch=[^ ]+" | tail -1 | sed 's/.*branch=//')"
[[ -n "$branch" ]] || { echo "merge: #$n has no PICKUP comment"; exit 1; }
pr="$(gh pr list --repo "$REPO" --head "$branch" --state open --json number -q '.[0].number')"
[[ -n "$pr" ]] || { echo "merge: no open PR for $branch"; exit 1; }

LOCK="$ROOT/.cache/merge.lock"
mkdir -p "$ROOT/.cache"
for ((i = 0; i < 360; i++)); do mkdir "$LOCK" 2>/dev/null && break; sleep 10; done
[[ -d "$LOCK" ]] || { echo "merge: queue lock timeout ($LOCK)"; exit 5; }
echo "$$ #$n" >"$LOCK/owner"
trap 'rm -rf "$LOCK"' EXIT

for attempt in 1 2 3; do
  main_sha="$(gh api "repos/$REPO/commits/main" -q .sha)"
  head_sha="$(gh pr view "$pr" --repo "$REPO" --json headRefOid -q .headRefOid)"
  behind="$(gh api "repos/$REPO/compare/$main_sha...$head_sha" -q .behind_by)"
  if [[ "$behind" != 0 ]]; then
    echo "merge: PR #$pr is $behind commit(s) behind main, updating (attempt $attempt)"
    if ! gh pr update-branch "$pr" --repo "$REPO" >/dev/null 2>&1; then
      state="$(gh pr view "$pr" --repo "$REPO" --json mergeable -q .mergeable)"
      if [[ "$state" == CONFLICTING ]]; then echo "merge: CONFLICT between $branch and main"; exit 4; fi
      echo "merge: update-branch failed (mergeable=$state)"; exit 1
    fi
    sleep 15
    continue
  fi
  # Wait for checks on this exact head (they may take a few seconds to register after a push).
  for ((w = 0; w < 12; w++)); do
    gh pr checks "$pr" --repo "$REPO" 2>&1 | grep -q "no checks reported" || break
    sleep 10
  done
  if ! gh pr checks "$pr" --repo "$REPO" --watch --fail-fast --interval 20 >/dev/null 2>&1; then
    echo "merge: checks failed on PR #$pr:"
    gh pr checks "$pr" --repo "$REPO" 2>&1 | grep -Ev "pass|skipping" | head -5 | sed 's/^/  /'
    exit 1
  fi
  if [[ "$(gh api "repos/$REPO/commits/main" -q .sha)" != "$main_sha" ]]; then
    echo "merge: main moved while checks ran, re-syncing"; continue
  fi
  if gh pr merge "$pr" --repo "$REPO" --merge --match-head-commit "$head_sha" >/dev/null; then
    echo "merge: merged PR #$pr ($branch) at head ${head_sha:0:7}"
    exit 0
  fi
  echo "merge: gh pr merge refused (attempt $attempt)"
done
echo "merge: gave up after 3 attempts"
exit 1
