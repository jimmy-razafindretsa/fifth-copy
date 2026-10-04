/**
 * Pure logic for the agent kit (no network): contract hashing, DAG checks, Picker ordering and locks.
 * See agents/PROTOCOL.md sections 5-7. Unit-tested in kit.test.ts.
 */
import { createHash } from "node:crypto";

/** Text of the "## Contract" section (without the heading), or null if absent. */
export function contractSection(description: string): string | null {
  const lines = description.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((l) => /^##\s+Contract\s*$/.test(l));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n");
}

/**
 * sha256 (first 12 hex chars) of the normalized Contract section.
 * Checkbox state is normalized so Deliver ticking boxes does not change the hash;
 * any edit to the wording, verify targets or number of criteria does.
 */
export function contractHash(description: string): string | null {
  const section = contractSection(description);
  if (section === null) return null;
  const normalized = section
    .split("\n")
    .map((l) => l.replace(/^(\s*[-*]\s*)\[[xX ]\]/, "$1[ ]").replace(/\s+$/, ""))
    .filter((l) => l.trim() !== "")
    .join("\n");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 12);
}

export type Criterion = { id: string; text: string; verify: string | null; checked: boolean };

/** Parses "- [ ] C1 text | verify: `cmd`" lines. */
export function parseContract(description: string): Criterion[] {
  const section = contractSection(description) ?? "";
  const out: Criterion[] = [];
  for (const line of section.split("\n")) {
    const m = /^\s*[-*]\s*\[([ xX])\]\s*(C\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const [, box, id, rest] = m;
    const v = /\|\s*verify:\s*(.+)$/.exec(rest!);
    out.push({
      id: id!,
      text: (v ? rest!.slice(0, v.index) : rest!).trim(),
      verify: v ? v[1]!.trim() : null,
      checked: box !== " ",
    });
  }
  return out;
}

export type CardNode = {
  id: string; // card id, e.g. #12
  done: boolean;
  blockedBy: string[]; // card ids
};

export type DagResult = {
  cycles: string[][];
  order: string[]; // topological order (blockers first); empty if cycles exist
  criticalPath: string[]; // longest chain of not-done cards
  depth: Map<string, number>; // longest remaining chain starting at a card (including itself)
};

export function dagCheck(nodes: CardNode[]): DagResult {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // edges blocker -> blocked, restricted to nodes in the set
  const out = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const n of nodes) for (const b of n.blockedBy) if (byId.has(b)) out.get(b)!.push(n.id);
  for (const list of out.values()) list.sort();

  // Cycle detection (DFS, colors)
  const color = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const visit = (id: string) => {
    color.set(id, 1);
    stack.push(id);
    for (const next of out.get(id)!) {
      const c = color.get(next) ?? 0;
      if (c === 0) visit(next);
      else if (c === 1) cycles.push([...stack.slice(stack.indexOf(next)), next]);
    }
    stack.pop();
    color.set(id, 2);
  };
  for (const id of [...byId.keys()].sort()) if ((color.get(id) ?? 0) === 0) visit(id);
  if (cycles.length) return { cycles, order: [], criticalPath: [], depth: new Map() };

  // Kahn topological order, deterministic
  const indeg = new Map<string, number>([...byId.keys()].map((k) => [k, 0]));
  for (const list of out.values()) for (const t of list) indeg.set(t, indeg.get(t)! + 1);
  const ready = [...indeg]
    .filter(([, d]) => d === 0)
    .map(([k]) => k)
    .sort();
  const order: string[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    for (const t of out.get(id)!) {
      indeg.set(t, indeg.get(t)! - 1);
      if (indeg.get(t) === 0) {
        ready.push(t);
        ready.sort();
      }
    }
  }

  // Longest remaining chain from each node (count only not-done cards)
  const depth = new Map<string, number>();
  const nextOnPath = new Map<string, string | undefined>();
  for (const id of [...order].reverse()) {
    let best = 0;
    let bestNext: string | undefined;
    for (const t of out.get(id)!) {
      const d = depth.get(t)!;
      if (d > best) {
        best = d;
        bestNext = t;
      }
    }
    depth.set(id, best + (byId.get(id)!.done ? 0 : 1));
    nextOnPath.set(id, bestNext);
  }
  let start: string | undefined;
  for (const id of order) if (start === undefined || depth.get(id)! > depth.get(start)!) start = id;
  const criticalPath: string[] = [];
  for (let cur = start; cur; cur = nextOnPath.get(cur)) {
    if (!byId.get(cur)!.done) criticalPath.push(cur);
  }
  return { cycles, order, criticalPath, depth };
}

