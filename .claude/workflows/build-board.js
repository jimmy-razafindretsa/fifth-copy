export const meta = {
  name: "build-board",
  description:
    "Turn requirements into a full Linear board: features > issues > sub-issues (technical and non-technical) with dependency links",
  whenToUse:
    "You have requirements (pasted text or a file) and want the whole board built in Linear: gather from several angles, regroup into one hierarchy, derive dependencies, create the cards, verify them.",
  phases: [
    {
      title: "Gather",
      detail: "extract requirements, scan the existing board, 4 parallel lenses propose items",
    },
    {
      title: "Regroup",
      detail: "merge into one hierarchy, derive dependencies, critic loop, deterministic checks",
    },
    { title: "Prepare", detail: "make sure the labels exist in Linear" },
    {
      title: "Create",
      detail: "one agent per feature creates feature, issues and sub-issues top-down",
    },
    { title: "Link", detail: "set blocked-by relations once every identifier is known" },
    { title: "Verify", detail: "read everything back from Linear and compare with the plan" },
    { title: "Record", detail: "write the plan and key-to-identifier map into the repo" },
  ],
};

/*
 * args (all optional except one of requirements / requirementsFile):
 *   requirements      string  the requirements, pasted
 *   requirementsFile  string  path to a file with the requirements (read by the agents)
 *   team              string  default "Aegis"
 *   project           string  default "fifth copy"
 *   foundationsEpic   string  existing epic that blocks every root feature (default "AEG-1"; "" to disable)
 *   dryRun            bool    stop after Regroup and return the plan; nothing is written to Linear
 *   planName          string  file name under work/plan/ for the record (default "board")
 *   criticRounds      number  max completeness-critic rounds (default 2)
 *
 * Board rules (agents/BOARD.md): cards start in Backlog, features get `epic` + `needs-replan` (= "details pending",
 * the Analyst writes Contracts later), `plan-approved` is NEVER set here, descriptions stay minimal.
 */

const A = args || {};
const TEAM = A.team || "Aegis";
const PROJECT = A.project || "fifth copy";
const FOUNDATIONS = A.foundationsEpic === undefined ? "AEG-1" : A.foundationsEpic;
const DRY = !!A.dryRun;
const PLAN_NAME = A.planName || "board";
const CRITIC_ROUNDS = typeof A.criticRounds === "number" ? A.criticRounds : 2;
if (!A.requirements && !A.requirementsFile) {
  throw new Error("Pass args.requirements (text) or args.requirementsFile (path).");
}

const LINEAR_TOOLS =
  "Linear connector tools. Load their schemas first with ToolSearch, query " +
  '"select:mcp__055d0e82-1972-4a2c-99a6-fa05a3811ae2__save_issue,mcp__055d0e82-1972-4a2c-99a6-fa05a3811ae2__list_issues,' +
  "mcp__055d0e82-1972-4a2c-99a6-fa05a3811ae2__get_issue,mcp__055d0e82-1972-4a2c-99a6-fa05a3811ae2__list_issue_labels," +
  'mcp__055d0e82-1972-4a2c-99a6-fa05a3811ae2__save_issue_label" (if that finds nothing, ToolSearch "linear save_issue").';

const REPO_CONTEXT =
  "Read-only repo context (read what exists, skip what does not): docs/product-spec.md, AGENTS.md, agents/BOARD.md, " +
  "docs/adr/*.md, prisma/schema/*.prisma, docs/design/components.md. Do not edit any file.";

const REQ_SOURCE = A.requirementsFile
  ? `The requirements are in the file ${A.requirementsFile} (read it fully).`
  : `The requirements:\n"""\n${A.requirements}\n"""`;

// ---------- schemas ----------

const NODE_PROPS = {
  title: {
    type: "string",
    maxLength: 90,
    description: "Short imperative or noun phrase, unique among siblings",
  },
  description: {
    type: "string",
    maxLength: 240,
    description: "One or two plain sentences, no headings",
  },
  track: { type: "string", enum: ["technical", "non-technical"] },
  type: { type: "string", enum: ["feature", "chore", "spike", "adr"] },
  covers: {
    type: "array",
    items: { type: "string" },
    description: "Requirement ids (R1..) this item serves",
  },
};

const SUB = {
  type: "object",
  properties: { ...NODE_PROPS },
  required: ["title", "description", "track", "type"],
};
const ISSUE = {
  type: "object",
  properties: {
    ...NODE_PROPS,
    key: { type: "string" },
    subissues: {
      type: "array",
      items: { ...SUB, properties: { ...SUB.properties, key: { type: "string" } } },
    },
  },
  required: ["title", "description", "track", "type"],
};
const FEATURE = {
  type: "object",
  properties: {
    ...NODE_PROPS,
    key: { type: "string" },
    issues: { type: "array", items: ISSUE },
  },
  required: ["title", "description", "track", "issues"],
};
const DEP = {
  type: "object",
  properties: {
    blocker: {
      type: "string",
      description:
        "Key (or existing identifier like AEG-3, or exact title for lens output) that must finish first",
    },
    blocked: {
      type: "string",
      description:
        "Key (or existing identifier / exact title) that cannot start until the blocker is done",
    },
    why: { type: "string", maxLength: 140 },
  },
  required: ["blocker", "blocked", "why"],
};

