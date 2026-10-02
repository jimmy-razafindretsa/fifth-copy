/**
 * Linear access layer for the agent kit (agents/PROTOCOL.md section 11).
 * Thin wrapper over Linear's GraphQL API so tool schemas stay out of agent context.
 *
 *   npx tsx scripts/linear.ts <op> [args] [--dry-run]
 *
 * Ops (kit names, not Linear's):
 *   whoami                                     check the API key and team
 *   list_ready                                 Ready cards with blockers, epic, labels, estimate, priority
 *   get <ISSUE> [--comments N]                 description, state, labels, relations, parent, comments (newest first), branch
 *   create --title T --body-file F [--parent EPIC] [--labels a,b] [--estimate N] [--priority P]
 *                                              searches by title (+epic) first; never duplicates
 *   relate <A> blocks <B>
 *   move <ISSUE> <state>                       Picker only
 *   label <ISSUE> +x -y [--create-missing]
 *   comment <ISSUE> --body-file F
 *   dag_check <EPIC> | dag_check --epics       cycles, topological order, critical path (exit 1 on cycle)
 *   hash <ISSUE> [--expect H]                  contract hash (exit 1 if --expect differs)
 *   next                                       Picker ordering (PROTOCOL 6) + locks (7); last line `next: <ISSUE>` or `STOP: <why>`
 *   bootstrap                                  create missing workflow states (Ready, QA) and kit labels
 *
 * Writes are re-read and verified. --dry-run prints the mutation instead of sending it.
 * Env: LINEAR_API_KEY, LINEAR_TEAM_KEY (default ENG), LINEAR_WIP_LIMIT (default 1). Loaded from .env.local / .env.
 */
import fs from "node:fs";
import { config as loadEnv } from "dotenv";
import {
  contractHash,
  dagCheck,
  lockViolation,
  orderCandidates,
  unblocksCount,
  type CardNode,
} from "./lib/kit";

loadEnv({ path: [".env.local", ".env"], quiet: true });

const API = "https://api.linear.app/graphql";
const TEAM_KEY = process.env.LINEAR_TEAM_KEY || "ENG";
const WIP_LIMIT = Number(process.env.LINEAR_WIP_LIMIT || 1);
const argv = process.argv.slice(2);
const DRY = argv.includes("--dry-run");

export const KIT_STATES = [
  { name: "Ready", type: "unstarted", color: "#4ea7fc" },
  { name: "QA", type: "started", color: "#f2c94c" },
] as const;

export const KIT_LABELS = [
  "type:feature",
  "type:bug",
  "type:chore",
  "type:adr",
  "type:spike",
  "epic",
  "ui",
  "touches:prisma",
  "touches:deps",
  "discovered",
  "autonomy:afk",
  "autonomy:hitl",
  "plan-approved",
  "needs-human",
  "needs-adr",
  "needs-replan",
];
const NEEDS = ["needs-human", "needs-adr", "needs-replan"];
const IN_FLIGHT_STATES = ["In Progress", "In Review", "QA"];

class LinearError extends Error {}

function flag(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}
function positional(): string[] {
  const out: string[] = [];
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--dry-run" || a === "--epics" || a === "--create-missing") continue;
    if (a.startsWith("--")) {
      i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const key = process.env.LINEAR_API_KEY;
  if (!key) throw new LinearError("LINEAR_API_KEY is not set (.env.local). Stop and report.");
  let res: Response;
  try {
    res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: key },
      body: JSON.stringify({ query, variables }),
    });
  } catch (e) {
    throw new LinearError(`Linear unreachable: ${(e as Error).message}`);
  }
  const body = (await res.json().catch(() => ({}))) as { data?: T; errors?: { message: string }[] };
  if (!res.ok || body.errors?.length) {
    throw new LinearError(
      `Linear API error (${res.status}): ${body.errors?.map((e) => e.message).join("; ") ?? res.statusText}`,
    );
  }
  return body.data as T;
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

// ---------- types and queries ----------

