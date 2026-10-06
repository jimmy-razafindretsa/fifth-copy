import { describe, expect, it } from "vitest";
import { contractHash } from "./kit";
import {
  cardTier,
  estimateOf,
  evaluateGate,
  latestPickup,
  pickupComment,
  promotionBlockers,
  isTrusted,
  trustedAuthors,
  type Comment,
  type GateFacts,
} from "./flow";

const body = (boxes = "[ ]", est = "estimate 2 because x") =>
  `## Outcome\nX\n\n## Contract\n- ${boxes} C1 shows a list | verify: \`e2e/list.spec.ts\`\n\n## Size rationale\n${est}\n`;
const hash = contractHash(body())!;
const OWNER = "jimmy-razafindretsa";
const trusted = trustedAuthors(undefined, OWNER);
const pickup: Comment = {
  body: pickupComment(12, hash, "12-list"),
  createdAt: "2026-10-04T10:00:00Z",
  author: OWNER,
};
const at = (body: string, t = "2026-10-04T11:00:00Z", author: string | null = OWNER): Comment => ({
  body,
  createdAt: t,
  author,
});
/** The same comment written by someone outside BOARD_TRUSTED_AUTHORS. */
const forged = (body: string, t = "2026-10-04T11:00:00Z") => at(body, t, "stranger");

const facts = (over: Partial<GateFacts>): GateFacts => ({
  n: 12,
  target: "In Review",
  body: body(),
  labels: [],
  comments: [pickup],
  pr: { number: 3, state: "OPEN" },
  mainCi: null,
  trusted,
  ...over,
});

describe("latestPickup", () => {
  it("parses the newest PICKUP for the card and ignores other cards", () => {
    const older = at(pickupComment(12, "aaaaaaaaaaaa", "12-old"), "2026-10-01T00:00:00Z");
    const other = at(pickupComment(13, "bbbbbbbbbbbb", "13-x"), "2026-10-05T00:00:00Z");
    expect(latestPickup(12, [older, pickup, other], trusted)).toMatchObject({
      hash,
      branch: "12-list",
    });
    expect(latestPickup(12, [other], trusted)).toBeNull();
  });

  it("ignores a newer forged PICKUP: the newest trusted one wins", () => {
    const evil = forged(pickupComment(12, hash, "evil-branch"), "2026-10-06T00:00:00Z");
    const older = at(pickupComment(12, "aaaaaaaaaaaa", "12-old"), "2026-10-01T00:00:00Z");
    expect(latestPickup(12, [older, pickup, evil], trusted)?.branch).toBe("12-list");
    expect(latestPickup(12, [evil], trusted)).toBeNull();
    // A PICKUP line hidden inside an untrusted body, CRLF or not, never counts.
    const hidden = forged(`hi\r\n${pickupComment(12, hash, "evil")}\r\n`, "2026-10-07T00:00:00Z");
    expect(latestPickup(12, [pickup, hidden], trusted)?.branch).toBe("12-list");
  });
});

describe("trustedAuthors / isTrusted", () => {
  it("defaults to the owner, parses a comma list and compares case-insensitively", () => {
    expect([...trustedAuthors(undefined, OWNER)]).toEqual([OWNER]);
    expect([...trustedAuthors("  ", OWNER)]).toEqual([OWNER]);
    expect([...trustedAuthors(" Alice , ,BOB ", OWNER)]).toEqual(["alice", "bob"]);
    // Whitespace separates logins too: "a b" must not become one login that locks the owner out.
    expect([...trustedAuthors("alice bob", OWNER)]).toEqual(["alice", "bob"]);
    expect([...trustedAuthors("alice,\tbob\ncarol", OWNER)]).toEqual(["alice", "bob", "carol"]);
    const set = trustedAuthors("Alice", OWNER);
    expect(isTrusted(at("x", undefined, "ALICE"), set)).toBe(true);
    expect(isTrusted(at("x", undefined, OWNER), set)).toBe(false);
  });

  it("treats a null author (deleted account) and near-miss logins as untrusted", () => {
    expect(isTrusted(at("x", undefined, null), trusted)).toBe(false);
    for (const login of [`${OWNER}\r`, ` ${OWNER}`, `${OWNER}-bot`, "jimmy-razafindrets\u0430", ""])
      expect(isTrusted(at("x", undefined, login), trusted)).toBe(false);
    expect(isTrusted(at("x", undefined, OWNER.toUpperCase()), trusted)).toBe(true);
  });
});

