#!/usr/bin/env bash
# Local merge queue (agents/PROTOCOL.md section 7). The repo is private on a free plan: no GitHub merge queue,
# branch protection or auto-merge. This gives the same guarantee: one merge at a time, and a PR merges only
# when its head contains the current main AND every CI check on that head is green.
#
#   scripts/merge.sh <n>        merge card n's open PR (branch from its newest TRUSTED PICKUP comment)
#
# The repo is public: the branch comes only from `board.ts pickup-branch` (comments by BOARD_TRUSTED_AUTHORS),
# and only a PR from this repository is merged (a fork can open a PR from a branch with the card's name).
# Env: MERGE_LOCK overrides the queue lock directory (tests only).
#
# Exit: 0 merged | 1 checks failed or PR not mergeable | 4 merge conflict with main (resolve in the worktree,
# push, re-run) | 5 queue lock timeout.
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(cd "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")" && pwd)"
REPO="${BOARD_REPO:-jimmy-razafindretsa/fifth-copy}"
n="${1:-}"; n="${n#\#}"
[[ "$n" =~ ^[0-9]+$ ]] || { echo "usage: scripts/merge.sh <n>"; exit 2; }

branch="$(npx tsx scripts/board.ts pickup-branch "$n")" || branch=""
[[ -n "$branch" ]] || { echo "merge: #$n has no PICKUP comment from a trusted author"; exit 1; }
pr="$(gh pr list --repo "$REPO" --head "$branch" --state open --json number,isCrossRepository \
  -q '[.[] | select(.isCrossRepository == false)][0].number // empty')"
[[ "$pr" =~ ^[0-9]+$ ]] || { echo "merge: no open PR for $branch from $REPO (fork PRs are never merged)"; exit 1; }

LOCK="${MERGE_LOCK:-$ROOT/.cache/merge.lock}"
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
  # Wait for the CI run of this exact head commit. `gh pr checks` is unreliable right after a branch
  # update (it can show the previous head's checks, then "no checks" while the new run is queued),
  # so follow the run bound to head_sha. Runs can queue for a while when parallel cards share runners.
  run=""
  for ((w = 0; w < 120; w++)); do
    run="$(gh run list --repo "$REPO" --commit "$head_sha" --event pull_request --json databaseId -q '.[0].databaseId' 2>/dev/null)"
    [[ -n "$run" ]] && break
    sleep 10
  done
  [[ -n "$run" ]] || { echo "merge: no CI run for ${head_sha:0:7} after 20 min"; exit 1; }
  if ! gh run watch "$run" --repo "$REPO" --exit-status --interval 20 >/dev/null 2>&1; then
    echo "merge: CI run $run failed on PR #$pr (head ${head_sha:0:7}):"
    gh run view "$run" --repo "$REPO" 2>&1 | grep -E "^X |failed|✗" | head -5 | sed 's/^/  /'
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