type StateRef = { name: string; type: string };
type IssueRef = { identifier: string; title?: string; state: StateRef };
type Label = { id: string; name: string };
type Issue = {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  state: StateRef;
  estimate: number | null;
  priority: number;
  branchName: string;
  url: string;
  labels: { nodes: Label[] };
  parent: { id: string; identifier: string; labels: { nodes: Label[] } } | null;
  relations: { nodes: { type: string; relatedIssue: IssueRef }[] };
  inverseRelations: { nodes: { type: string; issue: IssueRef }[] };
};
type IssueWithComments = Issue & {
  children: { nodes: { identifier: string; title: string; state: StateRef }[] };
  comments: { nodes: { body: string; createdAt: string; user: { name: string } | null }[] };
};

const ISSUE_FIELDS = `
  id identifier title description estimate priority branchName url
  state { name type }
  labels { nodes { id name } }
  parent { id identifier labels { nodes { id name } } }
  relations(first: 100) { nodes { type relatedIssue { identifier title state { name type } } } }
  inverseRelations(first: 100) { nodes { type issue { identifier title state { name type } } } }
`;

type Team = {
  id: string;
  key: string;
  name: string;
  states: { nodes: { id: string; name: string; type: string }[] };
};

let teamCache: Team | null = null;
async function team(): Promise<Team> {
  if (teamCache) return teamCache;
  const d = await gql<{ teams: { nodes: Team[] } }>(
    `query($key: String!) { teams(filter: { key: { eq: $key } }) {
      nodes { id key name states(first: 100) { nodes { id name type } } } } }`,
    { key: TEAM_KEY },
  );
  const t = d.teams.nodes[0];
  if (!t) throw new LinearError(`Team ${TEAM_KEY} not found (check LINEAR_TEAM_KEY)`);
  return (teamCache = t);
}

async function labelsForTeam(): Promise<Label[]> {
  const t = await team();
  const all: (Label & { team: { key: string } | null })[] = [];
  let after: string | null = null;
  for (;;) {
    const d: {
      issueLabels: {
        nodes: (Label & { team: { key: string } | null })[];
        pageInfo: { hasNextPage: boolean; endCursor: string };
      };
    } = await gql(
      `query($after: String) { issueLabels(first: 250, after: $after) {
        nodes { id name team { key } } pageInfo { hasNextPage endCursor } } }`,
      { after },
    );
    all.push(...d.issueLabels.nodes);
    if (!d.issueLabels.pageInfo.hasNextPage) break;
    after = d.issueLabels.pageInfo.endCursor;
  }
  return all.filter((l) => l.team === null || l.team.key === t.key);
}

async function getIssue(id: string, comments = 0): Promise<IssueWithComments> {
  const d = await gql<{ issue: IssueWithComments | null }>(
    `query($id: String!) { issue(id: $id) { ${ISSUE_FIELDS}
      children(first: 250) { nodes { identifier title state { name type } } }
      comments(first: ${Math.max(comments, 1)}) { nodes { body createdAt user { name } } } } }`,
    { id },
  );
  if (!d.issue) throw new LinearError(`Issue ${id} not found`);
  return d.issue;
}

async function teamIssues(filter: Record<string, unknown>): Promise<Issue[]> {
  const t = await team();
  const out: Issue[] = [];
  let after: string | null = null;
  for (;;) {
    const d: { issues: { nodes: Issue[]; pageInfo: { hasNextPage: boolean; endCursor: string } } } =
      await gql(
        `query($filter: IssueFilter, $after: String) { issues(first: 100, after: $after, filter: $filter) {
          nodes { ${ISSUE_FIELDS} } pageInfo { hasNextPage endCursor } } }`,
        { filter: { team: { id: { eq: t.id } }, ...filter }, after },
      );
    out.push(...d.issues.nodes);
    if (!d.issues.pageInfo.hasNextPage) break;
    after = d.issues.pageInfo.endCursor;
  }
  return out;
}

// ---------- helpers ----------

const labelNames = (i: { labels: { nodes: Label[] } }) => i.labels.nodes.map((l) => l.name);
const blockers = (i: Issue) =>
  i.inverseRelations.nodes.filter((r) => r.type === "blocks").map((r) => r.issue);
