import { describe, expect, it } from "vitest";
import { contractHash } from "./kit";
import {
  cardTier,
  estimateOf,
  evaluateGate,
  latestPickup,
  pickupComment,
  promotionBlockers,
  type GateFacts,
} from "./flow";

const body = (boxes = "[ ]", est = "estimate 2 because x") =>
  `## Outcome\nX\n\n## Contract\n- ${boxes} C1 shows a list | verify: \`e2e/list.spec.ts\`\n\n## Size rationale\n${est}\n`;
const hash = contractHash(body())!;
const pickup = { body: pickupComment(12, hash, "12-list"), createdAt: "2026-10-04T10:00:00Z" };
const at = (body: string, t = "2026-10-04T11:00:00Z") => ({ body, createdAt: t });

const facts = (over: Partial<GateFacts>): GateFacts => ({
  n: 12,
  target: "In Review",
  body: body(),
  labels: [],
  comments: [pickup],
  pr: { number: 3, state: "OPEN" },
  mainCi: null,
  ...over,
});

describe("latestPickup", () => {
  it("parses the newest PICKUP for the card and ignores other cards", () => {
    const older = {
      body: pickupComment(12, "aaaaaaaaaaaa", "12-old"),
      createdAt: "2026-10-01T00:00:00Z",
    };
    const other = {
      body: pickupComment(13, "bbbbbbbbbbbb", "13-x"),
      createdAt: "2026-10-05T00:00:00Z",
    };
    expect(latestPickup(12, [older, pickup, other])).toMatchObject({ hash, branch: "12-list" });
    expect(latestPickup(12, [other])).toBeNull();
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
