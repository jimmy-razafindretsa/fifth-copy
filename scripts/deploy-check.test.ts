import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createGit,
  expectedCommit,
  run,
  verdict,
  type Git,
  type ServiceRecord,
} from "./deploy-check";

// Card #718 C3: the one rule. A service is current when its deployed commit lies between the newest
// main commit touching its Railway watch paths (expected) and HEAD, both inclusive, by ancestry; and
// every service's protocol equals PROTOCOL_VERSION at HEAD.

/** In-memory history: each commit names its parent; `protocol` is PROTOCOL_VERSION in that commit. */
function fakeGit(parents: Record<string, string | null>, protocol: Record<string, number>): Git {
  return {
    isAncestor(ancestor, descendant) {
      for (let c: string | null = descendant; c; c = parents[c] ?? null)
        if (c === ancestor) return true;
      return false;
    },
    protocolAt: (sha) => protocol[sha]!,
  };
}

// main: a1 (web + race change, protocol 6) -> a2 (web + protocol 7 + race) -> a3 (docs only).
const [a1, a2, a3] = ["aaaaaa1", "aaaaaa2", "aaaaaa3"];
const history = { [a1]: null, [a2]: a1, [a3]: a2 };
const protocols = { [a1]: 6, [a2]: 7, [a3]: 7 };
const git = fakeGit(history, protocols);
const rec = (r: Partial<ServiceRecord> & { service: string }): ServiceRecord => ({
  deployed: a2,
  expected: a2,
  head: a3,
  protocol: 7,
  ...r,
});

describe("verdict (#718 C3)", () => {
  it("docs-only push on main: web and race-server lag HEAD but sit at their expected commit -> OK", () => {
    const v = verdict([rec({ service: "web" }), rec({ service: "race-server" })], git);
    expect(v.ok).toBe(true);
    expect(v.lines[0]).toMatch(/^OK\b/);
  });

  it("deployed at HEAD itself is current (inclusive upper bound)", () => {
    expect(verdict([rec({ service: "web", deployed: a3 })], git).ok).toBe(true);
  });

  it("failed web build: web still runs a commit older than expected -> STALE naming the service", () => {
    const v = verdict(
      [rec({ service: "web", deployed: a1, protocol: 6 }), rec({ service: "race-server" })],
      git,
    );
    expect(v.ok).toBe(false);
    expect(v.lines).toEqual([`STALE web deployed=${a1} expected=${a2}`]);
  });

  it("race-server ahead on protocol: commits current but protocol differs from main -> PROTOCOL", () => {
    const v = verdict([rec({ service: "web" }), rec({ service: "race-server", protocol: 8 })], git);
    expect(v.ok).toBe(false);
    expect(v.lines).toEqual(["PROTOCOL race-server deployed=8 main=7"]);
  });

  it("commit: null (service unreachable or Railway gave no commit) -> STALE", () => {
    const v = verdict([rec({ service: "web", deployed: null, protocol: null })], git);
    expect(v.ok).toBe(false);
    expect(v.lines).toEqual([`STALE web deployed=null expected=${a2}`]);
  });

  it("a deployed commit that is not on main's history (not an ancestor of HEAD) -> STALE", () => {
    expect(verdict([rec({ service: "web", deployed: "fffffff" })], git).lines).toEqual([
      `STALE web deployed=fffffff expected=${a2}`,
    ]);
  });

  it("one line per failing service, every failing service listed", () => {
    const v = verdict(
      [rec({ service: "web", deployed: a1 }), rec({ service: "race-server", protocol: 6 })],
      git,
    );
    expect(v.lines).toEqual([
      `STALE web deployed=${a1} expected=${a2}`,
      "PROTOCOL race-server deployed=6 main=7",
    ]);
  });

  it("never echoes a non-commit value from a health body", () => {
    const v = verdict([rec({ service: "web", deployed: "<script>$(id)" })], git);
    expect(v.lines).toEqual([`STALE web deployed=invalid expected=${a2}`]);
  });
});

// The git side, on a throwaway repository laid out like this one.
describe("expectedCommit and run against a real git history (#718 C3)", () => {
  let repo = "";
  const sh = (...args: string[]) => {
    const out = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
      cwd: repo,
      encoding: "utf8",
    });
    if (out.status !== 0) throw new Error(out.stderr);
    return out.stdout.trim();
  };
  const write = (file: string, text: string) => {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    writeFileSync(path.join(repo, file), text);
  };
  const commit = (msg: string) => {
    sh("add", "-A");
    sh("commit", "-qm", msg);
    return sh("rev-parse", "HEAD");
  };
  let webRace = "";
  let webOnly = "";
  let race = "";
  let docs = "";

  beforeAll(() => {
    repo = mkdtempSync(path.join(tmpdir(), "deploy-check-"));
    sh("init", "-q", "-b", "main");
    write("packages/protocol/src/version.ts", "export const PROTOCOL_VERSION = 6;\n");
    write("src/app.ts", "1");
    webRace = commit("both");
    write("src/app.ts", "2");
    webOnly = commit("web");
    write("services/race-server/src/main.ts", "1");
    race = commit("race-server only");
    write("docs/notes.md", "x");
    write("e2e/a.spec.ts", "x");
    docs = commit("docs and e2e only");
  });

  it("web's expected commit skips race-server, docs and e2e changes", () => {
    expect(expectedCommit("web", repo)).toBe(webOnly);
  });

  it("race-server's expected commit is the newest touching services/race-server, packages or the lockfile", () => {
    expect(expectedCommit("race-server", repo)).toBe(race);
    expect(webRace).not.toBe(race);
  });

  it("createGit reads ancestry and PROTOCOL_VERSION at a commit; unknown or malformed commits are not ancestors", () => {
    const g = createGit(repo);
    expect(g.isAncestor(webRace, docs)).toBe(true);
    expect(g.isAncestor(docs, webRace)).toBe(false);
    expect(g.isAncestor("f".repeat(40), docs)).toBe(false);
    expect(g.isAncestor("--help", docs)).toBe(false);
    expect(g.protocolAt(docs)).toBe(6);
  });

  it("run fetches both health URLs and returns the verdict (OK, then STALE for an old web)", async () => {
    const bodies: Record<string, unknown> = {
      "https://web.test/api/health": { ok: true, db: "up", commit: webOnly, protocol: 6 },
      "https://race.test/health": { ok: true, commit: race, protocol: 6 },
    };
    const fetcher = async (url: string) => {
      if (!(url in bodies)) throw new Error(`unexpected ${url}`);
      return new Response(JSON.stringify(bodies[url]));
    };
    const urls = { web: "https://web.test/", race: "https://race.test" };
    expect((await run(urls, { cwd: repo, fetch: fetcher })).ok).toBe(true);

    bodies["https://web.test/api/health"] = { ok: true, db: "up", commit: webRace, protocol: 6 };
    expect((await run(urls, { cwd: repo, fetch: fetcher })).lines).toEqual([
      `STALE web deployed=${webRace} expected=${webOnly}`,
    ]);
  });

  it("run reports an unreachable service as STALE with deployed=null", async () => {
    const fetcher = async (url: string) => {
      if (url.includes("race")) throw new Error("ECONNREFUSED");
      return new Response(JSON.stringify({ commit: docs, protocol: 6 }), { status: 503 });
    };
    const v = await run(
      { web: "https://web.test", race: "https://race.test" },
      { cwd: repo, fetch: fetcher },
    );
    expect(v.lines).toEqual([`STALE race-server deployed=null expected=${race}`]);
  });
});