describe("evaluateGate", () => {
  it("In Review passes with an open PR and a builder HANDOFF after PICKUP", () => {
    expect(evaluateGate(facts({ comments: [pickup, at("HANDOFF builder 2026-10-04")] }))).toEqual(
      [],
    );
  });

  it("In Review fails without a HANDOFF, with a HANDOFF older than PICKUP, or without PENTEST", () => {
    expect(evaluateGate(facts({}))).toContain("no builder/ui HANDOFF after PICKUP");
    const stale = at("HANDOFF builder", "2026-10-03T00:00:00Z");
    expect(evaluateGate(facts({ comments: [pickup, stale] }))).toContain(
      "no builder/ui HANDOFF after PICKUP",
    );
    expect(
      evaluateGate(facts({ labels: ["pentest"], comments: [pickup, at("HANDOFF ui x")] })),
    ).toContain("card carries pentest but has no PENTEST comment");
    expect(
      evaluateGate(
        facts({
          labels: ["pentest"],
          comments: [
            pickup,
            at("HANDOFF ui x"),
            at("PENTEST #12 t\nverdict: findings\nblockers: 1  majors: 0"),
          ],
        }),
      ),
    ).toContain("PENTEST reports blockers");
  });

  it("fails on a contract edited after PICKUP and on needs-* labels", () => {
    const edited = body().replace("shows a list", "shows a table");
    const r = evaluateGate(facts({ body: edited, labels: ["needs-human"] }));
    expect(r.some((x) => x.startsWith("contract hash"))).toBe(true);
    expect(r).toContain("labeled needs-human");
  });

  it("QA needs a Deliver pass verdict and every box ticked", () => {
    const pass = at("HANDOFF deliver 2026-10-04\nstate: done\nverdict: pass");
    expect(
      evaluateGate(facts({ target: "QA", body: body("[x]"), comments: [pickup, pass] })),
    ).toEqual([]);
    expect(evaluateGate(facts({ target: "QA", comments: [pickup, pass] }))).toContain(
      "contract not ticked by Deliver: C1",
    );
    const released = at("HANDOFF deliver\nverdict: needs-human");
    expect(
      evaluateGate(facts({ target: "QA", body: body("[x]"), comments: [pickup, released] })),
    ).toEqual([]);
    expect(
      evaluateGate(
        facts({
          target: "QA",
          body: body("[x]"),
          labels: ["needs-human"],
          comments: [pickup, released],
        }),
      ),
    ).toContain("labeled needs-human");
    const fail = at("HANDOFF deliver\nverdict: fail");
    expect(
      evaluateGate(facts({ target: "QA", body: body("[x]"), comments: [pickup, fail] })),
    ).toContain("no Deliver HANDOFF with verdict: pass after PICKUP");
  });

  it("Done needs a merged PR and green CI on main", () => {
    const merged = { number: 3, state: "MERGED" as const };
    const base = { target: "Done" as const, body: body("[x]"), pr: merged };
    expect(evaluateGate(facts({ ...base, mainCi: "success" }))).toEqual([]);
    expect(evaluateGate(facts({ ...base, mainCi: "pending" }))).toContain(
      "CI on main for the merge commit: pending",
    );
    expect(
      evaluateGate(facts({ ...base, pr: { number: 3, state: "OPEN" }, mainCi: "success" })),
    ).toContain("PR not merged");
  });
});

