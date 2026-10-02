import { describe, expect, it } from "vitest";
import {
  contractHash,
  dagCheck,
  lockViolation,
  orderCandidates,
  parseContract,
  unblocksCount,
  type Candidate,
} from "./kit";

const card = (contract: string) =>
  `## Outcome\nX\n\n## Contract\n${contract}\n\n## Out of scope\nnone\n`;

describe("contractHash", () => {
  const base = card("- [ ] C1 shows a list | verify: `e2e/list.spec.ts`");

  it("ignores checkbox state", () => {
    expect(contractHash(base)).toBe(
      contractHash(card("- [x] C1 shows a list | verify: `e2e/list.spec.ts`")),
    );
  });

  it("changes when wording changes", () => {
    expect(contractHash(base)).not.toBe(
      contractHash(card("- [ ] C1 shows a table | verify: `e2e/list.spec.ts`")),
    );
  });

  it("ignores edits outside the Contract section", () => {
    expect(contractHash(base)).toBe(contractHash(base.replace("Outcome\nX", "Outcome\nY")));
  });

  it("returns null without a Contract section", () => {
    expect(contractHash("## Outcome\nX")).toBeNull();
  });
});

describe("parseContract", () => {
  it("extracts ids, verify targets and checked state", () => {
    const c = parseContract(card("- [x] C1 a | verify: `npm test`\n- [ ] C2 b"));
    expect(c).toEqual([
      { id: "C1", text: "a", verify: "`npm test`", checked: true },
      { id: "C2", text: "b", verify: null, checked: false },
    ]);
  });
});

describe("dagCheck", () => {
  it("finds cycles", () => {
    const r = dagCheck([
      { id: "A", done: false, blockedBy: ["C"] },
      { id: "B", done: false, blockedBy: ["A"] },
      { id: "C", done: false, blockedBy: ["B"] },
    ]);
    expect(r.cycles.length).toBeGreaterThan(0);
  });

  it("orders blockers first and finds the critical path", () => {
    const nodes = [
      { id: "A", done: false, blockedBy: [] },
      { id: "B", done: false, blockedBy: ["A"] },
      { id: "C", done: false, blockedBy: ["B"] },
      { id: "D", done: false, blockedBy: ["A"] },
    ];
    const r = dagCheck(nodes);
    expect(r.cycles).toEqual([]);
    expect(r.order.indexOf("A")).toBeLessThan(r.order.indexOf("B"));
    expect(r.criticalPath).toEqual(["A", "B", "C"]);
    expect(unblocksCount(nodes, "A")).toBe(3);
  });

  it("does not count done cards on the critical path", () => {
    const r = dagCheck([
      { id: "A", done: true, blockedBy: [] },
      { id: "B", done: false, blockedBy: ["A"] },
    ]);
    expect(r.criticalPath).toEqual(["B"]);
  });
});

describe("orderCandidates", () => {
  const mk = (id: string, over: Partial<Candidate> = {}): Candidate => ({
    id,
    epic: "E",
    priority: 3,
    estimate: 2,
    labels: [],
    blockersDone: true,
    ...over,
  });
  const ctx = (crit: string[] = [], unblocks: Record<string, number> = {}) => ({
    wipLimit: 1,
    inFlight: [],
    onCriticalPath: (id: string) => crit.includes(id),
    unblocksCount: (id: string) => unblocks[id] ?? 0,
  });

  it("applies the tie-break chain in order", () => {
    const ids = (cs: Candidate[]) => cs.map((c) => c.id);
    expect(ids(orderCandidates([mk("#2"), mk("#1")], ctx()))).toEqual(["#1", "#2"]);
    expect(ids(orderCandidates([mk("#10"), mk("#9")], ctx()))).toEqual(["#9", "#10"]);
    expect(ids(orderCandidates([mk("#1"), mk("#2", { estimate: 1 })], ctx()))).toEqual([
      "#2",
      "#1",
    ]);
    expect(ids(orderCandidates([mk("#1"), mk("#2", { priority: 1 })], ctx()))).toEqual([
      "#2",
      "#1",
    ]);
    expect(ids(orderCandidates([mk("#1"), mk("#2")], ctx([], { "#2": 4 })))).toEqual(["#2", "#1"]);
    expect(ids(orderCandidates([mk("#1"), mk("#2")], ctx(["#2"])))).toEqual(["#2", "#1"]);
  });

  it("drops cards with open blockers", () => {
    expect(orderCandidates([mk("#1", { blockersDone: false })], ctx())).toEqual([]);
  });
});

describe("lockViolation", () => {
  it("enforces WIP, prisma/deps and area locks", () => {
    expect(lockViolation({ labels: [] }, [{ id: "X", labels: [] }], 1)).toMatch(/WIP/);
    expect(
      lockViolation({ labels: ["touches:prisma"] }, [{ id: "X", labels: ["touches:prisma"] }], 3),
    ).toMatch(/touches:prisma/);
    expect(
      lockViolation({ labels: ["area:auth"] }, [{ id: "X", labels: ["area:auth"] }], 3),
    ).toMatch(/area overlap/);
    expect(lockViolation({ labels: ["area:a"] }, [{ id: "X", labels: ["area:b"] }], 3)).toBeNull();
  });
});
