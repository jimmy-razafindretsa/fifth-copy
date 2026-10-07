/**
 * Pure logic for the parallel card flow (no network): PICKUP parsing, gate evaluation (trusted comments only),
 * Backlog -> Ready promotion checks and pipeline tiers. See agents/PROTOCOL.md sections 5, 7 and 13.
 * Unit-tested in flow.test.ts; scripts/board.ts gathers the facts and applies the verdicts.
 */
import { contractHash, parseContract } from "./kit";
import { NEEDS_LABELS } from "./board";
import { trustedOnly, type Comment } from "./trust";

export { isTrusted, trustedAuthors, trustedOnly, type Comment } from "./trust";
export type Pickup = { hash: string; branch: string; worktree: string; at: string };

export const pickupComment = (n: number, hash: string, branch: string) =>
  `PICKUP #${n} contract_hash=${hash} branch=${branch} worktree=.worktrees/${n}`;

/**
 * Gate signatures (PICKUP, HANDOFF, PENTEST) count only at the very start of a comment body (after leading
 * whitespace): a trusted comment that quotes a forged line further down, even at column 0 inside a code fence,
 * does not carry that line's meaning. Fields (`verdict:`, `blockers:`) are read only from the header block
 * (signature line up to the first blank line or ``` fence), from the first line that starts with the field name.
 */
const head = (body: string) => body.trimStart();
const startsWith = (body: string, sig: RegExp) => sig.test(head(body));
/** Header block: the signature line up to the first blank line or code fence (quoted text never counts). */
function headerOf(body: string): string[] {
  const out: string[] = [];
  for (const line of head(body).split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("```")) break;
    out.push(line);
  }
  return out;
}
function fieldOf(body: string, name: string): string | null {
  const re = new RegExp(`^${name}:[ \\t]*(\\S+)`);
  for (const line of headerOf(body)) {
    const m = re.exec(line);
    if (m) return m[1]!;
  }
  return null;
}

/** A PENTEST blocks unless its header has `blockers: 0` (missing or unparsable blocks: fail closed). */
const blocking = (body: string) => !/^0+$/.test(fieldOf(body, "blockers") ?? "");

/** The newest PICKUP comment for card n written by a trusted author (trust.ts), or null. */
export function latestPickup(
  n: number,
  comments: readonly Comment[],
  trusted: ReadonlySet<string>,
): Pickup | null {
  const re = new RegExp(`^PICKUP #${n} contract_hash=(\\w+) branch=(\\S+) worktree=(\\S+)`);
  let best: Pickup | null = null;
  for (const c of trustedOnly(comments, trusted)) {
    const m = re.exec(head(c.body));
    if (m && (!best || c.createdAt > best.at))
      best = { hash: m[1]!, branch: m[2]!, worktree: m[3]!, at: c.createdAt };
  }
  return best;
}

/** Some comment at or after `since` whose body starts with `sig` and satisfies `ok`. */
const after = (
  comments: readonly Comment[],
  since: string,
  sig: RegExp,
  ok: (body: string) => boolean = () => true,
) => comments.some((c) => c.createdAt >= since && startsWith(c.body, sig) && ok(c.body));

export const GATE_TARGETS = ["In Review", "QA", "Done"] as const;
export type GateTarget = (typeof GATE_TARGETS)[number];

export type GateFacts = {
  n: number;
  target: GateTarget;
  body: string;
  labels: string[];
  comments: Comment[];
  /** Logins whose comments count (trust.ts); every other comment is ignored by every gate. */
  trusted: ReadonlySet<string>;
  pr: { number: number; state: "OPEN" | "MERGED" | "CLOSED" } | null;
  /** Conclusion of the CI run on main for the PR's merge commit (Done gate only). */
  mainCi: "success" | "failure" | "pending" | "missing" | null;
};

/**
 * PROTOCOL section 5 preconditions that a script can check. Returns the failures (empty = pass).
 * `scripts/check.sh` green is checked by the caller (loop.sh runs it in the worktree before the In Review gate).
 */