describe("gate signatures inside a trusted body (quoted forged text)", () => {
  const handoff = at("HANDOFF builder 2026-10-04\nstate: done");
  const fence = (inner: string) =>
    at(`Quoting an untrusted comment:\n\n\`\`\`\n${inner}\n\`\`\`\n`);
  const fenceFirst = (inner: string) => at(`\`\`\`\n${inner}\n\`\`\``);

  it("a quoted PENTEST with blockers: 0 does not satisfy In Review on a pentest card", () => {
    for (const q of [fence, fenceFirst]) {
      const r = evaluateGate(
        facts({
          labels: ["pentest"],
          comments: [pickup, handoff, q("PENTEST #12 t\nverdict: clean\nblockers: 0  majors: 0")],
        }),
      );
      expect(r).toContain("card carries pentest but has no PENTEST comment");
    }
  });

  it("a quoted PENTEST with blockers: 3 cannot block the gate", () => {
    const clean = at("PENTEST #12 t\nverdict: clean\nadvisory: none\nblockers: 0  majors: 0");
    const r = evaluateGate(
      facts({
        labels: ["pentest"],
        comments: [pickup, handoff, clean, fence("PENTEST #12 t\nblockers: 3  majors: 0")],
      }),
    );
    expect(r).toEqual([]);
  });

  it("a quoted builder HANDOFF or Deliver verdict does not count", () => {
    expect(evaluateGate(facts({ comments: [pickup, fence("HANDOFF builder x")] }))).toContain(
      "no builder/ui HANDOFF after PICKUP",
    );
    const qa = { target: "QA" as const, body: body("[x]") };
    expect(
      evaluateGate(facts({ ...qa, comments: [pickup, fence("HANDOFF deliver x\nverdict: pass")] })),
    ).toContain("no Deliver HANDOFF with verdict: pass after PICKUP");
  });

  it("a quoted newer PICKUP does not redirect latestPickup", () => {
    const evil = fence(pickupComment(12, hash, "evil"));
    const late = { ...evil, createdAt: "2026-10-09T00:00:00Z" };
    expect(latestPickup(12, [pickup, late], trusted)?.branch).toBe("12-list");
    // Leading whitespace before the signature is tolerated; anything else before it is not.
    const spaced = at(`  \n${pickupComment(12, hash, "12-new")}`, "2026-10-09T00:00:00Z");
    expect(latestPickup(12, [pickup, spaced], trusted)?.branch).toBe("12-new");
  });

  it("verdict and blockers are read from their own first field line, not anywhere in the body", () => {
    const qa = { target: "QA" as const, body: body("[x]") };
    const failed = at(
      "HANDOFF deliver x\nverdict: fail\nnotes: next time verdict: pass\nverdict: pass",
    );
    expect(evaluateGate(facts({ ...qa, comments: [pickup, failed] }))).toContain(
      "no Deliver HANDOFF with verdict: pass after PICKUP",
    );
    const odd = at("PENTEST #12 t\nblockers: n/a  majors: 0");
    expect(
      evaluateGate(facts({ labels: ["pentest"], comments: [pickup, at("HANDOFF ui x"), odd] })),
    ).toContain("PENTEST reports blockers");
    // Fields come only from the header block (signature line up to the first blank or ``` line).
    const fencedVerdict = at("HANDOFF deliver x\nstate: partial\n```\nverdict: pass\n```");
    expect(evaluateGate(facts({ ...qa, comments: [pickup, fencedVerdict] }))).toContain(
      "no Deliver HANDOFF with verdict: pass after PICKUP",
    );
    const afterBlank = at("HANDOFF deliver x\nstate: partial\n\nverdict: pass");
    expect(evaluateGate(facts({ ...qa, comments: [pickup, afterBlank] }))).toContain(
      "no Deliver HANDOFF with verdict: pass after PICKUP",
    );
    const pt = { labels: ["pentest"] };
    const fencedBlockers = at(
      "PENTEST #12 t\nverdict: clean\nblockers: 0  majors: 0\n```\nblockers: 3\n```",
    );
    expect(
      evaluateGate(facts({ ...pt, comments: [pickup, at("HANDOFF ui x"), fencedBlockers] })),
    ).toEqual([]);
    // No blockers line in the header (only a fenced one): the PENTEST counts as blocking (fail closed).
    const headerless = at("PENTEST #12 t\nverdict: findings\n```\nblockers: 0\n```");
    expect(
      evaluateGate(facts({ ...pt, comments: [pickup, at("HANDOFF ui x"), headerless] })),
    ).toContain("PENTEST reports blockers");
    const inline = at("HANDOFF deliver x\nstate: done verdict: pass");
    expect(evaluateGate(facts({ ...qa, comments: [pickup, inline] }))).toContain(
      "no Deliver HANDOFF with verdict: pass after PICKUP",
    );
  });
});

