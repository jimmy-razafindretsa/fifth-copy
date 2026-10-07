/**
 * scripts/merge.sh against a stub `gh` on PATH (pattern: deploy-smoke.test.ts): the branch comes only from the
 * newest TRUSTED PICKUP (via `board.ts pickup-branch`) and fork PRs (isCrossRepository) are never selected.
 * No network: every `gh` call, including board.ts's `gh api graphql`, is answered by the stub and logged.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const N = 553;
const BRANCH = "553-public-repo-safety-gates-trust-only-owne";
const OWNER = "jimmy-razafindretsa";
const pickupBody = (branch: string) =>
  `PICKUP #${N} contract_hash=d703e8a79b78 branch=${branch} worktree=.worktrees/${N}`;

// Answers only what merge.sh asks; ends a same-repo run at "CI failed" so `pr merge` is never reached.
// `pr list` applies merge.sh's own -q/--jq filter with real jq, so the filter under test is merge.sh's.
const STUB = `#!/bin/sh
echo "$*" >>"$GH_LOG"
filter=""; prev=""
for a in "$@"; do
  if [ "$prev" = "-q" ] || [ "$prev" = "--jq" ]; then filter="$a"; fi
  prev="$a"
done
case "$1 $2" in
  "api graphql") cat >/dev/null; cat "$GH_ISSUE"; exit 0 ;;
  "pr list") jq -r "\${filter:-.}" "$GH_PRS"; exit $? ;;
  "pr view") echo headsha; exit 0 ;;
  "pr merge") exit 0 ;;
  "run list") echo 99; exit 0 ;;
  "run watch") exit 1 ;;
  "run view") echo "X ci failed"; exit 0 ;;
esac
case "$2" in
  */commits/main) echo mainsha ;;
  */compare/*) echo 0 ;;
esac
exit 0
`;

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "merge-gh-"));
  writeFileSync(join(dir, "gh"), STUB);
  chmodSync(join(dir, "gh"), 0o755);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

type C = { body: string; createdAt: string; author: { login: string } | null };
function run(comments: C[], prs: { number: number; isCrossRepository: boolean }[]) {
  const issue = {
    data: { repository: { issue: { number: N, body: "", comments: { nodes: comments } } } },
  };
  writeFileSync(join(dir, "issue.json"), JSON.stringify(issue));
  writeFileSync(join(dir, "prs.json"), JSON.stringify(prs));
  rmSync(join(dir, "gh.log"), { force: true });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${dir}:${process.env.PATH ?? ""}`,
    GH_LOG: join(dir, "gh.log"),
    GH_ISSUE: join(dir, "issue.json"),
    GH_PRS: join(dir, "prs.json"),
    BOARD_REPO: `${OWNER}/fifth-copy`,
    MERGE_LOCK: join(dir, "merge.lock"),
  };
  delete env.BOARD_TRUSTED_AUTHORS;
  const r = spawnSync("bash", ["scripts/merge.sh", String(N)], {
    encoding: "utf8",
    env,
    timeout: 60_000,
  });
  const log = existsSync(env.GH_LOG!) ? readFileSync(env.GH_LOG!, "utf8") : "";
  return { status: r.status, out: `${r.stdout}${r.stderr}`, log };
}

const trustedPickup: C = {
  body: pickupBody(BRANCH),
  createdAt: "2026-10-06T22:16:36Z",
  author: { login: OWNER },
};

describe("scripts/merge.sh", { timeout: 60_000 }, () => {
  it("never selects a fork PR, even on the card's branch", () => {
    const r = run([trustedPickup], [{ number: 9, isCrossRepository: true }]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("no open PR");
    expect(r.log).toContain(`pr list --repo ${OWNER}/fifth-copy --head ${BRANCH}`);
    expect(r.log).not.toContain("pr view");
    expect(r.log).not.toContain("pr merge");
  });

  it("takes the same-repo PR on the trusted branch and reaches the PR lookup step", () => {
    const r = run(
      [trustedPickup],
      [
        { number: 9, isCrossRepository: true },
        { number: 7, isCrossRepository: false },
      ],
    );
    expect(r.status).toBe(1);
    expect(r.out).toContain("CI run 99 failed on PR #7");
    expect(r.log).toContain("pr view 7");
    expect(r.log).not.toContain("pr merge");
  });

  it("ignores a newer PICKUP from an untrusted author", () => {
    const forged: C = {
      body: pickupBody("evil-branch"),
      createdAt: "2026-10-07T00:00:00Z",
      author: { login: "stranger" },
    };
    const r = run([trustedPickup, forged], [{ number: 7, isCrossRepository: false }]);
    expect(r.log).toContain(`--head ${BRANCH}`);
    expect(r.log).not.toContain("evil-branch");
    const only = run([forged], [{ number: 7, isCrossRepository: false }]);
    expect(only.status).toBe(1);
    expect(only.out).toContain("no PICKUP");
    expect(only.log).not.toContain("pr list");
  });
});