export function evaluateGate(facts: GateFacts): string[] {
  // Filter once: PICKUP, HANDOFF, PENTEST and Deliver verdicts count only from trusted authors.
  const f = { ...facts, comments: trustedOnly(facts.comments, facts.trusted) };
  const out: string[] = [];
  const pickup = latestPickup(f.n, f.comments, f.trusted);
  if (!pickup) return ["no PICKUP comment"];
  const hash = contractHash(f.body);
  if (hash !== pickup.hash)
    out.push(`contract hash ${hash ?? "none"} != PICKUP ${pickup.hash} (label needs-replan)`);
  const needs = f.labels.filter((l) => NEEDS_LABELS.includes(l));
  if (needs.length) out.push(`labeled ${needs.join(",")}`);
  const criteria = parseContract(f.body);
  const unticked = criteria.filter((c) => !c.checked).map((c) => c.id);

  if (f.target === "In Review") {
    if (!f.pr || f.pr.state === "CLOSED") out.push("no open PR for the card branch");
    if (!after(f.comments, pickup.at, /^HANDOFF (builder|ui)\b/))
      out.push("no builder/ui HANDOFF after PICKUP");
    if (f.labels.includes("pentest") && !after(f.comments, pickup.at, /^PENTEST #\d+/))
      out.push("card carries pentest but has no PENTEST comment");
    if (f.labels.includes("pentest") && after(f.comments, pickup.at, /^PENTEST #\d+/, blocking))
      out.push("PENTEST reports blockers");
  }
  if (f.target === "QA") {
    if (f.pr?.state !== "OPEN") out.push("PR is not open");
    // A needs-human verdict counts once the human removed the needs-human label (checked above).
    const passed = (b: string) => ["pass", "needs-human"].includes(fieldOf(b, "verdict") ?? "");
    if (!after(f.comments, pickup.at, /^HANDOFF deliver\b/, passed))
      out.push("no Deliver HANDOFF with verdict: pass after PICKUP");
    if (unticked.length) out.push(`contract not ticked by Deliver: ${unticked.join(",")}`);
  }
  if (f.target === "Done") {
    if (f.pr?.state !== "MERGED") out.push("PR not merged");
    if (unticked.length) out.push(`contract not ticked: ${unticked.join(",")}`);
    if (f.mainCi !== "success")
      out.push(`CI on main for the merge commit: ${f.mainCi ?? "unknown"}`);
  }
  return out;
}

/** Estimate from the Project field, else from "## Size rationale ... estimate N" in the body. */
export function estimateOf(body: string, field: number | null): number | null {
  if (field !== null) return field;
  const m = /^##\s*Size rationale\s*$[\s\S]*?\bestimate\s+(\d+)/im.exec(body);
  return m ? Number(m[1]) : null;
}

/** Why a Backlog card may not move to Ready (PROTOCOL section 5). Empty = promotable. */
export function promotionBlockers(c: {
  body: string;
  labels: string[];
  estimate: number | null;
  epicApproved: boolean;
}): string[] {
  const out: string[] = [];
  if (!c.epicApproved) out.push("epic not plan-approved");
  const needs = c.labels.filter((l) => NEEDS_LABELS.includes(l));
  if (needs.length) out.push(needs.join(","));
  if (c.labels.includes("epic")) out.push("is an epic");
  const criteria = parseContract(c.body);
  if (!criteria.length) out.push("no contract criteria");
  const hitl = c.labels.includes("autonomy:hitl");
  const noVerify = criteria.filter((x) => !x.verify).map((x) => x.id);
  if (noVerify.length && !hitl) out.push(`no verify target: ${noVerify.join(",")}`);
  const est = estimateOf(c.body, c.estimate);
  if (est === null) out.push("no estimate");
  else if (est > 3) out.push(`estimate ${est} > 3 (split)`);
  return out;
}

/** Labels that lock a shared hotspot: at most one in-flight card per label (PROTOCOL section 7). */
export const isLockLabel = (l: string) => l.startsWith("touches:");

export type Tier = "lite" | "standard" | "full";

/**
 * Pipeline depth per card (PROTOCOL section 13):
 * lite = no Explorer (estimate 1 or chore); standard = Explorer on the build model;
 * full = Explorer on the analysis model (estimate 3, hotspot locks, pentest, ADR or spike cards).
 */
export function cardTier(labels: string[], estimate: number | null): Tier {
  if (
    (estimate ?? 2) >= 3 ||
    labels.some(isLockLabel) ||
    labels.some((l) => ["pentest", "type:adr", "type:spike"].includes(l))
  )
    return "full";
  if (estimate === 1 || labels.includes("type:chore")) return "lite";
  return "standard";
}