const REQS_SCHEMA = {
  type: "object",
  properties: {
    requirements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "R1, R2, ..." },
          text: { type: "string", maxLength: 300 },
          kind: {
            type: "string",
            enum: ["functional", "non-functional", "constraint", "non-technical"],
          },
        },
        required: ["id", "text", "kind"],
      },
    },
    openQuestions: { type: "array", items: { type: "string" } },
  },
  required: ["requirements"],
};

const EXISTING_SCHEMA = {
  type: "object",
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          identifier: { type: "string" },
          title: { type: "string" },
          parent: { type: "string", description: "parent identifier or empty" },
          state: { type: "string" },
        },
        required: ["identifier", "title"],
      },
    },
  },
  required: ["issues"],
};

const LENS_SCHEMA = {
  type: "object",
  properties: {
    features: { type: "array", items: FEATURE },
    dependencies: { type: "array", items: DEP },
  },
  required: ["features", "dependencies"],
};

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    features: { type: "array", items: FEATURE },
    dependencies: { type: "array", items: DEP },
    notes: { type: "string", maxLength: 600 },
  },
  required: ["features", "dependencies"],
};

const CRITIC_SCHEMA = {
  type: "object",
  properties: {
    uncoveredRequirements: { type: "array", items: { type: "string" } },
    gaps: { type: "array", items: { type: "string", maxLength: 200 } },
    duplicates: { type: "array", items: { type: "string", maxLength: 200 } },
    suspiciousDependencies: { type: "array", items: { type: "string", maxLength: 200 } },
    needsAnotherRound: { type: "boolean" },
  },
  required: [
    "uncoveredRequirements",
    "gaps",
    "duplicates",
    "suspiciousDependencies",
    "needsAnotherRound",
  ],
};

const DEPS_SCHEMA = {
  type: "object",
  properties: { dependencies: { type: "array", items: DEP } },
  required: ["dependencies"],
};

const CYCLE_SCHEMA = {
  type: "object",
  properties: {
    drop: {
      type: "array",
      items: {
        type: "object",
        properties: { blocker: { type: "string" }, blocked: { type: "string" } },
        required: ["blocker", "blocked"],
      },
    },
  },
  required: ["drop"],
};

const CREATE_SCHEMA = {
  type: "object",
  properties: {
    created: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          identifier: { type: "string" },
          reused: { type: "boolean" },
        },
        required: ["key", "identifier"],
      },
    },
    failures: { type: "array", items: { type: "string" } },
  },
  required: ["created", "failures"],
};

const OK_SCHEMA = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    failures: { type: "array", items: { type: "string" } },
    labelsCreated: { type: "array", items: { type: "string" } },
  },
  required: ["ok", "failures"],
};

const VERIFY_SCHEMA = {
  type: "object",
  properties: {
    checked: { type: "number" },
    mismatches: { type: "array", items: { type: "string" } },
  },
  required: ["checked", "mismatches"],
};

// ---------- pure helpers ----------

const IDENT = /^[A-Z]+-\d+$/;
const norm = (s) =>
  String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
