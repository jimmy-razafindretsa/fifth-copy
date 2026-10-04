/**
 * Board access layer for the agent kit (agents/PROTOCOL.md section 11): GitHub issues + GitHub Project.
 * Thin wrapper over GitHub's GraphQL API via `gh api graphql`, so tool schemas stay out of agent context.
 * Auth is whatever `gh` is logged in with (needs scopes `repo` and `project`); no token is read or printed here.
 *
 *   npx tsx scripts/board.ts <op> [args] [--dry-run]
 *
 * Cards are issue numbers: pass `12` or `'#12'` (quote it: `#` starts a shell comment). Output uses `#12`.
 *
 * Ops (kit names, not GitHub's):
 *   whoami                                     check gh auth, repo, project and Status options
 *   list_ready                                 Ready cards with blockers, epic, labels, estimate, priority
 *   get <n> [--comments N]                     body, status, labels, blockers, parent, sub-issues, comments (newest first), branch
 *   create --title T --body-file F [--parent n] [--labels a,b] [--estimate N] [--priority 1-4] [--create-missing]
 *                                              same title under the same parent is reused, never duplicated; lands in Backlog
 *   relate <A> blocks <B>                      native "blocked by" dependency
 *   move <n> <status>                          Picker only. Backlog|Ready|In Progress|In Review|QA|Done; Done closes the
 *                                              issue, leaving Done reopens it; `Canceled` closes it as not planned
 *   label <n> +x -y [--create-missing]         plan-approved only with --analyst, on an epic none of whose cards
 *                                              carries needs-* (PROTOCOL 5, human review policy)
 *   comment <n> --body-file F
 *   dag_check <EPIC> | dag_check --epics       cycles, topological order, critical path (exit 1 on cycle)
 *   hash <n> [--expect H] [--body-file F]      contract hash (exit 1 if --expect differs); --body-file hashes a local file offline
 *   next                                       Picker ordering (PROTOCOL 6) + locks (7); last line `next: #n` or `STOP: <why>`
 *   pickup <n>                                 Ready -> In Progress after re-checking blockers and locks; posts PICKUP
 *                                              (contract hash, branch); prints `branch: <name>`
 *   gate <n> <In Review|QA|Done> [--check]     script-checkable PROTOCOL 5 preconditions; moves the card if they
 *                                              hold (--check: report only); exit 1 with the failures otherwise
 *   promote [--epic n]                         Backlog -> Ready for every card in a plan-approved epic that passes
 *                                              the Backlog -> Ready preconditions; prints why the others stay
 *   locks <n>                                  exit 1 if a hotspot (touches:*) or area lock conflicts with another
 *                                              in-flight card (WIP not counted)
 *   dump [--json]                              every card on the board, one line each (or a JSON array)
 *   import --file F [--out F]                  batch create: JSON [{key, parentKey?|parent?, title, body, labels}], top-down
 *   link --file F                              batch relate: JSON [{blocker, blocked}] (issue numbers)
 *   verify --expect-file F                     compare the board with JSON [{number, title?, parent?, status?,
 *                                              mustHaveLabels?, mustNotHaveLabels?, blockedBy?}]; exit 1 on deviation
 *   bootstrap [--fields]                       check Status options and automations, create missing kit labels;
 *                                              --fields also creates the optional Estimate and Priority project fields
 *
 * Writes are re-read and verified. --dry-run prints the mutation instead of sending it.
 * Env (.env.local / .env, all optional): BOARD_REPO (default jimmy-razafindretsa/fifth-copy), BOARD_PROJECT_OWNER
 * (default the repo owner), BOARD_PROJECT_NUMBER (default 2), BOARD_WIP_LIMIT (default 1).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { config as loadEnv } from "dotenv";
import {
  blockerDone,
  branchName,
  cardId,
  descendants,
  epicOf,
  IN_FLIGHT_STATUSES,
  isCanceled,
  isDone,
  NEEDS_LABELS,
  parseCardRef,
  priorityName,
  priorityRank,
  resolveStatus,
  STATUSES,
  verifyCards,
  type BoardCard,
  type Expectation,
} from "./lib/board";
import {
  cardTier,
  estimateOf,
  evaluateGate,
  GATE_TARGETS,
  latestPickup,
  pickupComment,
  promotionBlockers,
  type GateTarget,
} from "./lib/flow";
import {
  contractHash,
  dagCheck,
  lockViolation,
  orderCandidates,
  unblocksCount,
  type CardNode,
} from "./lib/kit";

loadEnv({ path: [".env.local", ".env"], quiet: true });

const REPO = process.env.BOARD_REPO || "jimmy-razafindretsa/fifth-copy";
const [OWNER = "", NAME = ""] = REPO.split("/");
const PROJECT_OWNER = process.env.BOARD_PROJECT_OWNER || OWNER;
const PROJECT_NUMBER = Number(process.env.BOARD_PROJECT_NUMBER || 2);
const WIP_LIMIT = Number(process.env.BOARD_WIP_LIMIT || 1);
const argv = process.argv.slice(2);
const DRY = argv.includes("--dry-run");

export const PLAN_APPROVED = "plan-approved";
export const KIT_LABELS = [
  "type:feature",
  "type:bug",
  "type:chore",
  "type:adr",
  "type:spike",
  "track:technical",
  "track:non-technical",
  "epic",
  "ui",
  "touches:prisma",
  "touches:deps",
  "touches:protocol",
  "touches:i18n",
  "touches:arch",
  "touches:tokens",
  "pentest",
  "discovered",
  "autonomy:afk",
  "autonomy:hitl",
  PLAN_APPROVED,
  "needs-human",
  "needs-adr",
  "needs-replan",
  "visual-change",
];
/** Project automations that would move or close cards behind the Picker's back (PROTOCOL 5). */
const FORBIDDEN_AUTOMATIONS = ["Pull request merged", "Item closed", "Auto-close issue"];

class BoardError extends Error {}

function flag(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}
const BOOL_FLAGS = [
  "--dry-run",
  "--epics",
  "--create-missing",
  "--json",
  "--fields",
  "--check",
  "--analyst",
];
function positional(): string[] {
  const out: string[] = [];
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!;
    if (BOOL_FLAGS.includes(a)) continue;
    if (a.startsWith("--")) {
      i++;
      continue;
    }
    out.push(a);
  }
  return out;
}
function cardArg(ref: string | undefined, usage: string): number {
  const n = parseCardRef(req(ref, usage));
  if (n === null) throw new BoardError(`not a card number: ${ref} (use 12 or '#12')`);
  return n;
}

