# Board playbook (Linear, team Aegis, project "fifth copy")

Read this when a role file says "Linear". It maps the kit's vocabulary to the real board and to the tools you actually have. The kit rules in `PROTOCOL.md` still apply; this file only translates them.

## Where things live
- Workspace `philJim`. Team **Aegis**, key **`AEG`** (team id `091a3ad5-8458-4f95-a238-e1385cedd55d`). Project **fifth copy** (`P-AEG-2`). Every issue you create sets `team: Aegis` and `project: fifth copy`.
- Product description: `docs/product-spec.md` (copy of the project description). Analyst reads it.
- Epics are parent issues labeled `epic`; cards are their sub-issues. Epic #1 is **AEG-1 Foundations**.

## Board mapping (the team has no `Ready` or `QA` state and the connector cannot create states)
| Kit term | On this board | Notes |
|---|---|---|
| Backlog | `Backlog` | new cards always start here |
| **Ready** | **`Todo`** | only Picker moves a card here, after the Backlog -> Ready preconditions (PROTOCOL 5). A human dragging a card into Todo does not skip them: Picker re-verifies at pickup |
| In Progress | `In Progress` | |
| In Review | `In Review` (no `qa` label) | PR open, reviewer pass pending |
| **QA** | **`In Review` + label `qa`** | review clean, evaluator verifying the contract |
| Done | `Done` | Picker/Deliver only, after merge + CI green on main + smoke |
| Canceled | `Canceled` | with a reason comment (`Duplicate` also exists) |

Board columns left to right: Backlog | Todo (Ready) | In Progress | In Review (QA = `qa` label) | Done.
Group the board view by status and show labels; that is the kanban.

Labels (all exist in team AEG): `type:feature|bug|chore|adr|spike`, `epic`, `area:<name>`, `ui`, `touches:prisma`, `touches:deps`, `discovered`, `autonomy:afk|hitl`, `plan-approved`, `needs-human|needs-adr|needs-replan`, `qa`. Linear also has the older `Feature`, `Bug`, `Improvement` labels: do not use them, use the `type:*` ones. **Never add `plan-approved` yourself**; only the human does.
New `area:*` labels are allowed: create them with `save_issue_label` (team id above) when a card needs a new area.

Estimates are Linear points: 1, 2, 3 (never above 3, split instead). Priority: 1 urgent, 2 high, 3 medium, 4 low.

## Which tool to use
1. **Linear connector tools** (always available in Claude sessions here; tool names end in `save_issue`, `list_issues`, `get_issue`, ...). Use these by default.
2. `npx tsx scripts/linear.ts <op>` only if `LINEAR_API_KEY` is set in `.env.local`. It implements the same operations, plus `next` (Picker ordering with locks) and `dag_check`. It maps `Ready`/`QA` to this board for you.
3. Neither works: stop and report.

### Operation -> connector call
| Kit op | Connector call |
|---|---|
| `list_ready` | `list_issues` with `team: Aegis`, `project: fifth copy`, `state: Todo`, `fields: [title, labels, priority, estimate, parentId, status]`; then `get_issue` with `includeRelations: true` for each to see blockers |
| `get <ISSUE>` | `get_issue` (`includeRelations: true`) + `list_comments` (`issueId`, `orderBy: createdAt`; read newest first until a HANDOFF) |
| `create` | first `list_issues` with `query: <title>` and `parentId: <EPIC>` (never duplicate), then `save_issue` with `team`, `project`, `parentId`, `title`, `description`, `labels`, `estimate`, `priority`, `state: Backlog` |
| `relate A blocks B` | `save_issue` `id: B`, `blockedBy: [A]` (append-only). To remove: `removeBlockedBy` |
| `move` | `save_issue` `id`, `state: "<name>"` (use the board names above). For QA: `state: "In Review"` and `addLabels: ["qa"]`; leaving QA: `removeLabels: ["qa"]` |
| `label +x -y` | `save_issue` `id`, `addLabels` / `removeLabels` (prefer these over `labels`, which replaces everything) |
| `comment` | `save_comment` `issueId`, `body` |
| `dag_check` | `list_issues` with `parentId: <EPIC>`, `get_issue(includeRelations)` per card, then reason over blockers yourself (cycle? longest chain?) or use `scripts/linear.ts dag_check` if you have the key |
| `hash` | take the card `description`, write it to a temp file, run `npx tsx scripts/linear.ts hash <ISSUE> --body-file <file>` (works offline, no key needed) |

After **every write**, re-read with `get_issue` and confirm the state/labels/relations you intended. If they differ, stop and report; do not retry blindly.
Write comments and descriptions as Markdown with literal newlines. Linear auto-links bare filenames like `check.sh` (it turns them into links), so put commands and paths in backticks.

## Who touches what (restates PROTOCOL 5 and 10)
- **Picker** is the only role that changes `state`. Everyone else changes only labels and comments (and creates `discovered` cards in Backlog).
- **Analyst** creates epics and cards (state `Backlog`), sets `blocks` relations, comments PLAN. Stops after the epic list for human approval; details cards only for an epic carrying `plan-approved`.
- **Explorer / Builder / UI / Deliver** read the card, post BRIEF / HANDOFF comments, never edit the `## Contract` section, never move cards.
- Deliver ticks contract checkboxes only with evidence it produced. Editing a description to tick a box changes the description, not the contract hash (the hash ignores checkbox state).

## One loop iteration, concretely (Picker)
1. Health: `get_workspace` works; `git status` clean on `main`; latest CI on `main` green (`gh run list --branch main --limit 1`).
2. `list_issues` state `Todo` in project -> filter: parent epic has `plan-approved`, no `needs-*` label, all blockers `Done`. Then order by PROTOCOL 6 (critical path, unblocks count, priority, estimate, identifier) and apply locks (PROTOCOL 7) against cards in `In Progress` / `In Review`.
3. None eligible: report why (unapproved epic / blockers / needs-* / hitl waiting) and STOP. Do not promote cards from Backlog unless the Backlog -> Ready preconditions hold; then `move` to `Todo` first.
4. Pick top card, compute contract hash, `move` to `In Progress`, comment `PICKUP <ISSUE> contract_hash=<12> branch=<gitBranchName> worktree=.worktrees/<ISSUE>`, create the worktree with Linear's branch name (field `gitBranchName`, e.g. `jimmyyoelrazafindretsa/aeg-2-...`).
5. Dispatch Explorer -> Builder (UI for `ui` cards) -> Deliver, fresh context each. Verify each HANDOFF yourself (re-run `scripts/check.sh` in the worktree).
6. Gates: In Review when PR is open and check is green; add `qa` when review has zero blockers; Done only after merge, CI green on `main`, smoke passed.
7. `autonomy:hitl` card: stop and tell the human exactly what to review.

## Current state (2026-10-02)
- Epic AEG-1 Foundations (no `plan-approved` yet, so Picker will not promote its cards) with cards AEG-2 scaffold, AEG-3 prisma, AEG-4 tooling, AEG-5 playwright, AEG-6 design, AEG-7 ci, AEG-8 board config. All in Backlog.
- The Foundations work already exists on branch `chore/agent-kit-foundations`. These cards are for **verification by Deliver (not the builder)**, not for rebuilding: Deliver runs each card's `verify:` commands, ticks boxes with evidence, merges the PR, and Picker closes the cards. Hitl criteria (AEG-4, AEG-6, AEG-7, AEG-8) need a human.
- Product epics for "fifth copy" do not exist yet. Next Analyst task: read `docs/product-spec.md`, propose 5-12 epics (Foundations stays epic 0), then STOP for the human to approve them.
