/**
 * Bundle mode (agents/PROTOCOL.md section 15, owner decision 2026-11-03): one branch and one PR deliver
 * 2-8 small sibling cards. Pure logic only; scripts/board.ts gathers the facts.
 * - pickup: one PICKUP on the lead (`bundle=#a,#b`), a `BUNDLED-IN #lead` on every other card (flow.ts latestPickup)
 * - locks: the union of the cards' area:* and touches:* labels; WIP counts a bundle as one slot
 * - gates: each card's checks run on its own; one failing card blocks the whole bundle
 * Unit-tested in bundle.test.ts.
 */
import { parseCardRef } from "./board";
import { evaluateGate, pickupComment, type GateFacts } from "./flow";
import type { InFlight } from "./kit";

export const MAX_BUNDLE = 8;
/** Big or risky cards stay solo: Prisma, auth, race server, security, human-in-the-loop. */
export const SOLO_LABELS = [
  "touches:prisma",
  "area:auth",
  "area:race-server",
  "pentest",
  "autonomy:hitl",
] as const;

/** Label every card of an in-flight bundle carries, so the board index sees the bundle without comments. */
export const bundleLabel = (lead: number) => `bundle:${lead}`;
const BUNDLE_LABEL = /^bundle:\d+$/;

/** `--bundle 11,'#12'` -> [lead, 11, 12]: lead first, unique. */
export function parseBundleArg(lead: number, arg: string | undefined): number[] {
  if (!arg?.trim()) throw new Error("usage: pickup <lead> --bundle <n,n,...>");
  const out = [lead];
  for (const raw of arg.split(",")) {
    const ref = raw.trim().replace(/^'|'$/g, "");
    if (!ref) continue;
    const n = parseCardRef(ref);
    if (n === null) throw new Error(`not a card number in --bundle: ${raw.trim()}`);
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

export type BundleCard = { n: number; status: string | null; labels: string[] };

/** Why these cards may not be picked up as one bundle (C1). Empty = accepted. */
export function bundleRefusals(cards: BundleCard[]): string[] {
  const out: string[] = [];
  if (cards.length > MAX_BUNDLE) out.push(`bundle has ${cards.length} cards, max ${MAX_BUNDLE}`);
  if (cards.length < 2) out.push("a bundle needs at least 2 cards");
  for (const c of cards) {
    if (c.status !== "Ready") out.push(`#${c.n} is ${c.status ?? "unset"}, not Ready`);
    for (const l of SOLO_LABELS)
      if (c.labels.includes(l)) out.push(`#${c.n} carries ${l} (solo-only card)`);
  }
  return out;
}

/** The lock labels of a bundle (C2): union of its cards' area:* and touches:* labels, sorted. */
export const bundleLocks = (cards: { labels: string[] }[]) =>
  [
    ...new Set(
      cards.flatMap((c) => c.labels.filter((l) => l.startsWith("area:") || l.startsWith("touches:"))),
    ),
  ].sort();

/**
 * In-flight slots for the WIP and lock check (C2): the cards of one bundle (same `bundle:<lead>` label)
 * collapse into one slot, id = the lead, labels = the union of theirs (a needs-human on any card parks it).
 */
export function collapseBundles(inFlight: InFlight[]): InFlight[] {
  const out: InFlight[] = [];
  const byBundle = new Map<string, InFlight>();
  for (const c of inFlight) {
    const tag = c.labels.find((l) => BUNDLE_LABEL.test(l));
    if (!tag) {
      out.push(c);
      continue;
    }
    const slot = byBundle.get(tag);
    if (!slot) {
      const s = { id: `#${tag.slice("bundle:".length)}`, labels: [...c.labels] };
      byBundle.set(tag, s);
      out.push(s);
    } else for (const l of c.labels) if (!slot.labels.includes(l)) slot.labels.push(l);
  }
  return out;
}

/** The lead's PICKUP: the solo format plus `bundle=#lead,#a,#b` (still parsed by latestPickup). */
export const bundlePickupComment = (lead: number, hash: string, branch: string, cards: number[]) =>
  `${pickupComment(lead, hash, branch)} bundle=${cards.map((c) => `#${c}`).join(",")}`;

/** A member's pickup record: its own contract hash, the lead's branch and worktree. */
export const bundledInComment = (lead: number, n: number, hash: string, branch: string) =>
  `BUNDLED-IN #${lead} card=#${n} contract_hash=${hash} branch=${branch} worktree=.worktrees/${lead}`;

/**
 * Cards a PR body references (C4): every `#n` of a `Card:` line up to the next field (`Epic: #3` is not a
 * card), and every `#n` of `Refs` lines. Prose mentions and Closes/Fixes do not count.
 */
export function prCards(body: string): number[] {
  const out: number[] = [];
  const add = (s: string) => {
    for (const m of s.matchAll(/#(\d+)/g)) if (!out.includes(Number(m[1]))) out.push(Number(m[1]));
  };
  for (const line of body.split(/\r?\n/)) {
    const card = /^\s*Card:\s*((?:#\d+[\s,]*)+)/.exec(line);
    if (card) add(card[1]!);
    const refs = /^\s*Refs\s+((?:#\d+[\s,]*)+)/.exec(line);
    if (refs) add(refs[1]!);
  }
  return out;
}

/** C3: every card's own gate checks; failures are prefixed with the card that fails. Empty = all pass. */
export const evaluateBundleGate = (cards: GateFacts[]) =>
  cards.flatMap((f) => evaluateGate(f).map((why) => `#${f.n}: ${why}`));
