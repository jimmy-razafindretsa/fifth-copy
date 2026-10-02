import { describe, expect, it } from "vitest";
import { governing, parseAdr, type Adr } from "./adr";

const doc = (fm: string) => `---\n${fm}\n---\n\n# body\n`;
const valid = [
  'id: "0007"',
  "title: Use X",
  "status: accepted",
  "category: data",
  'scope: ["src/server/**"]',
  "supersedes: []",
  "rule: Always X.",
].join("\n");

describe("parseAdr", () => {
  it("accepts a valid ADR", () => {
    const r = parseAdr("0007-use-x.md", doc(valid));
    expect(r.errors).toEqual([]);
    expect(r.adr?.id).toBe("0007");
  });

  it("requires a quoted id matching the filename", () => {
    expect(parseAdr("0007-use-x.md", doc(valid.replace('"0007"', "0007"))).errors.join()).toMatch(
      /quoted/,
    );
    expect(parseAdr("0008-use-x.md", doc(valid)).errors.join()).toMatch(/filename prefix/);
  });

  it("rejects unknown status and empty scope", () => {
    const r = parseAdr(
      "0007-use-x.md",
      doc(valid.replace("accepted", "maybe").replace('["src/server/**"]', "[]")),
    );
    expect(r.errors.length).toBe(2);
  });
});

describe("governing", () => {
  const mk = (
    id: string,
    status: Adr["status"],
    scope: string[],
    supersededBy: string[] = [],
  ): Adr => ({
    id,
    title: id,
    status,
    category: "x",
    scope,
    supersedes: [],
    supersededBy,
    rule: "r",
    file: "",
  });

  it("matches globs, sorts accepted first and warns on superseded", () => {
    const adrs = [
      mk("0002", "superseded", ["src/**"], ["0003"]),
      mk("0003", "accepted", ["src/server/**"]),
    ];
    const g = governing(adrs, "./src/server/db.ts");
    expect(g.map((x) => x.adr.id)).toEqual(["0003", "0002"]);
    expect(g[1]!.warning).toMatch(/SUPERSEDED by 0003/);
    expect(governing(adrs, "README.md")).toEqual([]);
  });

  it("matches a directory against a /** scope", () => {
    expect(governing([mk("0001", "accepted", ["prisma/**"])], "prisma")).toHaveLength(1);
  });
});
