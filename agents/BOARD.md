# Board playbook (GitHub Issues + Project "Fifth Copy")

Read this before touching the board. It maps the kit's vocabulary to the real board and to the tools you actually have. The kit rules in `PROTOCOL.md` still apply; this file only translates them.

## Where things live
- Repo **`jimmy-razafindretsa/fifth-copy`** (node id `R_kgDOU39o2w`). Every card is an issue in this repo.
- User-owned Project **"Fifth Copy"**, number **2**: https://github.com/users/jimmy-razafindretsa/projects/2 (node id `PVT_kwHOCpkK884BlfeZ`). Every card is also an item of this project; the project's **Status** field is the card's kit state.
- Hierarchy uses native **sub-issues**: epics (features) are top-level issues labeled `epic`; their issues are sub-issues; an issue can have its own sub-issues. Dependencies use native **"blocked by"** relationships. Never encode either in prose only.
- Card ids are issue numbers: `#12` in prose, comments, commit messages (`[#12] ...`) and PR titles; the bare number in shell args (`board.ts get 12`) and paths (`work/log/12.md`, `.eyes/12/`, `.worktrees/12`).
- Product description: `docs/product-spec.md`. Requirements: `work/plan/fifth-copy-requirements.md`. Full plan and key-to-issue map (F1.2 -> #16 ...): `work/plan/fifth-copy-board.json`.
- Moved from Linear (team Aegis) on 2026-10-02: AEG-1 -> #2, AEG-2..AEG-8 -> #3..#9. Linear is no longer the tracker: do not read or write it; old `AEG-*` ids in history map as above.

## Status mapping (native options, no workarounds)
| Kit state | Board | Notes |
|---|---|---|
| Backlog | Status `Backlog` | new cards always start here |
| Ready | Status `Ready` | only Picker moves a card here, after the Backlog -> Ready preconditions (PROTOCOL 5). A human dragging a card into Ready does not skip them: Picker re-verifies at pickup |
| In Progress | Status `In Progress` | |
| In Review | Status `In Review` | PR open, reviewer pass pending |
| QA | Status `QA` | review clean, evaluator verifying the contract |
| Done | Status `Done` + issue **closed as completed** | Picker only, after merge + CI green on main + smoke. `board.ts move <n> Done` does both; moving out of Done reopens |
| Canceled | issue **closed as not planned** (Status unchanged) + a reason comment | `board.ts move <n> Canceled` |

Columns left to right: Backlog | Ready | In Progress | In Review | QA | Done. Use a board view grouped by Status with labels shown.

Status option ids (for raw calls; re-read them with the fields query below if a human edits the field): field `PVTSSF_lAHOCpkK884BlfeZzhkMKOQ`; Backlog `d1bfbd6f`, Ready `ed3a273a`, In Progress `c4d6cc69`, In Review `55f57c94`, QA `70771ad3`, Done `dba46af0`.

Automation: the project workflows **Item closed**, **Pull request merged** and **Auto-close issue** must stay OFF (Done is set by Picker after post-merge checks; `board.ts bootstrap` reports them). **Auto-add sub-issues to project** stays ON. PR bodies say `Card: #n` / `Refs #n` and never `Closes`/`Fixes`/`Resolves #n`, because GitHub would close the issue on merge.

## Labels, estimate, priority
Kit labels: `type:feature|bug|chore|adr|spike`, `track:technical|non-technical`, `epic`, `area:<name>`, `ui`, `touches:prisma`, `touches:deps`, `discovered`, `autonomy:afk|hitl`, `plan-approved`, `needs-human|needs-adr|needs-replan`, `visual-change` (PR label). There is no `qa` label any more (QA is a real Status). Ignore GitHub's default labels (`bug`, `enhancement`, ...); use the `type:*` ones.
`board.ts bootstrap` creates missing kit labels (on 2026-10-02 missing: `type:bug`, `discovered`, `plan-approved`, `needs-human`, `needs-adr`, `visual-change`). New `area:*` labels are allowed: pass `--create-missing`.
**Never add `plan-approved` yourself**; only the human does (board.ts refuses to).

Estimate (1, 2, 3; never above 3, split instead) and priority (Urgent, High, Medium, Low) are optional project fields **Estimate** (number) and **Priority** (single select). A human creates them once with `npx tsx scripts/board.ts bootstrap --fields`. Until they exist, the estimate lives only in the card body (`## Size rationale`) and every card sorts as priority "none".

## Which tool to use
1. `npx tsx scripts/board.ts <op>` (default). It talks to GitHub through `gh api graphql` with the user's `gh` login (scopes `repo`, `project`), re-reads after every write, refuses `plan-approved`, and supports `--dry-run`.
2. Raw `gh` / `gh api graphql` with the calls below, only for something board.ts does not cover.
3. `gh auth status` fails or GitHub is unreachable: stop and report.

### Operation -> call
| Kit op | board.ts | Raw equivalent |
|---|---|---|
| `list_ready` | `list_ready` | project items query below, keep `status.name == "Ready"`; blockers from `content.blockedBy` |
| `get <n>` | `get <n> [--comments N]` (prints status, labels, parent, sub-issues, blockers, branch, contract hash, comments newest first) | `gh issue view <n> --comments` plus the issue query below |
| `create` | `create --title T --body-file F --parent <n> --labels a,b [--estimate N] [--priority 1-4]` (reuses same title + parent; lands in Backlog) | `createIssue` with `parentIssueId` and `projectV2Ids`, then set Status Backlog |
| `relate A blocks B` | `relate <A> blocks <B>` | `addBlockedBy(issueId: B, blockingIssueId: A)`; undo with `removeBlockedBy` |
| `move` | `move <n> <Status>` (Picker only) | `updateProjectV2ItemFieldValue`; Done also `closeIssue(COMPLETED)` |
| `label +x -y` | `label <n> +x -y [--create-missing]` | `gh issue edit <n> --add-label x --remove-label y` |
| `comment` | `comment <n> --body-file F` | `gh issue comment <n> --body-file F` |
| `dag_check` | `dag_check <EPIC>` (all descendants) or `dag_check --epics` | none; reason over `blockedBy` yourself |
| `hash` | `hash <n> [--expect H] [--body-file F]` (offline with `--body-file`) | none |
| Picker order | `next` (last line `next: #n` or `STOP: ...`) | none |
| bulk (workflows) | `dump [--json]`, `import --file F --out F`, `link --file F`, `verify --expect-file F` | none |

### Raw GraphQL (use `gh api graphql -f query='...' -F name=value`)
```graphql
# all cards with status (add --paginate; the cursor variable must be named $endCursor)
query($endCursor: String) { node(id: "PVT_kwHOCpkK884BlfeZ") { ... on ProjectV2 {
  items(first: 100, after: $endCursor) { pageInfo { hasNextPage endCursor } nodes { id
    status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
    content { ... on Issue { number title state labels(first: 30) { nodes { name } }
      parent { number } blockedBy(first: 50) { nodes { number state } } } } } } } } }

# one issue: node id, project item id, parent, relationships
query { repository(owner: "jimmy-razafindretsa", name: "fifth-copy") { issue(number: 12) {
  id title body state parent { number } subIssues(first: 50) { nodes { number } }
  blockedBy(first: 50) { nodes { number state } } blocking(first: 50) { nodes { number } }
  projectItems(first: 5) { nodes { id project { number } } } } } }

mutation { createIssue(input: { repositoryId: "R_kgDOU39o2w", title: "...", body: "...", labelIds: ["LA_..."],
  parentIssueId: "<parent issue node id>", projectV2Ids: ["PVT_kwHOCpkK884BlfeZ"] }) { issue { number } } }
mutation { addSubIssue(input: { issueId: "<parent node id>", subIssueId: "<child node id>" }) { issue { number } } }
mutation { addBlockedBy(input: { issueId: "<blocked node id>", blockingIssueId: "<blocker node id>" }) { issue { number } } }
mutation { updateProjectV2ItemFieldValue(input: { projectId: "PVT_kwHOCpkK884BlfeZ", itemId: "<PVTI_...>",
  fieldId: "PVTSSF_lAHOCpkK884BlfeZzhkMKOQ", value: { singleSelectOptionId: "ed3a273a" } }) { projectV2Item { id } } }
mutation { closeIssue(input: { issueId: "<node id>", stateReason: COMPLETED }) { issue { number } } }
```
New issues get no Status automatically (the "Item added to project" workflow is off): always set `Backlog` right after creating.

After **every write**, re-read (`board.ts get <n>`) and confirm the status, labels and relationships you intended. If they differ, stop and report; do not retry blindly.
Write comments and bodies as Markdown files (`--body-file`). GitHub turns `#n` into issue links and `@name` into mentions: use `#n` only for real cards, never `@` anyone, and put commands and paths in backticks.

## Who touches what (restates PROTOCOL 5 and 10)
- **Picker** is the only role that changes Status or closes/reopens issues. Everyone else changes only labels and comments (and creates `discovered` cards in Backlog).
- **Analyst** creates epics and cards (Backlog, as sub-issues), sets "blocked by" dependencies, comments PLAN. Stops after the epic list for human approval; details cards only for an epic carrying `plan-approved`.
- **Explorer / Builder / UI / Deliver** read the card, post BRIEF / HANDOFF comments, never edit the `## Contract` section, never move cards.
- Deliver ticks contract checkboxes only with evidence it produced (`gh issue edit <n> --body-file`). Ticking boxes changes the body, not the contract hash (the hash ignores checkbox state).

## One loop iteration, concretely (Picker)
1. Health: `gh auth status` ok and `npx tsx scripts/board.ts whoami` lists the six Status options; `git status` clean on `main`; latest CI on `main` green (`gh run list --branch main --limit 1`).
2. `board.ts next` -> filters Ready cards: nearest `epic` ancestor has `plan-approved`, no `needs-*` label, every blocker Done, no open sub-issues; orders by PROTOCOL 6 and applies locks (PROTOCOL 7) against cards in In Progress / In Review / QA.
3. None eligible: report why (unapproved epic / blockers / needs-* / hitl waiting) and STOP. Do not promote cards from Backlog unless the Backlog -> Ready preconditions hold; then `move <n> Ready` first.
4. Pick the top card, `board.ts hash <n>`, `move <n> "In Progress"`, comment `PICKUP #n contract_hash=<12> branch=<n>-<slug> worktree=.worktrees/<n>` (the branch is the `branch:` line of `board.ts get`), then `git worktree add .worktrees/<n> -b <n>-<slug>`.
5. Dispatch Explorer -> Builder (UI for `ui` cards) -> Deliver, fresh context each. Verify each HANDOFF yourself (re-run `scripts/check.sh` in the worktree).
6. Gates: `In Review` when the PR is open and check is green; `QA` when review has zero blockers; `Done` only after merge, CI green on `main`, smoke passed.
7. `autonomy:hitl` card: stop and tell the human exactly what to review.

## Building a board from requirements (workflow `build-board`)
`.claude/workflows/build-board.js` turns requirements into the whole hierarchy in one run: **features** (epic issues) > **issues** > **sub-issues**, technical and non-technical, with "blocked by" links. The Fifth Copy board (#10-#445) was built this way from `work/plan/fifth-copy-requirements.md`; its record is `work/plan/fifth-copy-board.json`.

Run it (Claude Code Workflow tool, name `build-board`) with args:
```json
{ "requirementsFile": "work/plan/fifth-copy-requirements.md", "dryRun": true }
```
Other args: `requirements` (pasted text instead of a file), `repo` (jimmy-razafindretsa/fifth-copy), `projectOwner` (jimmy-razafindretsa), `projectNumber` (2), `foundationsEpic` (2, blocks every root feature; `0` disables), `planName` (record file name), `criticRounds` (2).

Stages: **Gather** (extract atomic requirements R1..Rn; `board.ts dump --json` scans the existing board; 4 parallel lenses: user journeys, non-technical work, architecture and data, quality and ops) -> **Regroup** (merge duplicates, completeness-critic loop, independent dependency pass, then deterministic code: re-key, drop duplicates/self/ancestor links, break cycles, transitive reduction, requirement coverage check) -> **Prepare** (`board.ts bootstrap`, labels) -> **Create** (one agent per feature runs `board.ts import`, top-down; same title + parent is reused, so reruns do not duplicate) -> **Link** (`board.ts link`, once every issue number exists) -> **Verify** (`board.ts verify` reads everything back, one fix round) -> **Record** (`work/plan/<planName>.json`: plan + key-to-issue map).

Conventions it follows: everything lands in `Backlog`; titles plus one or two sentences and a `<!-- board-key: F1.2 -->` marker, no Contracts; features get `epic` + `needs-replan` (= details pending, the Analyst writes Contracts later); each item gets `type:*` and `track:technical|non-technical`; no estimates or priorities; **never `plan-approved`** (a human sets it per epic). Skeleton cards without a Contract cannot pass the Backlog -> Ready precondition, so the Picker leaves them alone until the Analyst details them.

Always do a `dryRun: true` first and read the returned outline, uncovered requirements and open questions; then rerun without it (resume is cheap for the unchanged stages).

## Current state (2026-10-02)
- 444 issues on the board, all `Backlog`, none `plan-approved` yet (the label does not exist until `bootstrap` runs).
- Epic #2 Foundations with cards #3 scaffold, #4 prisma, #5 tooling, #6 playwright, #7 design, #8 ci, #9 board config. The work already exists on branch `chore/agent-kit-foundations`: these cards are for **verification by Deliver (not the builder)**, not for rebuilding. Hitl criteria (#5, #7, #8, #9) need a human. #9 carries `needs-replan`: its Contract is still the Linear version and must be rewritten for this board.
- 12 product epics (#10, #29, #95, #148, #208, #252, #285, #298, #311, #340, #370, #401), all `epic` + `needs-replan`, with 166 issues and 258 sub-issues and 680 dependencies. Open questions for the human are in `work/plan/fifth-copy-board.json` (`stats.openQuestions`).
- Next: the human adds `plan-approved` to the epics they approve (Foundations first); the Analyst then writes Contracts for the approved epic's cards.
