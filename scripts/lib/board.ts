/**
 * Pure board logic for GitHub Projects (no network): card refs, status mapping, done-ness, epic lookup,
 * branch names and read-back verification. Used by scripts/board.ts; unit-tested in board.test.ts.
 */

/** Status options of the project's Status field, left to right (agents/BOARD.md). */
export const STATUSES = ["Backlog", "Ready", "In Progress", "In Review", "QA", "Done"] as const;
/** Statuses that count against the WIP limit and the locks (PROTOCOL section 7). */
export const IN_FLIGHT_STATUSES = ["In Progress", "In Review", "QA"];
export const NEEDS_LABELS = ["needs-human", "needs-adr", "needs-replan"];

export type BlockerRef = { number: number; state: string; stateReason: string | null };

/** One project item whose content is an issue, flattened. */
export type BoardCard = {
  number: number;
  title: string;
  status: string | null; // project Status option name, null if unset
  state: string; // OPEN | CLOSED
  stateReason: string | null; // COMPLETED | NOT_PLANNED | DUPLICATE | REOPENED | null
  labels: string[];
  parent: number | null;
  parentLabels: string[];
  blockedBy: BlockerRef[];
  subIssues: { total: number; completed: number };
  estimate: number | null;
  priority: number; // 0 none, 1 urgent, 2 high, 3 medium, 4 low
};

/** Accepts `12`, `#12` or `owner/repo#12`. Returns the issue number or null. */
export function parseCardRef(ref: string): number | null {
  const m = /^(?:[\w.-]+\/[\w.-]+)?#?(\d+)$/.exec(ref.trim());
  return m ? Number(m[1]) : null;
}

export const cardId = (n: number) => `#${n}`;

/** Branch for a card: `<n>-<title-slug>`, the same shape `gh issue develop` uses. */
export function branchName(n: number, title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug ? `${n}-${slug}` : String(n);
}

/** Resolves a requested status name against the field's options (case-insensitive). */
export function resolveStatus(requested: string, options: string[]): string | null {
  const want = requested.trim().toLowerCase();
  return options.find((o) => o.toLowerCase() === want) ?? null;
}

/** Done = Status `Done`, or closed as completed. */
export function isDone(c: { status: string | null; state: string; stateReason: string | null }) {
  return c.status === "Done" || (c.state === "CLOSED" && c.stateReason === "COMPLETED");
}

/** Canceled = closed as not planned or duplicate (the board has no Canceled column). */
export function isCanceled(c: { state: string; stateReason: string | null }) {
  return c.state === "CLOSED" && (c.stateReason === "NOT_PLANNED" || c.stateReason === "DUPLICATE");
}

/** Blocker satisfied: looked up on the board when present, else by the issue's own closed state. */
export function blockerDone(b: BlockerRef, index: Map<number, BoardCard>): boolean {
  const onBoard = index.get(b.number);
  return onBoard ? isDone(onBoard) : b.state === "CLOSED" && b.stateReason === "COMPLETED";
}

/** Priority option name -> rank (1 urgent .. 4 low, 0 none). Accepts Urgent/High/Medium/Low or P0..P3. */
export function priorityRank(name: string | null | undefined): number {
  if (!name) return 0;
  const n = name.trim().toLowerCase();
  const named = ["urgent", "high", "medium", "low"].indexOf(n);
  if (named >= 0) return named + 1;
  const p = /^p([0-3])$/.exec(n);
  return p ? Number(p[1]) + 1 : 0;
}
export const priorityName = (p: number) =>
  ["none", "urgent", "high", "medium", "low"][p] ?? String(p);

/** Nearest ancestor labeled `epic` (walks the board index; falls back to the direct parent's labels). */
export function epicOf(card: BoardCard, index: Map<number, BoardCard>): number | null {
  if (card.parent === null) return null;
  const seen = new Set<number>();
  let cur: number | null = card.parent;
  let labels = card.parentLabels;
  while (cur !== null && !seen.has(cur)) {
    seen.add(cur);
    const node = index.get(cur);
    if ((node?.labels ?? labels).includes("epic")) return cur;
    if (!node) return null;
    cur = node.parent;
    labels = node.parentLabels;
  }
  return null;
}

/** Every card below `root` (children, grandchildren, ...), in number order. */
export function descendants(root: number, index: Map<number, BoardCard>): BoardCard[] {
  const children = new Map<number, BoardCard[]>();
  for (const c of index.values()) {
    if (c.parent === null) continue;
    children.set(c.parent, [...(children.get(c.parent) ?? []), c]);
  }
  const out: BoardCard[] = [];
  const stack = [root];
  const seen = new Set<number>([root]);
  while (stack.length) {
    for (const c of children.get(stack.pop()!) ?? []) {
      if (seen.has(c.number)) continue;
      seen.add(c.number);
      out.push(c);
      stack.push(c.number);
    }
  }
  return out.sort((a, b) => a.number - b.number);
}

export type Expectation = {
  number: number;
  title?: string;
  parent?: number | null;
  status?: string;
  mustHaveLabels?: string[];
  mustNotHaveLabels?: string[];
  blockedBy?: number[]; // must be a subset of the card's blockers
};

/** Compares the board with expectations. Returns one `#n: what differs` line per deviation. */
export function verifyCards(expect: Expectation[], index: Map<number, BoardCard>): string[] {
  const out: string[] = [];
  for (const e of expect) {
    const c = index.get(e.number);
    const id = cardId(e.number);
    if (!c) {
      out.push(`${id}: not on the project board`);
      continue;
    }
    if (e.title !== undefined && c.title !== e.title)
      out.push(`${id}: title "${c.title}" != "${e.title}"`);
    if (e.parent !== undefined && c.parent !== e.parent)
      out.push(`${id}: parent ${c.parent ?? "none"} != ${e.parent ?? "none"}`);
    if (e.status !== undefined && c.status !== e.status)
      out.push(`${id}: status ${c.status ?? "unset"} != ${e.status}`);
    const missing = (e.mustHaveLabels ?? []).filter((l) => !c.labels.includes(l));
    if (missing.length) out.push(`${id}: missing labels ${missing.join(",")}`);
    const extra = (e.mustNotHaveLabels ?? []).filter((l) => c.labels.includes(l));
    if (extra.length) out.push(`${id}: unexpected labels ${extra.join(",")}`);
    const have = new Set(c.blockedBy.map((b) => b.number));
    const lacking = (e.blockedBy ?? []).filter((b) => !have.has(b));
    if (lacking.length) out.push(`${id}: not blocked by ${lacking.map(cardId).join(",")}`);
  }
  return out;
}