export type Candidate = {
  id: string;
  epic: string | null;
  priority: number; // 0 none, 1 urgent, 2 high, 3 medium, 4 low (scripts/lib/board.ts priorityRank)
  estimate: number | null;
  labels: string[];
  blockersDone: boolean;
};

export type InFlight = { id: string; labels: string[] };

export type PickContext = {
  wipLimit: number;
  inFlight: InFlight[]; // cards in In Progress / In Review / QA
  /** per-card: is it on its epic's critical path, and how many cards it transitively unblocks */
  onCriticalPath: (id: string) => boolean;
  unblocksCount: (id: string) => number;
};

const prioRank = (p: number) => (p === 0 ? 5 : p); // "no priority" sorts after low

/** Compares card ids like #9 < #10 numerically (any prefix, e.g. ENG-9, compares as text first). */
export function compareIdentifiers(a: string, b: string): number {
  const [, pa = a, na = ""] = /^(.*?)(\d*)$/.exec(a) ?? [];
  const [, pb = b, nb = ""] = /^(.*?)(\d*)$/.exec(b) ?? [];
  if (pa !== pb) return pa.localeCompare(pb);
  return Number(na) - Number(nb);
}

/** PROTOCOL section 6 ordering. Returns candidates in pick order. */
export function orderCandidates(cands: Candidate[], ctx: PickContext): Candidate[] {
  return cands
    .filter((c) => c.blockersDone)
    .sort(
      (a, b) =>
        Number(ctx.onCriticalPath(b.id)) - Number(ctx.onCriticalPath(a.id)) ||
        ctx.unblocksCount(b.id) - ctx.unblocksCount(a.id) ||
        prioRank(a.priority) - prioRank(b.priority) ||
        (a.estimate ?? 99) - (b.estimate ?? 99) ||
        compareIdentifiers(a.id, b.id),
    );
}

/**
 * PROTOCOL section 7. Returns a reason string if the card may not start now, else null.
 * Cards parked on `needs-human` do not count against the WIP limit but keep their locks.
 * Every `touches:*` label is a hotspot lock (at most one in-flight card per label).
 */
export function lockViolation(
  card: { labels: string[] },
  inFlight: InFlight[],
  wipLimit: number,
): string | null {
  const active = inFlight.filter((c) => !c.labels.includes("needs-human"));
  if (active.length >= wipLimit) return `WIP limit ${wipLimit} reached`;
  for (const flag of card.labels.filter((l) => l.startsWith("touches:"))) {
    const holder = inFlight.find((c) => c.labels.includes(flag));
    if (holder) return `another ${flag} card is in flight (${holder.id})`;
  }
  const areas = card.labels.filter((l) => l.startsWith("area:"));
  for (const c of inFlight) {
    const shared = c.labels.filter((l) => areas.includes(l));
    if (shared.length) return `area overlap with ${c.id} (${shared.join(", ")})`;
  }
  return null;
}

/** Number of distinct cards reachable downstream (cards this one transitively unblocks). */
export function unblocksCount(nodes: CardNode[], id: string): number {
  const out = new Map<string, string[]>();
  for (const n of nodes) for (const b of n.blockedBy) out.set(b, [...(out.get(b) ?? []), n.id]);
  const seen = new Set<string>();
  const walk = (x: string) => {
    for (const t of out.get(x) ?? []) {
      if (seen.has(t)) continue;
      seen.add(t);
      walk(t);
    }
  };
  walk(id);
  return seen.size;
}