const blocks = (i: Issue) =>
  i.relations.nodes.filter((r) => r.type === "blocks").map((r) => r.relatedIssue);
const isDone = (s: StateRef) => s.type === "completed";
const readBody = (file: string | undefined) => {
  if (!file) throw new LinearError("--body-file is required");
  return fs.readFileSync(file, "utf8");
};
const prio = (p: number) => ["none", "urgent", "high", "medium", "low"][p] ?? String(p);

function toNodes(issues: Issue[]): CardNode[] {
  const ids = new Set(issues.map((i) => i.identifier));
  return issues.map((i) => ({
    id: i.identifier,
    done: isDone(i.state) || i.state.type === "canceled",
    blockedBy: blockers(i)
      .map((b) => b.identifier)
      .filter((b) => ids.has(b)),
  }));
}

// ---------- ops ----------

async function opWhoami() {
  const d = await gql<{ viewer: { name: string } }>(`{ viewer { name } }`);
  const t = await team();
  console.log(`viewer: ${d.viewer.name} | team: ${t.key} (${t.name})`);
  console.log(`states: ${t.states.nodes.map((s) => `${s.name}[${s.type}]`).join(", ")}`);
}

async function opGet(id: string) {
  const n = Number(flag("comments") ?? 20);
  const i = await getIssue(id, n);
  console.log(`${i.identifier} ${i.title}`);
  console.log(
    `state: ${i.state.name} | estimate: ${i.estimate ?? "-"} | priority: ${prio(i.priority)} | parent: ${i.parent?.identifier ?? "-"}`,
  );
  console.log(`labels: ${labelNames(i).join(", ") || "-"}`);
  console.log(`branch: ${i.branchName} | url: ${i.url}`);
  console.log(
    `blocked by: ${
      blockers(i)
        .map((b) => `${b.identifier}(${b.state.name})`)
        .join(", ") || "-"
    }`,
  );
  console.log(
    `blocks: ${
      blocks(i)
        .map((b) => `${b.identifier}(${b.state.name})`)
        .join(", ") || "-"
    }`,
  );
  if (i.children.nodes.length)
    console.log(
      `children: ${i.children.nodes.map((c) => `${c.identifier}(${c.state.name})`).join(", ")}`,
    );
  console.log(`contract_hash: ${contractHash(i.description ?? "") ?? "none (no ## Contract)"}`);
  console.log(`\n--- description ---\n${i.description ?? ""}`);
  const comments = [...i.comments.nodes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  console.log(`\n--- comments (newest first, ${comments.length}) ---`);
  for (const c of comments) console.log(`\n[${c.createdAt} ${c.user?.name ?? "?"}]\n${c.body}`);
}

async function opListReady() {
  const issues = await teamIssues({ state: { name: { eq: "Ready" } } });
  if (!issues.length) return console.log("no Ready cards");
  for (const i of issues) {
    const b = blockers(i);
    const open = b.filter((x) => !isDone(x.state));
    console.log(
      [
        i.identifier,
        `epic=${i.parent?.identifier ?? "-"}`,
        `est=${i.estimate ?? "-"}`,
        `prio=${prio(i.priority)}`,
        `labels=${labelNames(i).join(",") || "-"}`,
        `blockers=${b.map((x) => `${x.identifier}:${x.state.name}`).join(",") || "-"}`,
        open.length ? "BLOCKED" : "unblocked",
        i.title,
      ].join(" | "),
    );
  }
}

async function resolveLabelIds(names: string[], createMissing: boolean): Promise<string[]> {
  if (!names.length) return [];
  const t = await team();
  const existing = await labelsForTeam();
  const ids: string[] = [];
  for (const name of names) {
    const hit = existing.find((l) => l.name === name);
    if (hit) {
      ids.push(hit.id);
      continue;
    }
    if (!createMissing)
      throw new LinearError(
        `label "${name}" does not exist (run bootstrap, or pass --create-missing)`,
      );
    const r = await mutate<{ issueLabelCreate: { issueLabel: Label } }>(
      `create label ${name}`,
      `mutation($input: IssueLabelCreateInput!) { issueLabelCreate(input: $input) { issueLabel { id name } } }`,
      { input: { name, teamId: t.id } },
    );
    ids.push(r?.issueLabelCreate.issueLabel.id ?? `dry:${name}`);
  }
  return ids;
}

async function opCreate() {
  const title = flag("title");
  if (!title) throw new LinearError("--title is required");
  const body = readBody(flag("body-file"));
  const parentKey = flag("parent");
  const labels = (flag("labels") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const estimate = flag("estimate");
  const priority = flag("priority");
  if (estimate && Number(estimate) > 3)
    throw new LinearError("estimate > 3: split the card (PROTOCOL section 3)");

  const parent = parentKey ? await getIssue(parentKey) : null;
  const dupes = await teamIssues({
    title: { eqIgnoreCase: title },
    ...(parent ? { parent: { id: { eq: parent.id } } } : {}),
  });
  if (dupes.length) {
    console.log(`exists: ${dupes[0]!.identifier} (not duplicated)`);
    return;
  }
  const t = await team();
  const input: Record<string, unknown> = {
    teamId: t.id,
    title,
    description: body,
    labelIds: await resolveLabelIds(labels, argv.includes("--create-missing")),
  };
  if (parent) input.parentId = parent.id;
  if (estimate) input.estimate = Number(estimate);
  if (priority) input.priority = Number(priority);
  const backlog = t.states.nodes.find((s) => s.name === "Backlog");
  if (backlog) input.stateId = backlog.id;

  const r = await mutate<{ issueCreate: { issue: { identifier: string } } }>(
    "issueCreate",
    `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { issue { identifier } } }`,
    { input },
  );
  if (!r) return;
  const created = await getIssue(r.issueCreate.issue.identifier);
  if (created.title !== title) throw new LinearError("verify failed: created issue title mismatch");
  console.log(`created: ${created.identifier} (${created.state.name}) ${created.url}`);
}

async function opRelate(a: string, verb: string, b: string) {
  if (verb !== "blocks") throw new LinearError(`usage: relate <A> blocks <B>`);
  if (a === b) throw new LinearError("an issue cannot block itself");
  const [ia, ib] = await Promise.all([getIssue(a), getIssue(b)]);
  if (blocks(ia).some((x) => x.identifier === ib.identifier)) {
    console.log(`exists: ${a} blocks ${b}`);
    return;
  }
  const r = await mutate(
    `${a} blocks ${b}`,
    `mutation($input: IssueRelationCreateInput!) { issueRelationCreate(input: $input) { success } }`,
    { input: { issueId: ia.id, relatedIssueId: ib.id, type: "blocks" } },
  );
  if (!r) return;
  const again = await getIssue(a);
  if (!blocks(again).some((x) => x.identifier === ib.identifier))
    throw new LinearError("verify failed: relation not present after write");
  console.log(`related: ${a} blocks ${b}`);
}

async function opMove(id: string, stateName: string) {
  const t = await team();
  const state = t.states.nodes.find((s) => s.name.toLowerCase() === stateName.toLowerCase());
  if (!state)
    throw new LinearError(
      `state "${stateName}" not in team ${t.key}: ${t.states.nodes.map((s) => s.name).join(", ")}`,
    );
  const i = await getIssue(id);
  if (i.state.name === state.name) return console.log(`unchanged: ${id} already ${state.name}`);
  const r = await mutate(
    `move ${id} ${i.state.name} -> ${state.name}`,
    `mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }`,
    { id: i.id, input: { stateId: state.id } },
  );
  if (!r) return;
  const again = await getIssue(id);
  if (again.state.name !== state.name) throw new LinearError("verify failed: state not updated");
  console.log(`moved: ${id} ${i.state.name} -> ${again.state.name}`);
}

async function opLabel(id: string, changes: string[]) {
  const add = changes.filter((c) => c.startsWith("+")).map((c) => c.slice(1));
  const remove = changes.filter((c) => c.startsWith("-")).map((c) => c.slice(1));
  if (!add.length && !remove.length) throw new LinearError("usage: label <ISSUE> +x -y");
  const i = await getIssue(id);
  const current = i.labels.nodes;
  const addIds = await resolveLabelIds(
    add.filter((n) => !current.some((l) => l.name === n)),
    argv.includes("--create-missing"),
  );
  const next = [...current.filter((l) => !remove.includes(l.name)).map((l) => l.id), ...addIds];
  const r = await mutate(
    `label ${id} ${changes.join(" ")}`,
    `mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }`,
    { id: i.id, input: { labelIds: next } },
  );
  if (!r) return;
  const names = labelNames(await getIssue(id));
  const ok = add.every((a) => names.includes(a)) && remove.every((x) => !names.includes(x));
  if (!ok) throw new LinearError("verify failed: labels not updated");
  console.log(`labels: ${id} ${names.join(", ")}`);
}

async function opComment(id: string) {
  const body = readBody(flag("body-file"));
  const i = await getIssue(id);
  const r = await mutate<{ commentCreate: { comment: { id: string } } }>(
    `comment ${id}`,
    `mutation($input: CommentCreateInput!) { commentCreate(input: $input) { comment { id } } }`,
    { input: { issueId: i.id, body } },
  );
  if (!r) return;
  const again = await getIssue(id, 50);
  if (!again.comments.nodes.some((c) => c.body.trim() === body.trim()))
    throw new LinearError("verify failed: comment not found after write");
  console.log(`commented: ${id} (${body.split("\n")[0]!.slice(0, 60)})`);
}

async function opDagCheck(epic: string | undefined) {
  let issues: Issue[];
  let scope: string;
  if (argv.includes("--epics")) {
    issues = await teamIssues({ labels: { name: { eq: "epic" } } });
    scope = "epics";
  } else {
    if (!epic) throw new LinearError("usage: dag_check <EPIC> | dag_check --epics");
    const e = await getIssue(epic);
    issues = await teamIssues({ parent: { id: { eq: e.id } } });
    scope = epic;
  }
  const r = dagCheck(toNodes(issues));
  if (r.cycles.length) {
    for (const c of r.cycles) console.log(`CYCLE: ${c.join(" -> ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`dag ${scope}: ${issues.length} nodes, no cycles`);
  console.log(`order: ${r.order.join(" ") || "-"}`);
  console.log(`critical path: ${r.criticalPath.join(" -> ") || "-"}`);
  const external = issues.flatMap((i) =>
    blockers(i)
      .filter((b) => !issues.some((x) => x.identifier === b.identifier))
      .map((b) => `${i.identifier}<-${b.identifier}(${b.state.name})`),
  );
  if (external.length) console.log(`external blockers: ${external.join(", ")}`);
}

async function opHash(id: string) {
  const i = await getIssue(id);
  const h = contractHash(i.description ?? "");
  if (!h) throw new LinearError(`${id} has no ## Contract section`);
  const expect = flag("expect");
  if (expect && expect !== h) {
    console.log(`MISMATCH ${id} contract_hash=${h} expected=${expect} -> label needs-replan`);
    process.exitCode = 1;
    return;
  }
  console.log(`${id} contract_hash=${h}`);
}

async function opNext() {
  const [ready, inFlightIssues] = await Promise.all([
    teamIssues({ state: { name: { eq: "Ready" } } }),
    teamIssues({ state: { name: { in: IN_FLIGHT_STATES } } }),
  ]);
  const inFlight = inFlightIssues.map((i) => ({ id: i.identifier, labels: labelNames(i) }));
  console.log(
    `in flight: ${inFlight.map((c) => c.id).join(", ") || "none"} (WIP limit ${WIP_LIMIT})`,
  );

  const reasons: string[] = [];
  const eligible = ready.filter((i) => {
    const labels = labelNames(i);
    if (!i.parent) return (reasons.push(`${i.identifier}: no epic`), false);
    if (!i.parent.labels.nodes.some((l) => l.name === "plan-approved"))
      return (
        reasons.push(`${i.identifier}: epic ${i.parent.identifier} not plan-approved`),
        false
      );
    const needs = labels.filter((l) => NEEDS.includes(l));
    if (needs.length) return (reasons.push(`${i.identifier}: ${needs.join(",")}`), false);
    const open = blockers(i).filter((b) => !isDone(b.state));
    if (open.length)
      return (
        reasons.push(`${i.identifier}: blocked by ${open.map((b) => b.identifier).join(",")}`),
        false
      );
    return true;
  });

  // critical path + unblocks, per epic
  const epicIds = [...new Set(eligible.map((i) => i.parent!.id))];
  const crit = new Set<string>();
  const unblocks = new Map<string, number>();
  for (const epicId of epicIds) {
    const children = await teamIssues({ parent: { id: { eq: epicId } } });
    const nodes = toNodes(children);
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
    eligible.map((i) => ({
      id: i.identifier,
      epic: i.parent!.identifier,
      priority: i.priority,
      estimate: i.estimate,
      labels: labelNames(i),
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
      `prio=${prio(c.priority)}`,
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

async function opBootstrap() {
  const t = await team();
  for (const s of KIT_STATES) {
    if (t.states.nodes.some((x) => x.name === s.name)) {
      console.log(`state ok: ${s.name}`);
      continue;
    }
    await mutate(
      `create state ${s.name} [${s.type}]`,
      `mutation($input: WorkflowStateCreateInput!) { workflowStateCreate(input: $input) { success } }`,
      { input: { teamId: t.id, name: s.name, type: s.type, color: s.color } },
    );
    if (!DRY) console.log(`state created: ${s.name}`);
  }
  const existing = await labelsForTeam();
  const missing = KIT_LABELS.filter((n) => !existing.some((l) => l.name === n));
  for (const n of KIT_LABELS.filter((n) => !missing.includes(n))) console.log(`label ok: ${n}`);
  if (missing.length) await resolveLabelIds(missing, true);
  if (!DRY && missing.length) console.log(`labels created: ${missing.join(", ")}`);
  if (!DRY) {
    teamCache = null;
    const again = await team();
    const absent = KIT_STATES.filter((s) => !again.states.nodes.some((x) => x.name === s.name));
    if (absent.length)
      throw new LinearError(`verify failed: states missing ${absent.map((s) => s.name)}`);
    for (const s of ["Backlog", "In Progress", "In Review", "Done", "Canceled"])
      if (!again.states.nodes.some((x) => x.name === s))
        console.log(`warning: expected state "${s}" not found; rename in Linear team settings`);
  }
  console.log(
    "reminder (human): disable Linear's GitHub automation that moves issues to Done on PR merge.",
  );
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
      return opGet(req(pos[0], "get <ISSUE>"));
    case "create":
      return opCreate();
    case "relate":
      return opRelate(
        req(pos[0], "relate <A> blocks <B>"),
        pos[1] ?? "",
        req(pos[2], "relate <A> blocks <B>"),
      );
    case "move":
      return opMove(req(pos[0], "move <ISSUE> <state>"), pos.slice(1).join(" "));
    case "label":
      return opLabel(
        req(pos[0], "label <ISSUE> +x -y"),
        argv.slice(2).filter((a) => /^[+-][^-]/.test(a)),
      );
    case "comment":
      return opComment(req(pos[0], "comment <ISSUE> --body-file F"));
    case "dag_check":
      return opDagCheck(pos[0]);
    case "hash":
      return opHash(req(pos[0], "hash <ISSUE>"));
    case "next":
      return opNext();
    case "bootstrap":
      return opBootstrap();
    default:
      console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]);
      process.exitCode = op ? 2 : 0;
  }
}

function req(v: string | undefined, usage: string): string {
  if (!v) throw new LinearError(`usage: ${usage}`);
  return v;
}

main().catch((e) => {
  console.error(e instanceof LinearError ? `linear: ${e.message}` : e);
  process.exitCode = 1;
});