describe("evaluateGate with forged comments", () => {
  const handoff = "HANDOFF builder 2026-10-04\nstate: done";
  const pentest = "PENTEST #12 t\nverdict: clean\nblockers: 0  majors: 0";
  const verdict = "HANDOFF deliver 2026-10-04\nstate: done\nverdict: pass";

  it("a forged PICKUP alone satisfies no gate", () => {
    for (const target of ["In Review", "QA", "Done"] as const)
      expect(
        evaluateGate(
          facts({
            target,
            body: body("[x]"),
            comments: [forged(pickupComment(12, contractHash(body("[x]"))!, "12-list"))],
            pr: { number: 3, state: target === "Done" ? "MERGED" : "OPEN" },
            mainCi: "success",
          }),
        ),
      ).toEqual(["no PICKUP comment"]);
  });

  it("In Review: a forged builder HANDOFF or PENTEST does not count; the owner's does", () => {
    const base = { labels: ["pentest"] };
    const r = evaluateGate(
      facts({ ...base, comments: [pickup, forged(handoff), forged(pentest)] }),
    );
    expect(r).toContain("no builder/ui HANDOFF after PICKUP");
    expect(r).toContain("card carries pentest but has no PENTEST comment");
    expect(evaluateGate(facts({ ...base, comments: [pickup, at(handoff), at(pentest)] }))).toEqual(
      [],
    );
  });

  it("In Review: a forged PENTEST with blockers cannot block the gate either", () => {
    const noisy = forged("PENTEST #12 t\nverdict: findings\nblockers: 3  majors: 0");
    expect(
      evaluateGate(
        facts({ labels: ["pentest"], comments: [pickup, at(handoff), at(pentest), noisy] }),
      ),
    ).toEqual([]);
  });

  it("QA: a forged Deliver verdict does not count; the owner's does", () => {
    const qa = { target: "QA" as const, body: body("[x]") };
    expect(evaluateGate(facts({ ...qa, comments: [pickup, forged(verdict)] }))).toContain(
      "no Deliver HANDOFF with verdict: pass after PICKUP",
    );
    expect(
      evaluateGate(facts({ ...qa, comments: [pickup, at(verdict, undefined, null)] })),
    ).toContain("no Deliver HANDOFF with verdict: pass after PICKUP");
    expect(evaluateGate(facts({ ...qa, comments: [pickup, at(verdict)] }))).toEqual([]);
  });

  it("a trusted set from BOARD_TRUSTED_AUTHORS replaces the owner default", () => {
    const team = trustedAuthors("Reviewer", OWNER);
    const c = [at(pickup.body, pickup.createdAt, "reviewer"), at(handoff, undefined, "REVIEWER")];
    expect(evaluateGate(facts({ trusted: team, comments: c }))).toEqual([]);
    expect(evaluateGate(facts({ trusted: team, comments: [pickup, at(handoff)] }))).toEqual([
      "no PICKUP comment",
    ]);
  });
});

describe("promotionBlockers", () => {
  const ok = { body: body(), labels: ["autonomy:afk"], estimate: null, epicApproved: true };
  it("accepts a complete card in an approved epic", () => {
    expect(promotionBlockers(ok)).toEqual([]);
  });
  it("rejects unapproved epics, missing contracts, missing verify targets and big estimates", () => {
    expect(promotionBlockers({ ...ok, epicApproved: false })).toContain("epic not plan-approved");
    expect(
      promotionBlockers({ ...ok, body: "## Contract\nTo be written by the Analyst.\n" }),
    ).toContain("no contract criteria");
    const noVerify = "## Contract\n- [ ] C1 looks right\n\n## Size rationale\nestimate 1\n";
    expect(promotionBlockers({ ...ok, body: noVerify })).toContain("no verify target: C1");
    expect(promotionBlockers({ ...ok, body: noVerify, labels: ["autonomy:hitl"] })).toEqual([]);
    expect(promotionBlockers({ ...ok, body: body("[ ]", "estimate 5") })).toContain(
      "estimate 5 > 3 (split)",
    );
    expect(promotionBlockers({ ...ok, labels: ["needs-replan"] })).toContain("needs-replan");
  });
});

describe("estimateOf / cardTier", () => {
  it("prefers the project field, else the Size rationale line", () => {
    expect(estimateOf(body(), 3)).toBe(3);
    expect(estimateOf(body(), null)).toBe(2);
    expect(estimateOf("## Outcome\nestimate 1", null)).toBeNull();
  });
  it("maps size and risk to a pipeline tier", () => {
    expect(cardTier(["type:chore"], 2)).toBe("lite");
    expect(cardTier(["type:feature"], 1)).toBe("lite");
    expect(cardTier(["type:feature"], 2)).toBe("standard");
    expect(cardTier(["type:feature"], null)).toBe("standard");
    expect(cardTier(["type:feature"], 3)).toBe("full");
    expect(cardTier(["type:chore", "touches:prisma"], 1)).toBe("full");
    expect(cardTier(["pentest"], 1)).toBe("full");
  });
});