// ---------- transport ----------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function gh(args: string[], input?: string): string {
  return execFileSync("gh", args, {
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    let raw: string;
    try {
      raw = gh(["api", "graphql", "--input", "-"], JSON.stringify({ query, variables }));
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; code?: string };
      if (err.code === "ENOENT")
        throw new BoardError("gh CLI not found. Install it and `gh auth login`.");
      raw = err.stdout || "";
      if (!raw.trim().startsWith("{")) {
        const msg = (err.stderr || String(e)).trim();
        if (/rate limit|abuse/i.test(msg) && attempt < 4) {
          await sleep(15_000 * attempt);
          continue;
        }
        throw new BoardError(`GitHub unreachable or auth failed: ${msg.split("\n")[0]}`);
      }
    }
    const body = JSON.parse(raw) as { data?: T; errors?: { message: string; type?: string }[] };
    if (body.errors?.length) {
      const msg = body.errors.map((x) => x.message).join("; ");
      if (/rate limit|abuse/i.test(msg) && attempt < 4) {
        await sleep(15_000 * attempt);
        continue;
      }
      throw new BoardError(`GitHub API error: ${msg}`);
    }
    return body.data as T;
  }
}

/** Mutations go through here so --dry-run and verification are uniform. */
async function mutate<T>(
  label: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T | null> {
  if (DRY) {
    console.log(`[dry-run] ${label}\n${JSON.stringify(variables, null, 2)}`);
    return null;
  }
  return gql<T>(query, variables);
}

// ---------- context: repo, project, fields ----------

type Field = {
  id: string;
  name: string;
  dataType: string;
  options?: { id: string; name: string }[];
};
type Ctx = {
  repoId: string;
  project: { id: string; title: string; url: string };
  fields: Field[];
  workflows: { name: string; enabled: boolean }[];
};

const PROJECT_FIELDS = `id title url
  fields(first: 50) { nodes {
    ... on ProjectV2FieldCommon { id name dataType }
    ... on ProjectV2SingleSelectField { options { id name } } } }
  workflows(first: 30) { nodes { name enabled } }`;

let ctxCache: Ctx | null = null;
async function ctx(): Promise<Ctx> {
  if (ctxCache) return ctxCache;
  type P = {
    id: string;
    title: string;
    url: string;
    fields: { nodes: Field[] };
    workflows: { nodes: { name: string; enabled: boolean }[] };
  };
  const d = await gql<{
    repository: { id: string } | null;
    repositoryOwner: { projectV2?: P | null } | null;
  }>(
    `query($owner: String!, $name: String!, $powner: String!, $num: Int!) {
      repository(owner: $owner, name: $name) { id }
      repositoryOwner(login: $powner) {
        ... on User { projectV2(number: $num) { ${PROJECT_FIELDS} } }
        ... on Organization { projectV2(number: $num) { ${PROJECT_FIELDS} } } } }`,
    { owner: OWNER, name: NAME, powner: PROJECT_OWNER, num: PROJECT_NUMBER },
  );
  if (!d.repository) throw new BoardError(`repo ${REPO} not found (check BOARD_REPO)`);
  const p = d.repositoryOwner?.projectV2;
  if (!p)
    throw new BoardError(
      `project ${PROJECT_OWNER}/${PROJECT_NUMBER} not found (check BOARD_PROJECT_*, gh scope "project")`,
    );
  return (ctxCache = {
    repoId: d.repository.id,
    project: { id: p.id, title: p.title, url: p.url },
    fields: p.fields.nodes.filter((f) => f.id),
    workflows: p.workflows.nodes,
  });
}
const field = (c: Ctx, name: string) => c.fields.find((f) => f.name === name);
async function statusField(): Promise<Field & { options: { id: string; name: string }[] }> {
  const f = field(await ctx(), "Status");
  if (!f?.options) throw new BoardError("project has no single-select Status field");
  return f as Field & { options: { id: string; name: string }[] };
}

// ---------- board index (all project items that are issues of REPO) ----------

type Item = BoardCard & { issueId: string; itemId: string };
type Labels = { nodes: { name: string }[] };
const names = (l: Labels) => l.nodes.map((x) => x.name);

const ITEM_VALUES = `
  status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
  estimate: fieldValueByName(name: "Estimate") { ... on ProjectV2ItemFieldNumberValue { number } }
  priority: fieldValueByName(name: "Priority") { ... on ProjectV2ItemFieldSingleSelectValue { name } }`;
type ItemValues = {
  status: { name?: string } | null;
  estimate: { number?: number } | null;
  priority: { name?: string } | null;
};
type RawIssue = {
  id: string;
  number: number;
  title: string;
  state: string;
  stateReason: string | null;
  repository: { nameWithOwner: string };
  labels: Labels;
  parent: { number: number; labels: Labels } | null;
  blockedBy: { nodes: { number: number; state: string; stateReason: string | null }[] };
  subIssuesSummary: { total: number; completed: number };
};
const ISSUE_CORE = `id number title state stateReason repository { nameWithOwner }
  labels(first: 50) { nodes { name } }
  parent { number labels(first: 50) { nodes { name } } }
  blockedBy(first: 50) { nodes { number state stateReason } }
  subIssuesSummary { total completed }`;

function toItem(itemId: string, v: ItemValues, i: RawIssue): Item {
  return {
    issueId: i.id,
    itemId,
    number: i.number,
    title: i.title,
    status: v.status?.name ?? null,
    state: i.state,
    stateReason: i.stateReason,
    labels: names(i.labels),
    parent: i.parent?.number ?? null,
    parentLabels: i.parent ? names(i.parent.labels) : [],
    blockedBy: i.blockedBy.nodes,
    subIssues: i.subIssuesSummary,
    estimate: v.estimate?.number ?? null,
    priority: priorityRank(v.priority?.name),
  };
}

let indexCache: Map<number, Item> | null = null;
async function boardIndex(): Promise<Map<number, Item>> {
  if (indexCache) return indexCache;
  const c = await ctx();
  const out = new Map<number, Item>();
  let after: string | null = null;
  for (;;) {
    const d: {
      node: {
        items: {
          pageInfo: { hasNextPage: boolean; endCursor: string };
          nodes: ({ id: string; content: Partial<RawIssue> | null } & ItemValues)[];
        };
      };
    } = await gql(
      `query($id: ID!, $after: String) { node(id: $id) { ... on ProjectV2 {
        items(first: 100, after: $after) { pageInfo { hasNextPage endCursor }
          nodes { id ${ITEM_VALUES} content { ... on Issue { ${ISSUE_CORE} } } } } } } }`,
      { id: c.project.id, after },
    );
    for (const n of d.node.items.nodes) {
      const i = n.content as RawIssue | null;
      if (!i?.number || i.repository.nameWithOwner.toLowerCase() !== REPO.toLowerCase()) continue;
      out.set(i.number, toItem(n.id, n, i));
    }
    if (!d.node.items.pageInfo.hasNextPage) break;
    after = d.node.items.pageInfo.endCursor;
  }
  return (indexCache = out);
}

// ---------- single issue (full detail) ----------

type Related = {
  number: number;
  title: string;
  state: string;
  stateReason: string | null;
  projectItems: { nodes: ({ project: { id: string } } & Pick<ItemValues, "status">)[] };
};
type FullIssue = RawIssue & {
  body: string;
  url: string;
  parent: (RawIssue["parent"] & { title: string }) | null;
  blockedByFull: { nodes: Related[] };
  blocking: { nodes: Related[] };
  subIssues: { nodes: Related[] };
  comments: { nodes: { body: string; createdAt: string; author: { login: string } | null }[] };
  projectItems: { nodes: ({ id: string; project: { id: string } } & ItemValues)[] };
};
const RELATED = `number title state stateReason
  projectItems(first: 10) { nodes { project { id } status: fieldValueByName(name: "Status") {
    ... on ProjectV2ItemFieldSingleSelectValue { name } } } }`;

async function getIssue(n: number, comments = 0): Promise<FullIssue> {
  const d = await gql<{ repository: { issue: FullIssue | null } }>(
    `query($owner: String!, $name: String!, $n: Int!, $c: Int!) { repository(owner: $owner, name: $name) {
      issue(number: $n) { ${ISSUE_CORE} body url
        parent { number title labels(first: 50) { nodes { name } } }
        blockedByFull: blockedBy(first: 50) { nodes { ${RELATED} } }
        blocking(first: 50) { nodes { ${RELATED} } }
        subIssues(first: 100) { nodes { ${RELATED} } }
        comments(last: $c) { nodes { body createdAt author { login } } }
        projectItems(first: 10) { nodes { id project { id } ${ITEM_VALUES} } } } } }`,
    { owner: OWNER, name: NAME, n, c: Math.max(comments, 1) },
  );
  const i = d.repository.issue;
  if (!i) throw new BoardError(`issue ${cardId(n)} not found in ${REPO}`);
  if (comments === 0) i.comments.nodes = [];
  return i;
}

/** The card as the board sees it (its project item), or an error if the issue is not on the board. */
async function itemOf(i: FullIssue): Promise<Item> {
  const c = await ctx();
  const it = i.projectItems.nodes.find((p) => p.project.id === c.project.id);
  if (!it) throw new BoardError(`${cardId(i.number)} is not on project "${c.project.title}"`);
  return toItem(it.id, it, i);
}
const relStatus = async (r: Related) => {
  const c = await ctx();
  const s = r.projectItems.nodes.find((p) => p.project.id === c.project.id)?.status?.name;
  return s ?? (r.state === "CLOSED" ? `closed:${(r.stateReason ?? "").toLowerCase()}` : "open");
};
const relList = async (rs: Related[]) =>
  (await Promise.all(rs.map(async (r) => `${cardId(r.number)}(${await relStatus(r)})`))).join(
    ", ",
  ) || "-";

// ---------- helpers ----------

const readBody = (file: string | undefined) => {
  if (!file) throw new BoardError("--body-file is required");
  return fs.readFileSync(file, "utf8");
};
const readJson = <T>(file: string | undefined, usage: string): T => {
  if (!file) throw new BoardError(`usage: ${usage}`);
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
};
const splitList = (s: string | undefined) =>
  (s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

function toNodes(cards: BoardCard[]): CardNode[] {
  const ids = new Set(cards.map((c) => c.number));
  return cards.map((c) => ({
    id: cardId(c.number),
    done: isDone(c) || isCanceled(c),
    blockedBy: c.blockedBy.filter((b) => ids.has(b.number)).map((b) => cardId(b.number)),
  }));
}

async function repoLabels(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let after: string | null = null;
  for (;;) {
    const d: {
      repository: {
        labels: {
          nodes: { id: string; name: string }[];
          pageInfo: { hasNextPage: boolean; endCursor: string };
        };
      };
    } = await gql(
      `query($owner: String!, $name: String!, $after: String) { repository(owner: $owner, name: $name) {
        labels(first: 100, after: $after) { nodes { id name } pageInfo { hasNextPage endCursor } } } }`,
      { owner: OWNER, name: NAME, after },
    );
    for (const l of d.repository.labels.nodes) out.set(l.name, l.id);
    if (!d.repository.labels.pageInfo.hasNextPage) break;
    after = d.repository.labels.pageInfo.endCursor;
  }
  return out;
}

let labelCache: Map<string, string> | null = null;
async function resolveLabelIds(wanted: string[], createMissing: boolean): Promise<string[]> {
  if (!wanted.length) return [];
  labelCache ??= await repoLabels();
  const ids: string[] = [];
  for (const name of wanted) {
    const hit = labelCache.get(name);
    if (hit) {
      ids.push(hit);
      continue;
    }
    if (!createMissing)
      throw new BoardError(
        `label "${name}" does not exist (run bootstrap, or pass --create-missing)`,
      );
    if (DRY) {
      console.log(`[dry-run] create label ${name}`);
      ids.push(`dry:${name}`);
      continue;
    }
    const created = JSON.parse(
      gh(["api", `repos/${REPO}/labels`, "-f", `name=${name}`, "-f", "color=ededed"]),
    ) as { node_id: string };
    labelCache.set(name, created.node_id);
    ids.push(created.node_id);
  }
  return ids;
}

async function setField(itemId: string, f: Field, value: Record<string, unknown>, label: string) {
  const c = await ctx();
  await mutate(
    label,
    `mutation($input: UpdateProjectV2ItemFieldValueInput!) {
      updateProjectV2ItemFieldValue(input: $input) { projectV2Item { id } } }`,
    { input: { projectId: c.project.id, itemId, fieldId: f.id, value } },
  );
}
async function setStatus(itemId: string, status: string, label: string) {
  const f = await statusField();
  const opt = f.options.find((o) => o.name === status);
  if (!opt) throw new BoardError(`Status option "${status}" missing on the project`);
  await setField(itemId, f, { singleSelectOptionId: opt.id }, label);
}

// ---------- ops ----------

async function opWhoami() {
  const login = gh(["api", "user", "-q", ".login"]).trim();
  const c = await ctx();
  const f = await statusField();
  console.log(`gh user: ${login} | repo: ${REPO} | project: ${c.project.title} (${c.project.url})`);
  console.log(`status options: ${f.options.map((o) => o.name).join(", ")}`);
  console.log(
    `optional fields: Estimate ${field(c, "Estimate") ? "yes" : "no"}, Priority ${field(c, "Priority") ? "yes" : "no"}`,
  );
}

async function opGet(n: number) {
  const count = Number(flag("comments") ?? 20);
  const i = await getIssue(n, count);
  const c = await ctx();
  const it = i.projectItems.nodes.find((p) => p.project.id === c.project.id);
  console.log(`${cardId(i.number)} ${i.title}`);
  console.log(
    `status: ${it?.status?.name ?? (it ? "unset" : "NOT ON BOARD")} | issue: ${i.state.toLowerCase()}${i.stateReason ? `:${i.stateReason.toLowerCase()}` : ""} | estimate: ${it?.estimate?.number ?? "-"} | priority: ${priorityName(priorityRank(it?.priority?.name))} | parent: ${i.parent ? cardId(i.parent.number) : "-"}`,
  );
  console.log(`labels: ${names(i.labels).join(", ") || "-"}`);
  console.log(`branch: ${branchName(i.number, i.title)} | url: ${i.url}`);
  console.log(`blocked by: ${await relList(i.blockedByFull.nodes)}`);
  console.log(`blocks: ${await relList(i.blocking.nodes)}`);
  if (i.subIssues.nodes.length) console.log(`sub-issues: ${await relList(i.subIssues.nodes)}`);
  console.log(`contract_hash: ${contractHash(i.body) ?? "none (no ## Contract)"}`);
  console.log(`\n--- description ---\n${i.body}`);
  const comments = [...i.comments.nodes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  console.log(`\n--- comments (newest first, ${comments.length}) ---`);
  for (const cm of comments)
    console.log(`\n[${cm.createdAt} ${cm.author?.login ?? "?"}]\n${cm.body}`);
}

async function opListReady() {
  const index = await boardIndex();
  const ready = [...index.values()].filter((c) => c.status === "Ready");
  if (!ready.length) return console.log("no Ready cards");
  for (const c of ready) {
    const open = c.blockedBy.filter((b) => !blockerDone(b, index));
    const epic = epicOf(c, index);
    console.log(
      [
        cardId(c.number),
        `epic=${epic ? cardId(epic) : "-"}`,
        `est=${c.estimate ?? "-"}`,
        `prio=${priorityName(c.priority)}`,
        `labels=${c.labels.join(",") || "-"}`,
        `blockers=${c.blockedBy.map((b) => `${cardId(b.number)}:${index.get(b.number)?.status ?? b.state.toLowerCase()}`).join(",") || "-"}`,
        open.length ? "BLOCKED" : "unblocked",
        c.title,
      ].join(" | "),
    );
  }
}

type CreateSpec = {
  title: string;
  body: string;
  parent: number | null;
  labels: string[];
  estimate?: number;
  priority?: number;
};

/** Creates (or reuses) one card. Returns its number and whether it already existed. */
async function createCard(s: CreateSpec): Promise<{ number: number; reused: boolean }> {
  if (s.labels.includes(PLAN_APPROVED))
    throw new BoardError(`${PLAN_APPROVED} is applied by a human only`);
  if (s.estimate !== undefined && s.estimate > 3)
    throw new BoardError("estimate > 3: split the card (PROTOCOL section 3)");
  const index = await boardIndex();
  const want = s.title.trim().toLowerCase();
  const dupe = [...index.values()].find(
    (c) => c.title.trim().toLowerCase() === want && c.parent === s.parent,
  );
  if (dupe) return { number: dupe.number, reused: true };
  if (s.parent !== null && !index.has(s.parent))
    throw new BoardError(`parent ${cardId(s.parent)} is not on the board`);

  const c = await ctx();
  const input: Record<string, unknown> = {
    repositoryId: c.repoId,
    title: s.title,
    body: s.body,
    labelIds: await resolveLabelIds(s.labels, argv.includes("--create-missing")),
    projectV2Ids: [c.project.id],
  };
  if (s.parent !== null) input.parentIssueId = index.get(s.parent)!.issueId;
  const r = await mutate<{ createIssue: { issue: { number: number } } }>(
    `createIssue "${s.title}"`,
    `mutation($input: CreateIssueInput!) { createIssue(input: $input) { issue { number } } }`,
    { input },
  );
  if (!r) return { number: 0, reused: false };
  const n = r.createIssue.issue.number;
  const it = await itemOf(await getIssue(n));
  await setStatus(it.itemId, "Backlog", `status ${cardId(n)} Backlog`);
  // Estimate and Priority are optional project fields; without them the values live only in the card body.
  const est = field(c, "Estimate");
  if (s.estimate !== undefined) {
    if (est) await setField(it.itemId, est, { number: s.estimate }, `estimate ${cardId(n)}`);
    else console.log(`note: no Estimate field (bootstrap --fields); estimate stays in the body`);
  }
  if (s.priority !== undefined) {
    const pf = field(c, "Priority");
    const opt = pf?.options?.find((o) => priorityRank(o.name) === s.priority);
    if (pf && opt)
      await setField(it.itemId, pf, { singleSelectOptionId: opt.id }, `priority ${cardId(n)}`);
    else console.log(`note: no Priority field/option (bootstrap --fields); priority not set`);
  }
  const again = await itemOf(await getIssue(n));
  if (again.title !== s.title || again.parent !== s.parent || again.status !== "Backlog")
    throw new BoardError(`verify failed: ${cardId(n)} title/parent/status differ after create`);
  index.set(n, again);
  return { number: n, reused: false };
}

async function opCreate() {
  const title = req(flag("title"), "create --title T --body-file F");
  const parentRef = flag("parent");
  const estimate = flag("estimate");
  const priority = flag("priority");
  const r = await createCard({
    title,
    body: readBody(flag("body-file")),
    parent: parentRef ? cardArg(parentRef, "--parent <n>") : null,
    labels: splitList(flag("labels")),
    estimate: estimate ? Number(estimate) : undefined,
    priority: priority ? Number(priority) : undefined,
  });
  if (DRY) return;
  console.log(
    r.reused
      ? `exists: ${cardId(r.number)} (not duplicated)`
      : `created: ${cardId(r.number)} (Backlog) https://github.com/${REPO}/issues/${r.number}`,
  );
}

async function relate(a: number, b: number): Promise<"exists" | "related"> {
  if (a === b) throw new BoardError("an issue cannot block itself");
  const [ia, ib] = await Promise.all([getIssue(a), getIssue(b)]);
  if (ib.blockedBy.nodes.some((x) => x.number === a)) return "exists";
  const r = await mutate(
    `${cardId(a)} blocks ${cardId(b)}`,
    `mutation($input: AddBlockedByInput!) { addBlockedBy(input: $input) { issue { number } } }`,
    { input: { issueId: ib.id, blockingIssueId: ia.id } },
  );
  if (!r) return "related";
  const again = await getIssue(b);
  if (!again.blockedBy.nodes.some((x) => x.number === a))
    throw new BoardError("verify failed: dependency not present after write");
  return "related";
}

async function opRelate(a: number, verb: string, b: number) {
  if (verb !== "blocks") throw new BoardError("usage: relate <A> blocks <B>");
  const r = await relate(a, b);
  console.log(`${r}: ${cardId(a)} blocks ${cardId(b)}`);
}

async function setIssueOpen(i: FullIssue, open: boolean, reason = "COMPLETED") {
  if (open === (i.state === "OPEN")) return;
  await mutate(
    `${open ? "reopen" : `close (${reason})`} ${cardId(i.number)}`,
    open
      ? `mutation($input: ReopenIssueInput!) { reopenIssue(input: $input) { issue { number } } }`
      : `mutation($input: CloseIssueInput!) { closeIssue(input: $input) { issue { number } } }`,
    { input: open ? { issueId: i.id } : { issueId: i.id, stateReason: reason } },
  );
}

async function opMove(n: number, requested: string) {
  const i = await getIssue(n);
  const it = await itemOf(i);
  if (requested.trim().toLowerCase() === "canceled") {
    await setIssueOpen(i, false, "NOT_PLANNED");
    if (DRY) return;
    const again = await getIssue(n);
    if (again.state !== "CLOSED") throw new BoardError("verify failed: issue still open");
    console.log(`canceled: ${cardId(n)} closed as not planned (post the reason as a comment)`);
    return;
  }
  const f = await statusField();
  const target = resolveStatus(
    requested,
    f.options.map((o) => o.name),
  );
  if (!target)
    throw new BoardError(
      `status "${requested}" not on the board: ${f.options.map((o) => o.name).join(", ")}, or Canceled`,
    );
  if (it.status !== target)
    await setStatus(it.itemId, target, `move ${cardId(n)} ${it.status ?? "unset"} -> ${target}`);
  // Done closes the issue; any other status keeps (or makes) it open.
  await setIssueOpen(i, target !== "Done");
  if (DRY) return;
  const again = await itemOf(await getIssue(n));
  if (again.status !== target) throw new BoardError("verify failed: status not updated");
  if ((target === "Done") !== (again.state === "CLOSED"))
    throw new BoardError("verify failed: issue open/closed state does not match the status");
  console.log(
    it.status === target
      ? `unchanged: ${cardId(n)} already ${target}`
      : `moved: ${cardId(n)} ${it.status ?? "unset"} -> ${target}`,
  );
}

async function opLabel(n: number, changes: string[]) {
  const add = changes.filter((c) => c.startsWith("+")).map((c) => c.slice(1));
  const remove = changes.filter((c) => c.startsWith("-")).map((c) => c.slice(1));
  if (!add.length && !remove.length) throw new BoardError("usage: label <n> +x -y");
  if (add.includes(PLAN_APPROVED)) await checkSelfApproval(n);
  const i = await getIssue(n);
  const current = names(i.labels);
  const toAdd = add.filter((x) => !current.includes(x));
  const toRemove = remove.filter((x) => current.includes(x));
  if (toAdd.length)
    await mutate(
      `label ${cardId(n)} +${toAdd.join(" +")}`,
      `mutation($input: AddLabelsToLabelableInput!) { addLabelsToLabelable(input: $input) { clientMutationId } }`,
      {
        input: {
          labelableId: i.id,
          labelIds: await resolveLabelIds(toAdd, argv.includes("--create-missing")),
        },
      },
    );
  if (toRemove.length)
    await mutate(
      `label ${cardId(n)} -${toRemove.join(" -")}`,
      `mutation($input: RemoveLabelsFromLabelableInput!) { removeLabelsFromLabelable(input: $input) { clientMutationId } }`,
      { input: { labelableId: i.id, labelIds: await resolveLabelIds(toRemove, false) } },
    );
  if (DRY) return;
  const now = names((await getIssue(n)).labels);
  const ok = add.every((a) => now.includes(a)) && remove.every((x) => !now.includes(x));
  if (!ok) throw new BoardError("verify failed: labels not updated");
  console.log(`labels: ${cardId(n)} ${now.join(", ")}`);
}

/** Analyst self-approval (PROTOCOL 5): an epic whose cards are all detailed and none needs a human. */
async function checkSelfApproval(epic: number) {
  if (!argv.includes("--analyst"))
    throw new BoardError(
      `${PLAN_APPROVED} needs --analyst (Analyst self-approval, PROTOCOL 5) or a human`,
    );
  const index = await boardIndex();
  if (!index.get(epic)?.labels.includes("epic"))
    throw new BoardError(`${cardId(epic)} is not an epic`);
  const flagged = descendants(epic, index).filter(
    (c) => c.state === "OPEN" && c.labels.some((l) => NEEDS_LABELS.includes(l)),
  );
  if (flagged.length)
    throw new BoardError(
      `cannot self-approve ${cardId(epic)}: ${flagged
        .slice(0, 8)
        .map(
          (c) =>
            `${cardId(c.number)}(${c.labels.filter((l) => NEEDS_LABELS.includes(l)).join(",")})`,
        )
        .join(" ")}`,
    );
}

async function opComment(n: number) {
  const body = readBody(flag("body-file"));
  const i = await getIssue(n);
  const r = await mutate(
    `comment ${cardId(n)}`,
    `mutation($input: AddCommentInput!) { addComment(input: $input) { commentEdge { node { id } } } }`,
    { input: { subjectId: i.id, body } },
  );
  if (!r) return;
  const again = await getIssue(n, 20);
  if (!again.comments.nodes.some((c) => c.body.trim() === body.trim()))
    throw new BoardError("verify failed: comment not found after write");
  console.log(`commented: ${cardId(n)} (${body.split("\n")[0]!.slice(0, 60)})`);
}

async function opDagCheck(epicRef: string | undefined) {
  const index = await boardIndex();
  let cards: BoardCard[];
  let scope: string;
  if (argv.includes("--epics")) {
    cards = [...index.values()].filter((c) => c.labels.includes("epic"));
    scope = "epics";
  } else {
    const epic = cardArg(epicRef, "dag_check <EPIC> | dag_check --epics");
    cards = descendants(epic, index);
    scope = cardId(epic);
  }
  const r = dagCheck(toNodes(cards));
  if (r.cycles.length) {
    for (const c of r.cycles) console.log(`CYCLE: ${c.join(" -> ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`dag ${scope}: ${cards.length} nodes, no cycles`);
  console.log(`order: ${r.order.join(" ") || "-"}`);
  console.log(`critical path: ${r.criticalPath.join(" -> ") || "-"}`);
  const inScope = new Set(cards.map((c) => c.number));
  const external = cards.flatMap((c) =>
    c.blockedBy
      .filter((b) => !inScope.has(b.number))
      .map(
        (b) =>
          `${cardId(c.number)}<-${cardId(b.number)}(${index.get(b.number)?.status ?? b.state.toLowerCase()})`,
      ),
  );
  if (external.length) console.log(`external blockers: ${external.join(", ")}`);
}

async function opHash(ref: string | undefined) {
  const bodyFile = flag("body-file");
  const n = cardArg(ref, "hash <n>");
  const body = bodyFile ? fs.readFileSync(bodyFile, "utf8") : (await getIssue(n)).body;
  const h = contractHash(body);
  if (!h) throw new BoardError(`${cardId(n)} has no ## Contract section`);
  const expect = flag("expect");
  if (expect && expect !== h) {
    console.log(
      `MISMATCH ${cardId(n)} contract_hash=${h} expected=${expect} -> label needs-replan`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`${cardId(n)} contract_hash=${h}`);
}

async function opNext() {
  const index = await boardIndex();
  const all = [...index.values()];
  const ready = all.filter((c) => c.status === "Ready");
  const inFlight = inFlightOf(all);
  console.log(
    `in flight: ${inFlight.map((c) => c.id).join(", ") || "none"} (WIP limit ${WIP_LIMIT})`,
  );

  const reasons: string[] = [];
  const epicOfCard = new Map<number, number>();
  const eligible = ready.filter((c) => {
    const id = cardId(c.number);
    const epic = epicOf(c, index);
    if (epic === null) return (reasons.push(`${id}: no epic`), false);
    epicOfCard.set(c.number, epic);
    if (!index.get(epic)?.labels.includes(PLAN_APPROVED))
      return (reasons.push(`${id}: epic ${cardId(epic)} not plan-approved`), false);
    const needs = c.labels.filter((l) => NEEDS_LABELS.includes(l));
    if (needs.length) return (reasons.push(`${id}: ${needs.join(",")}`), false);
    const open = c.blockedBy.filter((b) => !blockerDone(b, index));
    if (open.length)
      return (
        reasons.push(`${id}: blocked by ${open.map((b) => cardId(b.number)).join(",")}`),
        false
      );
    if (c.subIssues.total > c.subIssues.completed)
      return (
        reasons.push(`${id}: ${c.subIssues.total - c.subIssues.completed} open sub-issues`),
        false
      );
    return true;
  });

  // critical path + unblocks, per epic
  const crit = new Set<string>();
  const unblocks = new Map<string, number>();
  for (const epic of new Set(epicOfCard.values())) {
    const nodes = toNodes(descendants(epic, index));
    const r = dagCheck(nodes);
    if (r.cycles.length) {
      console.log(`STOP: dependency cycle ${r.cycles[0]!.join(" -> ")}`);
      process.exitCode = 3;
      return;
    }
    r.criticalPath.forEach((id) => crit.add(id));
    for (const n of nodes) unblocks.set(n.id, unblocksCount(nodes, n.id));
  }

  const ordered = orderCandidates(
    eligible.map((c) => ({
      id: cardId(c.number),
      epic: cardId(epicOfCard.get(c.number)!),
      priority: c.priority,
      estimate: c.estimate,
      labels: c.labels,
      blockersDone: true,
    })),
    {
      wipLimit: WIP_LIMIT,
      inFlight,
      onCriticalPath: (id) => crit.has(id),
      unblocksCount: (id) => unblocks.get(id) ?? 0,
    },
  );

  for (const c of ordered) {
    const lock = lockViolation(c, inFlight, WIP_LIMIT);
    const why = [
      crit.has(c.id) ? "critical-path" : null,
      `unblocks=${unblocks.get(c.id) ?? 0}`,
      `prio=${priorityName(c.priority)}`,
      `est=${c.estimate ?? "-"}`,
    ]
      .filter(Boolean)
      .join(" ");
    if (lock) {
      console.log(`skip ${c.id}: ${lock}`);
      continue;
    }
    if (c.labels.includes("autonomy:hitl"))
      console.log(`note: ${c.id} is autonomy:hitl, stop the loop after it for human review`);
    console.log(`reason: ${why}`);
    console.log(`next: ${c.id}`);
    return;
  }
  for (const r of reasons.slice(0, 10)) console.log(`  ${r}`);
  console.log(
    `STOP: no startable Ready card (${ready.length} Ready, ${eligible.length} eligible, ${inFlight.length} in flight)`,
  );
  process.exitCode = 3;
}

const inFlightOf = (all: Item[]) =>
  all
    .filter((c) => c.status !== null && IN_FLIGHT_STATUSES.includes(c.status))
    .map((c) => ({ id: cardId(c.number), labels: c.labels }));

async function opPickup(n: number) {
  const index = await boardIndex();
  const c = index.get(n);
  if (!c) throw new BoardError(`${cardId(n)} is not on the board`);
  if (c.status !== "Ready")
    throw new BoardError(`${cardId(n)} is ${c.status ?? "unset"}, not Ready`);
  const epic = epicOf(c, index);
  if (epic === null || !index.get(epic)?.labels.includes(PLAN_APPROVED))
    throw new BoardError(`${cardId(n)}: epic not plan-approved`);
  const open = c.blockedBy.filter((b) => !blockerDone(b, index));
  if (open.length)
    throw new BoardError(`${cardId(n)}: blocked by ${open.map((b) => cardId(b.number)).join(",")}`);
  const lock = lockViolation(c, inFlightOf([...index.values()]), WIP_LIMIT);
  if (lock) throw new BoardError(`${cardId(n)}: ${lock}`);
  const i = await getIssue(n);
  const hash = contractHash(i.body);
  if (!hash) throw new BoardError(`${cardId(n)} has no ## Contract section`);
  const branch = branchName(n, i.title);
  await setStatus(c.itemId, "In Progress", `move ${cardId(n)} Ready -> In Progress`);
  const body = pickupComment(n, hash, branch);
  await mutate(
    `comment ${cardId(n)} PICKUP`,
    `mutation($input: AddCommentInput!) { addComment(input: $input) { commentEdge { node { id } } } }`,
    { input: { subjectId: i.id, body } },
  );
  if (DRY) return;
  const again = await getIssue(n, 5);
  if ((await itemOf(again)).status !== "In Progress")
    throw new BoardError("verify failed: status not updated");
  if (!latestPickup(n, again.comments.nodes))
    throw new BoardError("verify failed: PICKUP not found");
  const est = estimateOf(i.body, c.estimate);
  console.log(body);
  console.log(`tier: ${cardTier(c.labels, est)} | estimate: ${est ?? "-"}`);
  console.log(`branch: ${branch}`);
}

function prFor(branch: string): GateFactsPr {
  const out = gh([
    "pr",
    "list",
    "--repo",
    REPO,
    "--head",
    branch,
    "--state",
    "all",
    "--json",
    "number,state,mergeCommit,createdAt",
  ]);
  const prs = JSON.parse(out) as {
    number: number;
    state: string;
    mergeCommit: { oid: string } | null;
    createdAt: string;
  }[];
  const pr = prs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return pr
    ? {
        number: pr.number,
        state: pr.state as "OPEN" | "MERGED" | "CLOSED",
        mergeCommit: pr.mergeCommit?.oid ?? null,
      }
    : null;
}
type GateFactsPr = {
  number: number;
  state: "OPEN" | "MERGED" | "CLOSED";
  mergeCommit: string | null;
} | null;

function mainCiFor(sha: string): "success" | "failure" | "pending" | "missing" {
  const runs = JSON.parse(
    gh([
      "run",
      "list",
      "--repo",
      REPO,
      "--branch",
      "main",
      "--commit",
      sha,
      "--json",
      "status,conclusion,event",
    ]),
  ) as { status: string; conclusion: string | null; event: string }[];
  const push = runs.filter((r) => r.event === "push");
  if (!push.length) return "missing";
  if (push.some((r) => r.status !== "completed")) return "pending";
  return push.every((r) => r.conclusion === "success") ? "success" : "failure";
}

async function opGate(n: number, requested: string) {
  const target = GATE_TARGETS.find((t) => t.toLowerCase() === requested.trim().toLowerCase());
  if (!target) throw new BoardError(`gate target must be one of: ${GATE_TARGETS.join(", ")}`);
  const i = await getIssue(n, 100);
  const pickup = latestPickup(n, i.comments.nodes);
  const pr = pickup ? prFor(pickup.branch) : null;
  const mainCi =
    target === "Done" && pr?.state === "MERGED" && pr.mergeCommit
      ? mainCiFor(pr.mergeCommit)
      : null;
  const failures = evaluateGate({
    n,
    target: target as GateTarget,
    body: i.body,
    labels: names(i.labels),
    comments: i.comments.nodes,
    pr,
    mainCi,
  });
  if (failures.length) {
    for (const f of failures) console.log(`FAIL ${cardId(n)} -> ${target}: ${f}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `PASS ${cardId(n)} -> ${target}${pr ? ` (PR #${pr.number} ${pr.state.toLowerCase()})` : ""}`,
  );
  if (!argv.includes("--check")) await opMove(n, target);
}

async function opPromote() {
  const index = await boardIndex();
  const only = flag("epic") ? cardArg(flag("epic"), "promote [--epic n]") : null;
  let promoted = 0;
  const held: string[] = [];
  for (const c of [...index.values()].sort((a, b) => a.number - b.number)) {
    if (c.status !== "Backlog" || c.state !== "OPEN") continue;
    const epic = epicOf(c, index);
    if (epic === null || (only !== null && epic !== only)) continue;
    const epicApproved = !!index.get(epic)?.labels.includes(PLAN_APPROVED);
    if (!epicApproved && only === null) continue; // unapproved epics are the Analyst's, stay quiet
    const i = await getIssue(c.number);
    const why = promotionBlockers({
      body: i.body,
      labels: c.labels,
      estimate: c.estimate,
      epicApproved,
    });
    if (why.length) {
      held.push(`${cardId(c.number)}: ${why.join("; ")}`);
      continue;
    }
    await setStatus(c.itemId, "Ready", `move ${cardId(c.number)} Backlog -> Ready`);
    promoted++;
    if (!DRY) console.log(`promoted: ${cardId(c.number)} ${c.title}`);
  }
  for (const h of held.slice(0, 15)) console.log(`  held ${h}`);
  console.log(`promote: ${promoted} promoted, ${held.length} held`);
}

async function opLocks(n: number) {
  const index = await boardIndex();
  const c = index.get(n);
  if (!c) throw new BoardError(`${cardId(n)} is not on the board`);
  const others = inFlightOf([...index.values()]).filter((x) => x.id !== cardId(n));
  const lock = lockViolation(c, others, Number.MAX_SAFE_INTEGER);
  if (lock) {
    console.log(`LOCKED ${cardId(n)}: ${lock}`);
    process.exitCode = 1;
  } else console.log(`locks ok: ${cardId(n)}`);
}

async function opDump() {
  const cards = [...(await boardIndex()).values()].sort((a, b) => a.number - b.number);
  if (argv.includes("--json")) {
    const omitIds = (k: string, v: unknown) => (k === "issueId" || k === "itemId" ? undefined : v);
    console.log(JSON.stringify(cards, omitIds, 1));
    return;
  }
  for (const c of cards)
    console.log(
      `${cardId(c.number)} | ${c.status ?? "unset"} | parent=${c.parent ? cardId(c.parent) : "-"} | ${c.labels.join(",") || "-"} | ${c.title}`,
    );
  console.log(`${cards.length} cards`);
}

type ImportItem = {
  key: string;
  parentKey?: string | null;
  parent?: number | null;
  title: string;
  body: string;
  labels: string[];
};

async function opImport() {
  const items = readJson<ImportItem[]>(flag("file"), "import --file F [--out F]");
  const map: Record<string, number> = {};
  const reusedKeys: string[] = [];
  const failures: string[] = [];
  let created = 0;
  for (const it of items) {
    try {
      let parent: number | null = it.parent ?? null;
      if (it.parentKey) {
        const p = map[it.parentKey];
        if (p === undefined) throw new BoardError(`parent ${it.parentKey} was not created`);
        if (p === 0) {
          // --dry-run: the parent would be new, so there is nothing to look up for its children yet
          console.log(`[dry-run] would create "${it.title}" under ${it.parentKey}`);
          map[it.key] = 0;
          continue;
        }
        parent = p;
      }
      const marker = `<!-- board-key: ${it.key} -->`;
      const body = it.body.includes(marker) ? it.body : `${it.body.trimEnd()}\n\n${marker}\n`;
      const r = await createCard({ title: it.title, body, parent, labels: it.labels });
      map[it.key] = r.number;
      if (DRY) continue;
      if (r.reused) reusedKeys.push(it.key);
      else created++;
      console.log(`${it.key} -> ${cardId(r.number)} ${r.reused ? "exists" : "created"}`);
    } catch (e) {
      failures.push(`${it.key}: ${(e as Error).message}`);
      console.log(`${it.key} FAILED: ${(e as Error).message}`);
    }
  }
  const out = flag("out");
  if (out && !DRY)
    fs.writeFileSync(
      out,
      JSON.stringify({ keyToIssue: map, reused: reusedKeys, failures }, null, 2),
    );
  console.log(`import: ${created} created, ${reusedKeys.length} reused, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
}

async function opLink() {
  const edges = readJson<{ blocker: number; blocked: number }[]>(flag("file"), "link --file F");
  let set = 0;
  let existed = 0;
  const failures: string[] = [];
  for (const e of edges) {
    try {
      const r = await relate(e.blocker, e.blocked);
      if (r === "exists") existed++;
      else set++;
    } catch (err) {
      failures.push(`${cardId(e.blocker)} blocks ${cardId(e.blocked)}: ${(err as Error).message}`);
    }
  }
  for (const f of failures) console.log(`FAILED ${f}`);
  console.log(`link: ${set} set, ${existed} already present, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
}

async function opVerify() {
  const expect = readJson<Expectation[]>(flag("expect-file"), "verify --expect-file F");
  const mismatches = verifyCards(expect, await boardIndex());
  for (const m of mismatches) console.log(m);
  console.log(`verify: ${expect.length} checked, ${mismatches.length} deviations`);
  if (mismatches.length) process.exitCode = 1;
}

async function opBootstrap() {
  const c = await ctx();
  const f = await statusField();
  for (const s of STATUSES) {
    if (f.options.some((o) => o.name === s)) console.log(`status ok: ${s}`);
    else console.log(`status MISSING: ${s} (human: add it to the project's Status field)`);
  }
  for (const w of c.workflows.filter((x) => FORBIDDEN_AUTOMATIONS.includes(x.name))) {
    if (w.enabled)
      console.log(`automation ON: "${w.name}" (human: disable it, Done is set by Picker)`);
    else console.log(`automation off: ${w.name}`);
  }
  const existing = await repoLabels();
  const missing = KIT_LABELS.filter((n) => !existing.has(n));
  for (const n of KIT_LABELS.filter((x) => !missing.includes(x))) console.log(`label ok: ${n}`);
  if (missing.length) {
    labelCache = existing;
    await resolveLabelIds(missing, true);
    if (!DRY) console.log(`labels created: ${missing.join(", ")}`);
  }
  const wantFields = [
    { name: "Estimate", dataType: "NUMBER" },
    {
      name: "Priority",
      dataType: "SINGLE_SELECT",
      singleSelectOptions: ["Urgent", "High", "Medium", "Low"].map((name) => ({
        name,
        color: "GRAY",
        description: "",
      })),
    },
  ];
  for (const w of wantFields) {
    if (field(c, w.name)) {
      console.log(`field ok: ${w.name}`);
      continue;
    }
    if (!argv.includes("--fields")) {
      console.log(`field absent (optional): ${w.name} (bootstrap --fields creates it)`);
      continue;
    }
    await mutate(
      `create field ${w.name}`,
      `mutation($input: CreateProjectV2FieldInput!) { createProjectV2Field(input: $input) { clientMutationId } }`,
      { input: { projectId: c.project.id, ...w } },
    );
    if (!DRY) console.log(`field created: ${w.name}`);
  }
  if (f.options.length && STATUSES.some((s) => !f.options.some((o) => o.name === s)))
    process.exitCode = 1;
}

async function main() {
  const op = argv[0];
  const pos = positional();
  switch (op) {
    case "whoami":
      return opWhoami();
    case "list_ready":
      return opListReady();
    case "get":
      return opGet(cardArg(pos[0], "get <n>"));
    case "create":
      return opCreate();
    case "relate":
      return opRelate(
        cardArg(pos[0], "relate <A> blocks <B>"),
        pos[1] ?? "",
        cardArg(pos[2], "relate <A> blocks <B>"),
      );
    case "move":
      return opMove(
        cardArg(pos[0], "move <n> <status>"),
        req(pos.slice(1).join(" "), "move <n> <status>"),
      );
    case "label":
      return opLabel(
        cardArg(pos[0], "label <n> +x -y"),
        argv.slice(2).filter((a) => /^[+-][^-]/.test(a)),
      );
    case "comment":
      return opComment(cardArg(pos[0], "comment <n> --body-file F"));
    case "dag_check":
      return opDagCheck(pos[0]);
    case "hash":
      return opHash(pos[0]);
    case "next":
      return opNext();
    case "pickup":
      return opPickup(cardArg(pos[0], "pickup <n>"));
    case "gate":
      return opGate(
        cardArg(pos[0], "gate <n> <status>"),
        req(pos.slice(1).join(" "), "gate <n> <In Review|QA|Done>"),
      );
    case "promote":
      return opPromote();
    case "locks":
      return opLocks(cardArg(pos[0], "locks <n>"));
    case "dump":
      return opDump();
    case "import":
      return opImport();
    case "link":
      return opLink();
    case "verify":
      return opVerify();
    case "bootstrap":
      return opBootstrap();
    default:
      console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]);
      process.exitCode = op ? 2 : 0;
  }
}

function req(v: string | undefined, usage: string): string {
  if (!v) throw new BoardError(`usage: ${usage}`);
  return v;
}

main().catch((e) => {
  console.error(e instanceof BoardError ? `board: ${e.message}` : e);
  process.exitCode = 1;
});