const clip = (s, n) => {
  const t = String(s || "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
};
const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

/** Re-keys the plan deterministically (F1, F1.1, F1.1.1), dedupes sibling titles, trims text. Returns {plan, keyMap}. */
function normalizePlan(raw, existingTitles) {
  const keyMap = new Map(); // old key / normalized title -> new key
  const dropped = [];
  const seenFeature = new Set();
  const features = [];
  let fi = 0;
  for (const f of raw.features || []) {
    const ft = norm(f.title);
    if (!ft || seenFeature.has(ft) || existingTitles.has(ft)) {
      dropped.push(`feature "${f.title}" (duplicate or already on the board)`);
      continue;
    }
    seenFeature.add(ft);
    fi++;
    const fkey = `F${fi}`;
    if (f.key) keyMap.set(f.key, fkey);
    keyMap.set("t:" + ft, fkey);
    const nf = {
      key: fkey,
      title: clip(f.title, 90),
      description: clip(f.description, 240),
      track: f.track,
      type: "epic",
      covers: f.covers || [],
      issues: [],
    };
    const seenIssue = new Set();
    let ii = 0;
    for (const i of f.issues || []) {
      const it = norm(i.title);
      if (!it || seenIssue.has(it)) {
        dropped.push(`issue "${i.title}" under "${f.title}" (duplicate)`);
        continue;
      }
      seenIssue.add(it);
      ii++;
      const ikey = `${fkey}.${ii}`;
      if (i.key) keyMap.set(i.key, ikey);
      if (!keyMap.has("t:" + it)) keyMap.set("t:" + it, ikey);
      const ni = {
        key: ikey,
        title: clip(i.title, 90),
        description: clip(i.description, 240),
        track: i.track,
        type: i.type || "feature",
        covers: i.covers || [],
        subissues: [],
      };
      const seenSub = new Set();
      let si = 0;
      for (const s of i.subissues || []) {
        const st = norm(s.title);
        if (!st || seenSub.has(st)) {
          dropped.push(`sub-issue "${s.title}" under "${i.title}" (duplicate)`);
          continue;
        }
        seenSub.add(st);
        si++;
        const skey = `${ikey}.${si}`;
        if (s.key) keyMap.set(s.key, skey);
        if (!keyMap.has("t:" + st)) keyMap.set("t:" + st, skey);
        ni.subissues.push({
          key: skey,
          title: clip(s.title, 90),
          description: clip(s.description, 240),
          track: s.track,
          type: s.type || "chore",
          covers: s.covers || [],
        });
      }
      nf.issues.push(ni);
    }
    features.push(nf);
  }
  return { plan: { features }, keyMap, dropped };
}

function allNodes(plan) {
  const out = [];
  for (const f of plan.features) {
    out.push({ ...f, level: 0, parent: null });
    for (const i of f.issues) {
      out.push({ ...i, level: 1, parent: f.key });
      for (const s of i.subissues) out.push({ ...s, level: 2, parent: i.key });
    }
  }
  return out;
}

/** fromNewKeys=true: refs already use the regenerated keys (dependency pass). false: refs use the model's own keys or titles. */
function resolveRef(ref, keyMap, validKeys, fromNewKeys) {
  const r = String(ref || "").trim();
  if (IDENT.test(r)) return r; // existing Linear identifier
  if (fromNewKeys && validKeys.has(r)) return r;
  if (!fromNewKeys && keyMap.has(r)) return keyMap.get(r);
  const byTitle = keyMap.get("t:" + norm(r));
  if (byTitle) return byTitle;
  return null;
}

/** Cleans edges: resolves refs, drops self/ancestor edges and duplicates. Returns {edges, dropped}. */
function cleanEdges(rawEdges, keyMap, plan, fromNewKeys) {
  const nodes = allNodes(plan);
  const validKeys = new Set(nodes.map((n) => n.key));
  const parentOf = new Map(nodes.map((n) => [n.key, n.parent]));
  const isAncestor = (a, b) => {
    for (let p = parentOf.get(b); p; p = parentOf.get(p)) if (p === a) return true;
    return false;
  };
  const dropped = [];
  const seen = new Set();
  const edges = [];
  for (const e of rawEdges) {
    const a = resolveRef(e.blocker, keyMap, validKeys, fromNewKeys);
    const b = resolveRef(e.blocked, keyMap, validKeys, fromNewKeys);
    if (!a || !b) {
      dropped.push(`unresolvable: ${e.blocker} -> ${e.blocked}`);
      continue;
    }
    if (a === b || isAncestor(a, b) || isAncestor(b, a)) {
      dropped.push(`self/ancestor: ${a} -> ${b}`);
      continue;
    }
    const k = a + ">" + b;
    if (seen.has(k)) continue;
    seen.add(k);
    edges.push({ blocker: a, blocked: b, why: clip(e.why, 140) });
  }
  return { edges, dropped };
}

function findCycle(edges) {
  const out = new Map();
  for (const e of edges) {
    if (!out.has(e.blocker)) out.set(e.blocker, []);
    out.get(e.blocker).push(e.blocked);
  }
  const color = new Map();
  const stack = [];
  let found = null;
  const visit = (n) => {
    if (found) return;
    color.set(n, 1);
    stack.push(n);
    for (const m of out.get(n) || []) {
      if (found) break;
      const c = color.get(m) || 0;
      if (c === 0) visit(m);
      else if (c === 1) found = [...stack.slice(stack.indexOf(m)), m];
    }
    stack.pop();
    color.set(n, 2);
  };
  for (const n of [...out.keys()].sort()) if (!color.get(n)) visit(n);
  return found;
}

/** Removes edges implied by longer paths (a>b when a>...>b exists). Assumes no cycles. */
function transitiveReduce(edges) {
  const out = new Map();
  for (const e of edges) {
    if (!out.has(e.blocker)) out.set(e.blocker, []);
    out.get(e.blocker).push(e.blocked);
  }
  const reach = (from, skipEdgeTo) => {
    const seen = new Set();
    const stack = (out.get(from) || []).filter((t) => t !== skipEdgeTo);
    while (stack.length) {
      const n = stack.pop();
      if (seen.has(n)) continue;
      seen.add(n);
      for (const m of out.get(n) || []) stack.push(m);
    }
    return seen;
  };
  return edges.filter((e) => !reach(e.blocker, e.blocked).has(e.blocked));
}

function criticalPathLength(edges) {
  const out = new Map();
  const nodes = new Set();
  for (const e of edges) {
    nodes.add(e.blocker);
    nodes.add(e.blocked);
    if (!out.has(e.blocker)) out.set(e.blocker, []);
    out.get(e.blocker).push(e.blocked);
  }
  const memo = new Map();
  const depth = (n) => {
    if (memo.has(n)) return memo.get(n);
    let best = 0;
    for (const m of out.get(n) || []) best = Math.max(best, depth(m));
    memo.set(n, best + 1);
    return best + 1;
  };
  let max = 0;
  for (const n of nodes) max = Math.max(max, depth(n));
  return max;
}

function outline(plan) {
  return allNodes(plan)
    .map((n) => `${"  ".repeat(n.level)}${n.key} [${n.track}] ${n.title}`)
    .join("\n");
}

// ---------- 1. Gather ----------

phase("Gather");
log("Gather: extracting requirements, scanning the existing board, running 4 lenses");

const existingP = agent(
  `List every issue that already exists in the Linear project "${PROJECT}" (team ${TEAM}), including parents and archived=false. ` +
    `${LINEAR_TOOLS} Use list_issues with project "${PROJECT}", team "${TEAM}", fields [title, parentId, status], paging with the cursor until hasNextPage is false. ` +
    `Return identifier, title, parent identifier (or empty) and state for each. Do not create or change anything.`,
  { label: "scan existing board", phase: "Gather", schema: EXISTING_SCHEMA, effort: "low" },
);

const reqs = await agent(
  `${REQ_SOURCE}\n\nSplit the requirements into atomic, testable statements. One requirement = one statement a person could say "done" or "not done" about. ` +
    `Number them R1, R2, ... in order. Keep the author's meaning; do not invent requirements, but DO split compound sentences and ` +
    `surface implied ones that the text clearly depends on (e.g. a "login" requirement implies sessions). Classify each: functional, non-functional ` +
    `(performance, security, accessibility, reliability), constraint (platform, budget, law, age), or non-technical (content, copy, ` +
    `translations, onboarding, policy, launch, support). Also list open questions where the text is ambiguous. ${REPO_CONTEXT}`,
  { label: "extract requirements", phase: "Gather", schema: REQS_SCHEMA, effort: "high" },
);
if (!reqs || !reqs.requirements || !reqs.requirements.length)
  throw new Error("No requirements extracted; check the input.");
const REQ_IDS = reqs.requirements.map((r) => r.id);
const REQ_TEXT = reqs.requirements.map((r) => `${r.id} (${r.kind}): ${r.text}`).join("\n");
log(
  `${reqs.requirements.length} requirements extracted, ${(reqs.openQuestions || []).length} open questions`,
);

const SHAPE_RULES =
  "Output shape: FEATURES (a user- or business-meaningful capability, becomes a Linear epic), each with ISSUES (a deliverable unit " +
  "of work a person could finish in a few days), each optionally with SUB-ISSUES (concrete steps of an issue, 2-6 when it naturally " +
  "splits, e.g. data model, API, screen, tests, copy). Titles unique among siblings. Descriptions: ONE or TWO plain sentences, " +
  "no markdown, no acceptance criteria (those come later). Tag every item track=technical or track=non-technical and type " +
  "(feature, chore, spike for research, adr for a decision that must be made first). Fill covers with requirement ids. " +
  "dependencies: only REAL ones (B cannot start or be finished until A is done: shared data model, auth before protected screens, " +
  "API before the screen using it, decision before the work it governs, content before the screen that shows it). " +
  "Reference items by their exact title. No dependency between an item and its own parent or child.";

const LENSES = [
  {
    key: "journeys",
    brief:
      "USER JOURNEYS. Identify every actor (e.g. host/teacher, player/student, admin, anonymous visitor). For each actor walk the full journey " +
      "end to end (discover, join, use, finish, come back) and propose the features, issues and sub-issues that make each step work, " +
      "including empty, loading and error states and mobile use. Mostly user-facing and technical-with-UI items.",
  },
  {
    key: "non-technical",
    brief:
      "NON-TECHNICAL WORK. Content and copy, translations (every supported language), legal/privacy/consent (especially for minors), " +
      "accessibility statements, onboarding and help for each actor, teacher/admin guides, analytics and success metrics, moderation/abuse " +
      "handling, support, launch checklist, pilot/feedback plan. Only items a requirement, the audience or the law actually calls for.",
  },
  {
    key: "architecture",
    brief:
      "ARCHITECTURE AND DATA. Domain model and persistence, authentication/identity and authorization, real-time or background mechanisms, " +
      "APIs and server actions, external integrations, hosting/deployment choice (as adr/spike items when undecided), performance and " +
      "scaling constraints. Order so foundations come before the features that stand on them.",
  },
  {
    key: "quality-ops",
    brief:
      "QUALITY, SECURITY AND OPERATIONS. Test strategy per feature (unit, e2e, load), accessibility checks, security review items (input " +
      "validation, abuse limits, data protection), observability/logging/error reporting, backups and data retention, CI/CD additions beyond " +
      'what the repo already has, performance budgets. Attach to the feature they protect rather than inventing a giant "testing" epic.',
  },
];

const lensResults = await parallel(
  LENSES.map(
    (l) => () =>
      agent(
        `You are one lens of a board-planning team. Propose board items from your lens only; other lenses cover the rest and a later step merges and dedupes.\n\n` +
          `LENS: ${l.brief}\n\nREQUIREMENTS (cite ids in covers):\n${REQ_TEXT}\n\n${REPO_CONTEXT}\n` +
          `Already on the board (do NOT propose these again; you may depend on them): see the identifier list below.\n` +
          `Foundations epic ${FOUNDATIONS || "(none)"} is already built; do not re-propose scaffold, database setup, CI or the design system.\n\n${SHAPE_RULES}`,
        { label: `lens: ${l.key}`, phase: "Gather", schema: LENS_SCHEMA, effort: "high" },
      ),
  ),
);
const existing = (await existingP) || { issues: [] };
const existingTitles = new Set(existing.issues.map((i) => norm(i.title)));
const lensOk = lensResults
  .map((r, idx) => (r ? { lens: LENSES[idx].key, ...r } : null))
  .filter(Boolean);
log(
  `${lensOk.length}/${LENSES.length} lenses returned; ${existing.issues.length} issues already on the board`,
);
if (!lensOk.length) throw new Error("All lenses failed.");

// ---------- 2. Regroup ----------

phase("Regroup");

const existingList =
  existing.issues.map((i) => `${i.identifier} ${i.title}`).join("\n") || "(none)";
const lensDump = lensOk
  .map(
    (r) =>
      `### ${r.lens}\n${JSON.stringify({ features: r.features, dependencies: r.dependencies })}`,
  )
  .join("\n\n");

const MERGE_RULES =
  `${SHAPE_RULES}\n\nMERGE RULES: merge duplicates across lenses into one item (keep the clearest title); every requirement id must be covered by at least ` +
  `one item; group related issues under the feature a stakeholder would recognise; technical and non-technical items live side by side under ` +
  `the same feature when they serve the same capability, and a feature may be purely technical or purely non-technical when it is a ` +
  `foundation or a workstream. Aim for 5-12 features. Give EVERY feature, issue and sub-issue a unique "key" you invent (F1, F1.1, F1.1.1 style) ` +
  `and refer to items ONLY by those keys in dependencies (or by an existing Linear identifier such as AEG-3 for already existing work). ` +
  `Do not recreate anything on the existing board.`;

let raw = await agent(
  `Merge these lens proposals into ONE board plan.\n\nREQUIREMENTS:\n${REQ_TEXT}\n\nEXISTING BOARD (do not duplicate):\n${existingList}\n\n` +
    `LENS PROPOSALS:\n${lensDump}\n\n${MERGE_RULES}`,
  { label: "merge lenses", phase: "Regroup", schema: PLAN_SCHEMA, effort: "high" },
);
if (!raw) throw new Error("Merge step failed.");

let critic = null;
for (let round = 1; round <= CRITIC_ROUNDS; round++) {
  const n0 = normalizePlan(raw, existingTitles);
  const covered = new Set(allNodes(n0.plan).flatMap((n) => n.covers || []));
  const uncovered = REQ_IDS.filter((id) => !covered.has(id));
  critic = await agent(
    `You are the completeness critic of a board plan. Be skeptical and concrete.\n\nREQUIREMENTS:\n${REQ_TEXT}\n\nPLAN OUTLINE:\n${outline(n0.plan)}\n\n` +
      `Requirements with no covering item (mechanical check): ${uncovered.join(", ") || "none"}\n\n` +
      `Report: uncoveredRequirements (ids truly not delivered by any item, including ones that are only nominally covered), gaps (important work ` +
      `a competent team would add: e.g. missing non-technical work, error/empty states, data retention, deployment decision), duplicates ` +
      `(items that overlap and should merge), suspiciousDependencies (links that look wrong or are missing). Set needsAnotherRound only if ` +
      `fixing these would change the plan materially.`,
    { label: `critic round ${round}`, phase: "Regroup", schema: CRITIC_SCHEMA, effort: "high" },
  );
  if (!critic || !critic.needsAnotherRound) break;
  log(
    `critic round ${round}: ${critic.uncoveredRequirements.length} uncovered, ${critic.gaps.length} gaps, ${critic.duplicates.length} duplicates; revising`,
  );
  const revised = await agent(
    `Revise the board plan to address the critic's findings. Return the COMPLETE corrected plan (all features, issues, sub-issues, dependencies), ` +
      `not a diff. Keep keys of unchanged items; give new items new unique keys.\n\nREQUIREMENTS:\n${REQ_TEXT}\n\nEXISTING BOARD:\n${existingList}\n\n` +
      `CURRENT PLAN:\n${JSON.stringify(raw)}\n\nCRITIC FINDINGS:\n${JSON.stringify(critic)}\n\n${MERGE_RULES}`,
    { label: `revise round ${round}`, phase: "Regroup", schema: PLAN_SCHEMA, effort: "high" },
  );
  if (revised) raw = revised;
}

const norm1 = normalizePlan(raw, existingTitles);
let plan = norm1.plan;
const keyMap = norm1.keyMap;
if (norm1.dropped.length)
  log(`normalize dropped ${norm1.dropped.length}: ${norm1.dropped.slice(0, 5).join("; ")}`);
if (!plan.features.length) throw new Error("Plan has no features after normalization.");

// Independent dependency pass over the final hierarchy, then union with the synthesizer's edges.
const depPass = await agent(
  `Derive the dependencies of this board from scratch. For every pair where B cannot sensibly start or finish before A, return A blocks B. ` +
    `Think in layers: decisions/ADRs and spikes before the work they govern; data model and identity before features that read or write them; ` +
    `APIs before screens; content/copy before screens that show it; legal/consent before collecting data; deployment decision before ` +
    `real-time load testing; tests after the thing they test. Prefer dependencies between ISSUES (and between features when whole ` +
    `capabilities depend on others); use sub-issues only for steps inside one issue's chain across issues. Never link an item to its own ` +
    `parent or child. Do not add edges that are implied by a chain (A>B>C needs no A>C). Reference items ONLY by their keys, or by existing ` +
    `identifiers: ${existingList.split("\n").slice(0, 40).join(" | ")}.\n\nPLAN:\n${outline(plan)}\n\nDESCRIPTIONS:\n` +
    allNodes(plan)
      .map((n) => `${n.key}: ${n.description}`)
      .join("\n"),
  { label: "dependency pass", phase: "Regroup", schema: DEPS_SCHEMA, effort: "high" },
);

const fromMerge = cleanEdges(raw.dependencies || [], keyMap, plan, false);
const fromPass = cleanEdges((depPass && depPass.dependencies) || [], keyMap, plan, true);
const seenEdge = new Set();
let edges = [];
for (const e of [...fromMerge.edges, ...fromPass.edges]) {
  const k = e.blocker + ">" + e.blocked;
  if (!seenEdge.has(k)) {
    seenEdge.add(k);
    edges.push(e);
  }
}
const edgeDropped = [...fromMerge.dropped, ...fromPass.dropped];

for (let attempt = 1; attempt <= 3; attempt++) {
  const cyc = findCycle(edges);
  if (!cyc) break;
  log(`cycle found (attempt ${attempt}): ${cyc.join(" -> ")}`);
  const fix =
    attempt < 3
      ? await agent(
          `These dependencies form a cycle: ${cyc.join(" -> ")}. Decide which ONE or TWO links are wrong or the weakest and should be dropped so ` +
            `the rest stays valid. Items:\n${cyc
              .map((k) => allNodes(plan).find((n) => n.key === k))
              .filter(Boolean)
              .map((n) => `${n.key} ${n.title}: ${n.description}`)
              .join("\n")}`,
          {
            label: `break cycle ${attempt}`,
            phase: "Regroup",
            schema: CYCLE_SCHEMA,
            effort: "medium",
          },
        )
      : null;
  const drop =
    fix && fix.drop && fix.drop.length
      ? fix.drop
      : [{ blocker: cyc[cyc.length - 2], blocked: cyc[cyc.length - 1] }];
  const before = edges.length;
  edges = edges.filter(
    (e) => !drop.some((d) => d.blocker === e.blocker && d.blocked === e.blocked),
  );
  if (edges.length === before)
    edges = edges.filter(
      (e) => !(e.blocker === cyc[cyc.length - 2] && e.blocked === cyc[cyc.length - 1]),
    );
}
if (findCycle(edges)) throw new Error("Could not break dependency cycles.");

// Foundations first: every feature with no incoming edge from another feature waits for the existing Foundations epic.
if (FOUNDATIONS) {
  const featureOf = (k) => k.split(".")[0];
  const hasIncoming = new Set(
    edges
      .filter((e) => !IDENT.test(e.blocker) && featureOf(e.blocker) !== featureOf(e.blocked))
      .map((e) => featureOf(e.blocked)),
  );
  for (const f of plan.features) {
    if (!hasIncoming.has(f.key))
      edges.push({
        blocker: FOUNDATIONS,
        blocked: f.key,
        why: "Nothing outside Foundations is picked until it is Done",
      });
  }
}
const edgesBeforeReduce = edges.length;
edges = transitiveReduce(edges);

const nodes = allNodes(plan);
const covered = new Set(nodes.flatMap((n) => n.covers || []));
const stillUncovered = REQ_IDS.filter((id) => !covered.has(id));
const stats = {
  requirements: REQ_IDS.length,
  features: plan.features.length,
  issues: nodes.filter((n) => n.level === 1).length,
  subissues: nodes.filter((n) => n.level === 2).length,
  technical: nodes.filter((n) => n.track === "technical").length,
  nonTechnical: nodes.filter((n) => n.track === "non-technical").length,
  dependencies: edges.length,
  dependenciesReducedAway: edgesBeforeReduce - edges.length,
  dependenciesDropped: edgeDropped.length,
  longestChain: criticalPathLength(edges),
  uncoveredRequirements: stillUncovered,
  openQuestions: reqs.openQuestions || [],
  criticLeft: critic
    ? {
        gaps: critic.gaps,
        duplicates: critic.duplicates,
        suspiciousDependencies: critic.suspiciousDependencies,
      }
    : null,
};
log(
  `plan: ${stats.features} features, ${stats.issues} issues, ${stats.subissues} sub-issues, ${stats.dependencies} dependencies ` +
    `(longest chain ${stats.longestChain}); uncovered: ${stillUncovered.join(", ") || "none"}`,
);

if (DRY) return { dryRun: true, stats, plan, edges, edgeDropped };

// ---------- 3. Prepare ----------

phase("Prepare");
const prep = await agent(
  `Make sure these labels exist for team ${TEAM} in Linear; create any that are missing and leave existing ones alone: ` +
    `epic, needs-replan, type:feature, type:chore, type:spike, type:adr, track:technical, track:non-technical. ` +
    `${LINEAR_TOOLS} Use list_issue_labels (team "${TEAM}", limit 250) then save_issue_label (teamId 091a3ad5-8458-4f95-a238-e1385cedd55d) for missing ones. ` +
    `Do NOT create or apply the label plan-approved. Return ok=true when all eight exist.`,
  { label: "ensure labels", phase: "Prepare", schema: OK_SCHEMA, effort: "low" },
);
if (!prep || !prep.ok) throw new Error(`Label preparation failed: ${JSON.stringify(prep)}`);

// ---------- 4. Create ----------

phase("Create");
const typeLabel = (t) => `type:${t === "epic" ? "feature" : t}`;
const trackLabel = (t) => `track:${t}`;

const created = await pipeline(plan.features, (f) => {
  const items = [];
  items.push({
    key: f.key,
    parentKey: null,
    title: f.title,
    description: f.description,
    labels: ["epic", "needs-replan", trackLabel(f.track)],
  });
  for (const i of f.issues) {
    items.push({
      key: i.key,
      parentKey: f.key,
      title: i.title,
      description: i.description,
      labels: [typeLabel(i.type), trackLabel(i.track)],
    });
    for (const s of i.subissues) {
      items.push({
        key: s.key,
        parentKey: i.key,
        title: s.title,
        description: s.description,
        labels: [typeLabel(s.type), trackLabel(s.track)],
      });
    }
  }
  return agent(
    `Create Linear issues for ONE feature subtree, top-down, in the order given (a parent always comes before its children). ` +
      `${LINEAR_TOOLS}\n\nFor each item: (1) call list_issues with team "${TEAM}", project "${PROJECT}", query = the exact title, and check whether an ` +
      `issue with the SAME title and the same parent already exists; if so reuse its identifier and do not create (reused=true). (2) otherwise call ` +
      `save_issue with team "${TEAM}", project "${PROJECT}", state "Backlog", the exact title, the exact description (do not edit or extend it), ` +
      `labels exactly as given, and parentId = the identifier you got for parentKey (omit for the feature). Do NOT set estimate, priority, assignee ` +
      `or any label not listed. Never add the label plan-approved. Keep titles/descriptions verbatim; wrap nothing in markdown.\n\n` +
      `Return created = [{key, identifier, reused}] for every item you handled and failures = strings for anything that failed (do not retry a ` +
      `failing item more than once).\n\nITEMS (in order):\n${JSON.stringify(items, null, 1)}`,
    {
      label: `create ${f.key} ${f.title.slice(0, 40)}`,
      phase: "Create",
      schema: CREATE_SCHEMA,
      effort: "low",
    },
  );
});

const idByKey = new Map();
const createFailures = [];
for (const r of created) {
  if (!r) {
    createFailures.push("a feature agent returned nothing");
    continue;
  }
  for (const c of r.created) idByKey.set(c.key, c.identifier);
  createFailures.push(...r.failures);
}
const missingKeys = nodes.filter((n) => !idByKey.has(n.key)).map((n) => n.key);
log(
  `created/reused ${idByKey.size}/${nodes.length} items; ${missingKeys.length} missing; ${createFailures.length} failures`,
);

// ---------- 5. Link ----------

phase("Link");
const idOf = (k) => (IDENT.test(k) ? k : idByKey.get(k));
const resolvedEdges = edges
  .map((e) => ({ ...e, blockerId: idOf(e.blocker), blockedId: idOf(e.blocked) }))
  .filter((e) => e.blockerId && e.blockedId);
const skippedEdges = edges.length - resolvedEdges.length;
const byBlocked = new Map();
for (const e of resolvedEdges) {
  if (!byBlocked.has(e.blockedId)) byBlocked.set(e.blockedId, []);
  byBlocked.get(e.blockedId).push(e.blockerId);
}
const linkJobs = chunk(
  [...byBlocked.entries()].map(([id, blockers]) => ({ id, blockedBy: blockers })),
  12,
);
const linkResults = await parallel(
  linkJobs.map(
    (job, idx) => () =>
      agent(
        `Set dependencies in Linear. ${LINEAR_TOOLS}\n\nFor each entry call save_issue with id = entry.id and blockedBy = entry.blockedBy (append-only, safe to repeat). ` +
          `Change nothing else. Return ok=true if every call succeeded, otherwise ok=false and failures listing the ids.\n\n${JSON.stringify(job)}`,
        {
          label: `link batch ${idx + 1}/${linkJobs.length}`,
          phase: "Link",
          schema: OK_SCHEMA,
          effort: "low",
        },
      ),
  ),
);
const linkFailures = linkResults.flatMap((r, i) =>
  r && r.ok ? [] : (r && r.failures) || [`batch ${i + 1} returned nothing`],
);
log(
  `${resolvedEdges.length} dependency links set (${skippedEdges} skipped for missing identifiers, ${linkFailures.length} failures)`,
);

// ---------- 6. Verify ----------

phase("Verify");
const expectedBlockers = new Map();
for (const e of resolvedEdges) {
  if (!expectedBlockers.has(e.blockedId)) expectedBlockers.set(e.blockedId, []);
  expectedBlockers.get(e.blockedId).push(e.blockerId);
}
const expectation = nodes
  .filter((n) => idByKey.has(n.key))
  .map((n) => ({
    id: idByKey.get(n.key),
    title: n.title,
    parent: n.parent ? idByKey.get(n.parent) || null : null,
    mustHaveLabels: n.level === 0 ? ["epic", "needs-replan"] : [typeLabel(n.type)],
    blockedBy: (expectedBlockers.get(idByKey.get(n.key)) || []).sort(),
  }));
const verifyResults = await parallel(
  chunk(expectation, 15).map(
    (group, idx) => () =>
      agent(
        `Verify issues in Linear against expectations. ${LINEAR_TOOLS}\n\nFor each entry call get_issue with id and includeRelations=true and check: title equals; ` +
          `project is "${PROJECT}"; status is Backlog; parent identifier equals entry.parent (null means no parent); every label in mustHaveLabels is present; ` +
          `the label plan-approved is NOT present; relations.blockedBy identifiers (as a set) include every identifier in entry.blockedBy. ` +
          `Report each deviation as one short string "ID: what differs". Read only; change nothing.\n\n${JSON.stringify(group)}`,
        { label: `verify batch ${idx + 1}`, phase: "Verify", schema: VERIFY_SCHEMA, effort: "low" },
      ),
  ),
);
let mismatches = verifyResults.flatMap((r) =>
  r ? r.mismatches : ["a verify batch returned nothing"],
);
log(`verify: ${mismatches.length} deviations`);

if (mismatches.length) {
  await agent(
    `Fix these deviations in Linear using save_issue (labels: use addLabels/removeLabels; relations: blockedBy is append-only; for a wrong parent set parentId). ` +
      `${LINEAR_TOOLS}\n\nExpected state per issue:\n${JSON.stringify(expectation.filter((e) => mismatches.some((m) => m.startsWith(e.id + ":"))))}\n\nDeviations:\n${mismatches.join("\n")}\n\n` +
      `Fix only what is listed. Never add plan-approved. Return ok and failures.`,
    { label: "fix deviations", phase: "Verify", schema: OK_SCHEMA, effort: "low" },
  );
  const again = await agent(
    `Re-verify these issues. ${LINEAR_TOOLS} For each id call get_issue with includeRelations=true and compare with the expectation ` +
      `(title, parent, mustHaveLabels, blockedBy superset, no plan-approved). Return the remaining deviations.\n\n` +
      JSON.stringify(expectation.filter((e) => mismatches.some((m) => m.startsWith(e.id + ":")))),
    { label: "re-verify", phase: "Verify", schema: VERIFY_SCHEMA, effort: "low" },
  );
  mismatches = again ? again.mismatches : mismatches;
}

// ---------- 7. Record ----------

phase("Record");
const record = {
  planName: PLAN_NAME,
  team: TEAM,
  project: PROJECT,
  stats,
  keyToIdentifier: Object.fromEntries(idByKey),
  plan,
  dependencies: resolvedEdges.map((e) => ({
    blocker: e.blockerId,
    blocked: e.blockedId,
    why: e.why,
  })),
  problems: { missingKeys, createFailures, linkFailures, remainingMismatches: mismatches },
};
await agent(
  `Write this exact JSON (pretty-printed, 2 spaces) to the file work/plan/${PLAN_NAME}.json, creating the directory if needed. Do not alter the data, ` +
    `touch no other file, and do not run git commands.\n\n${JSON.stringify(record)}`,
  { label: "write record", phase: "Record", effort: "low" },
);

return {
  summary: {
    ...stats,
    created: idByKey.size,
    expected: nodes.length,
    missing: missingKeys,
    createFailures,
    linkFailures,
    remainingDeviations: mismatches,
    planFile: `work/plan/${PLAN_NAME}.json`,
    reminder:
      "Features carry needs-replan (details pending) and no plan-approved: a human approves epics, then the Analyst writes Contracts.",
  },
  featureOutline: plan.features.map(
    (f) => `${idByKey.get(f.key) || f.key} ${f.title}: ${f.issues.length} issues`,
  ),
};
