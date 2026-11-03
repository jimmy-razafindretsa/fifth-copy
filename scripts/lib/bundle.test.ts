import { describe, expect, it } from "vitest";
import { contractHash, lockViolation } from "./kit";
import { evaluateGate, latestPickup, trustedAuthors, type Comment, type GateFacts } from "./flow";
import {
  MAX_BUNDLE,
  SOLO_LABELS,
  bundleLabel,
  bundleLocks,
  bundlePickupComment,
  bundleRefusals,
  bundledInComment,
  collapseBundles,
  evaluateBundleGate,
  parseBundleArg,
  prCards,
} from "./bundle";

const OWNER = "jimmy-razafindretsa";
const trusted = trustedAuthors(undefined, OWNER);
const at = (body: string, t: string, author: string | null = OWNER): Comment => ({
  body,
  createdAt: t,
  author,
});
const body = (crit = "C1 does x") =>
  `## Outcome\nX\n\n## Contract\n- [ ] ${crit} | verify: \`scripts/x.test.ts\`\n\n## Size rationale\nestimate 1\n`;
const ready = (n: number, labels: string[] = ["area:kit"]) => ({ n, status: "Ready", labels });

describe("parseBundleArg (C1)", () => {
  it("puts the lead first, dedupes and accepts #n or n", () => {
    expect(parseBundleArg(10, "11,'#12',10, 13")).toEqual([10, 11, 12, 13]);
  });
  it("rejects junk", () => {
    expect(() => parseBundleArg(10, "11,x")).toThrow(/not a card number/);
    expect(() => parseBundleArg(10, undefined)).toThrow(/--bundle/);
  });
});

describe("bundleRefusals (C1)", () => {
  it("accepts 2..8 Ready cards without solo labels", () => {
    expect(bundleRefusals([ready(10), ready(11), ready(12)])).toEqual([]);
    expect(bundleRefusals(Array.from({ length: MAX_BUNDLE }, (_, i) => ready(10 + i)))).toEqual(
      [],
    );
  });
  it("refuses more than 8 cards", () => {
    const nine = Array.from({ length: 9 }, (_, i) => ready(10 + i));
    expect(bundleRefusals(nine)).toEqual([`bundle has 9 cards, max ${MAX_BUNDLE}`]);
  });
  it("refuses a bundle of one card", () => {
    expect(bundleRefusals([ready(10)])).toEqual(["a bundle needs at least 2 cards"]);
  });
  it("refuses a card that is not Ready, naming it", () => {
    expect(bundleRefusals([ready(10), { n: 11, status: "Backlog", labels: [] }])).toEqual([
      "#11 is Backlog, not Ready",
    ]);
  });
  it.each(SOLO_LABELS)("refuses a card labeled %s (solo only)", (label) => {
    expect(bundleRefusals([ready(10), ready(11, ["area:kit", label])])).toEqual([
      `#11 carries ${label} (solo-only card)`,
    ]);
  });
  it("lists the solo-only labels of the card", () => {
    expect([...SOLO_LABELS].sort()).toEqual(
      ["area:auth", "area:race-server", "autonomy:hitl", "pentest", "touches:prisma"].sort(),
    );
  });
});

describe("bundle comments (C1)", () => {
  it("one PICKUP on the lead lists every bundled card and still parses as a PICKUP", () => {
    const c = bundlePickupComment(10, "aaaaaaaaaaaa", "10-x", [10, 11, 12]);
    expect(c).toBe(
      "PICKUP #10 contract_hash=aaaaaaaaaaaa branch=10-x worktree=.worktrees/10 bundle=#10,#11,#12",
    );
    expect(latestPickup(10, [at(c, "2026-11-03T10:00:00Z")], trusted)).toMatchObject({
      hash: "aaaaaaaaaaaa",
      branch: "10-x",
      bundle: [10, 11, 12],
      lead: null,
    });
  });
  it("BUNDLED-IN #lead on a member counts as that member's pickup (its own hash, the lead branch)", () => {
    const c = bundledInComment(10, 11, "bbbbbbbbbbbb", "10-x");
    expect(c).toBe(
      "BUNDLED-IN #10 card=#11 contract_hash=bbbbbbbbbbbb branch=10-x worktree=.worktrees/10",
    );
    expect(latestPickup(11, [at(c, "2026-11-03T10:00:00Z")], trusted)).toMatchObject({
      hash: "bbbbbbbbbbbb",
      branch: "10-x",
      lead: 10,
      bundle: [],
    });
    expect(latestPickup(12, [at(c, "2026-11-03T10:00:00Z")], trusted)).toBeNull();
  });
  it("ignores a forged BUNDLED-IN", () => {
    const c = at(bundledInComment(10, 11, "b", "10-x"), "2026-11-03T10:00:00Z", "stranger");
    expect(latestPickup(11, [c], trusted)).toBeNull();
  });
});

describe("bundle locks and WIP (C2)", () => {
  it("locks are the union of the cards' area:* and touches:* labels", () => {
    expect(
      bundleLocks([
        { labels: ["area:kit", "type:chore"] },
        { labels: ["area:guide", "touches:arch", "ui"] },
        { labels: ["area:kit", "touches:i18n"] },
      ]),
    ).toEqual(["area:guide", "area:kit", "touches:arch", "touches:i18n"]);
  });
  it("a bundle in flight counts as one WIP slot carrying the union of its labels", () => {
    const inFlight = [
      { id: "#10", labels: [bundleLabel(10), "area:kit"] },
      { id: "#11", labels: [bundleLabel(10), "touches:arch"] },
      { id: "#12", labels: [bundleLabel(10), "area:kit"] },
      { id: "#20", labels: ["area:lobby"] },
    ];
    const slots = collapseBundles(inFlight);
    expect(slots).toEqual([
      { id: "#10", labels: [bundleLabel(10), "area:kit", "touches:arch"] },
      { id: "#20", labels: ["area:lobby"] },
    ]);
    // WIP 3: two slots in flight, a third card may start; a touches:arch card is locked by the bundle.
    expect(lockViolation({ labels: ["area:stats"] }, slots, 3)).toBeNull();
    expect(lockViolation({ labels: ["touches:arch"] }, slots, 3)).toMatch(/touches:arch.*#10/);
    expect(lockViolation({ labels: ["area:stats"] }, slots, 2)).toMatch(/WIP limit 2/);
  });
});

describe("prCards (C4)", () => {
  it("reads every card of a `Card:` line, stopping at the next field", () => {
    expect(prCards("Card: #12   Epic: #3   Autonomy: afk\n## Changes")).toEqual([12]);
    expect(prCards("Card: #12 #13, #14   Epic: #3")).toEqual([12, 13, 14]);
  });
  it("reads several `Refs #n` lines", () => {
    expect(prCards("Refs #5\nRefs #6, #7\nsome text #99\n")).toEqual([5, 6, 7]);
  });
  it("ignores Closes/Fixes and prose mentions", () => {
    expect(prCards("Closes #4\nsee #8 and Card #9")).toEqual([]);
  });
});

describe("bundle gate (C3, C4)", () => {
  const lead = 10;
  const leadPickup = at(
    bundlePickupComment(lead, contractHash(body("C1 a"))!, "10-x", [10, 11, 12]),
    "2026-11-03T10:00:00Z",
  );
  const handoff = at("HANDOFF builder 2026-11-03\nstate: done", "2026-11-03T12:00:00Z");
  const member = (n: number, crit: string, hash = contractHash(body(crit))!): GateFacts => ({
    n,
    target: "In Review",
    body: body(crit),
    labels: [],
    // a member's own comments (BUNDLED-IN) plus the lead's (bundle HANDOFF, Deliver verdict)
    comments: [at(bundledInComment(lead, n, hash, "10-x"), "2026-11-03T10:00:01Z"), handoff],
    trusted,
    pr: { number: 7, state: "OPEN", cards: [10, 11, 12] },
    status: "In Progress",
    mainCi: null,
  });
  const leadFacts: GateFacts = { ...member(10, "C1 a"), comments: [leadPickup, handoff] };

  it("passes when every card passes its own checks", () => {
    expect(evaluateBundleGate([leadFacts, member(11, "C1 b"), member(12, "C1 c")])).toEqual([]);
  });
  it("one card with a changed contract blocks the whole bundle, named", () => {
    const bad = member(11, "C1 b", "cccccccccccc");
    const out = evaluateBundleGate([leadFacts, bad, member(12, "C1 c")]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^#11: contract hash .* != PICKUP cccccccccccc/);
  });
  it("a member without a HANDOFF after its BUNDLED-IN blocks the bundle", () => {
    const m = { ...member(12, "C1 c") };
    m.comments = m.comments.filter((c) => !c.body.startsWith("HANDOFF"));
    expect(evaluateBundleGate([leadFacts, member(11, "C1 b"), m])).toEqual([
      "#12: no builder/ui HANDOFF after PICKUP",
    ]);
  });
  it("a card missing from the PR's Card:/Refs references fails the PR check (C4)", () => {
    const pr = { number: 7, state: "OPEN" as const, cards: [10, 11] };
    const out = evaluateBundleGate([
      { ...leadFacts, pr },
      { ...member(11, "C1 b"), pr },
      { ...member(12, "C1 c"), pr },
    ]);
    expect(out).toEqual(["#12: PR #7 body does not reference #12 (Card: #a #b or Refs #n)"]);
  });
  it("solo cards keep the branch-based PR check (no body reference needed)", () => {
    const solo = latestPickup(
      10,
      [at("PICKUP #10 contract_hash=x branch=10-x worktree=.worktrees/10", "2026-11-03T10:00Z")],
      trusted,
    );
    expect(solo?.bundle).toEqual([]);
    const f: GateFacts = {
      ...leadFacts,
      comments: [
        at(
          `PICKUP #10 contract_hash=${contractHash(body("C1 a"))} branch=10-x worktree=.worktrees/10`,
          "2026-11-03T10:00:00Z",
        ),
        handoff,
      ],
      pr: { number: 7, state: "OPEN", cards: [] },
    };
    expect(evaluateGate(f)).toEqual([]);
  });
});
