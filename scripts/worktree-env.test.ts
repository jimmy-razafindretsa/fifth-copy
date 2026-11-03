import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unitRedisEnv } from "./lib/redis-env";

// #680: a card worktree's unit step and its e2e race server get distinct Redis dbs, and two live
// worktrees never share one. `scripts/worktree.sh --env <n>` prints the env with no side effects;
// WORKTREE_ROOT points it at a fixture checkout whose .worktrees/*/.env are the other cards.
const SCRIPT = path.resolve(__dirname, "worktree.sh");
let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "worktree-env-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const envFor = (n: number) =>
  spawnSync(SCRIPT, ["--env", String(n)], {
    env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", WORKTREE_ROOT: root },
    encoding: "utf8",
  });

const redisDbs = (out: string) => {
  const db = (name: string) => {
    const m = out.match(new RegExp(`^${name}="redis://localhost:6379/(\\d+)"$`, "m"));
    return m ? Number(m[1]) : undefined;
  };
  return { e2e: db("REDIS_URL"), unit: db("REDIS_URL_TEST") };
};

/** Writes card n's worktree .env into the fixture, as `scripts/worktree.sh <n>` would. */
const createWorktree = (n: number, dotenv?: string) => {
  if (dotenv === undefined) {
    const r = envFor(n);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    dotenv = r.stdout;
  }
  fs.mkdirSync(path.join(root, ".worktrees", String(n)), { recursive: true });
  fs.writeFileSync(path.join(root, ".worktrees", String(n), ".env"), dotenv);
  return redisDbs(dotenv);
};

describe("worktree.sh Redis dbs (#680)", () => {
  it.each([1, 14, 15, 629])("card %i: unit db differs from the e2e db, both in 1..15", (n) => {
    const r = envFor(n);
    expect(r.status, r.stderr).toBe(0);
    const { e2e, unit } = redisDbs(r.stdout);
    expect(e2e).toBeDefined();
    expect(unit).toBeDefined();
    expect(unit).not.toBe(e2e);
    for (const db of [e2e!, unit!]) {
      expect(db).toBeGreaterThanOrEqual(1);
      expect(db).toBeLessThanOrEqual(15);
    }
  });

  it.each([
    [629, 644],
    [1, 16],
    [629, 636], // 7 apart: same preferred pair, the second card falls back to free dbs
  ])("cards %i and %i never share a db", (a, b) => {
    const first = createWorktree(a);
    const second = createWorktree(b);
    const dbs = [first.e2e, first.unit, second.e2e, second.unit];
    expect(new Set(dbs).size).toBe(4);
  });

  it("a card keeps the dbs its existing .env holds", () => {
    createWorktree(629);
    const own = createWorktree(
      680,
      'REDIS_URL="redis://localhost:6379/11"\nREDIS_URL_TEST="redis://localhost:6379/12"\n',
    );
    expect(own).toEqual({ e2e: 11, unit: 12 });
    expect(redisDbs(envFor(680).stdout)).toEqual({ e2e: 11, unit: 12 });
  });

  it("old single-db worktrees count as taken", () => {
    // 629's preferred pair is 13/14; an older .env holding db 13 pushes it elsewhere.
    createWorktree(76, 'REDIS_URL="redis://localhost:6379/13"\n');
    const { e2e, unit } = redisDbs(envFor(629).stdout);
    expect([e2e, unit]).not.toContain(13);
  });

  it("refuses with exit 3 naming the other cards when every db is taken", () => {
    for (let db = 1; db <= 15; db++) {
      createWorktree(100 + db, `REDIS_URL="redis://localhost:6379/${db}"\n`);
    }
    const r = envFor(629);
    expect(r.status).toBe(3);
    expect(r.stdout + r.stderr).toMatch(/#101\b/);
    expect(r.stdout + r.stderr).toMatch(/--remove/);
  });
});

describe("unit step Redis mapping (#680)", () => {
  it("maps REDIS_URL_TEST onto REDIS_URL for the unit run", () => {
    expect(
      unitRedisEnv({
        REDIS_URL: "redis://localhost:6379/3",
        REDIS_URL_TEST: "redis://localhost:6379/4",
      }),
    ).toEqual({ REDIS_URL: "redis://localhost:6379/4" });
  });

  it("keeps REDIS_URL as is without a worktree (CI, main checkout)", () => {
    expect(unitRedisEnv({ REDIS_URL: "redis://localhost:6379/0" })).toEqual({});
    expect(unitRedisEnv({})).toEqual({});
  });

  it("the unit run sees the mapped URL", () => {
    if (process.env.REDIS_URL_TEST) expect(process.env.REDIS_URL).toBe(process.env.REDIS_URL_TEST);
  });
});

// #757: browsers (and Next.js dev) refuse the WHATWG fetch "bad ports"; slot 697 gave PW_PORT 6697.
// https://fetch.spec.whatwg.org/#port-blocking
const BAD_PORTS = new Set([
  0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
  103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
  512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
  995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668,
  6669, 6679, 6697, 10080,
]);

const envVar = (out: string, name: string) =>
  out.match(new RegExp(`^${name}="([^"]*)"$`, "m"))?.[1];

const ports = (out: string) => ({
  web: Number(envVar(out, "PORT")),
  pw: Number(envVar(out, "PW_PORT")),
  race: Number(envVar(out, "RACE_SERVER_PORT")),
});

/** Ports named by the `worktree: ready` line. */
const readyPorts = (line: string) => {
  const m = line.match(/web :(\d+) \| playwright :(\d+) \| race :(\d+)/);
  return m ? { web: Number(m[1]), pw: Number(m[2]), race: Number(m[3]) } : undefined;
};

describe("worktree.sh safe ports (#757)", () => {
  const badSlots = [665, 666, 667, 668, 669, 697, 1697, 0, 60, 61, 566, 679];

  it.each(badSlots)("card %i: no port is a browser bad port, and the picks are stable", (n) => {
    const r = envFor(n);
    expect(r.status, r.stderr).toBe(0);
    const p = ports(r.stdout);
    for (const port of [p.web, p.pw, p.race]) {
      expect(Number.isInteger(port)).toBe(true);
      expect(BAD_PORTS.has(port), `port ${port}`).toBe(false);
    }
    expect(new Set([p.web, p.pw, p.race]).size).toBe(3);
    expect(ports(envFor(n).stdout)).toEqual(p);
  });

  it("slot 697 moves only its Playwright port, deterministically", () => {
    expect(ports(envFor(697).stdout)).toEqual({ web: 5697, pw: 9697, race: 7697 });
    expect(ports(envFor(666).stdout)).toEqual({ web: 5666, pw: 9666, race: 7666 });
  });

  it("other slots keep the 5000/6000/7000 + slot scheme", () => {
    expect(ports(envFor(629).stdout)).toEqual({ web: 5629, pw: 6629, race: 7629 });
    expect(ports(envFor(664).stdout)).toEqual({ web: 5664, pw: 6664, race: 7664 });
  });

  it("replacement ports never collide with another slot's ports", () => {
    const tested = [...badSlots, 629, 664, 670, 698, 1, 62, 567, 680].map((n) =>
      ports(envFor(n).stdout),
    );
    const all = tested.flatMap((p) => [p.web, p.pw, p.race]);
    // 697 and 1697 share slot 697 by design (n mod 1000); drop that duplicate pair before counting.
    expect(new Set(all).size).toBe(all.length - 3);
  });

  it.each([697, 665, 60, 629])("card %i: the ready line and the .env agree", (n) => {
    const r = envFor(n);
    expect(r.status, r.stderr).toBe(0);
    const line = r.stderr.split("\n").find((l) => l.startsWith("worktree: ready"));
    expect(line, r.stderr).toBeDefined();
    const p = ports(r.stdout);
    expect(readyPorts(line!)).toEqual(p);
    expect(envVar(r.stdout, "SEE_BASE_URL")).toBe(`http://localhost:${p.web}`);
    expect(envVar(r.stdout, "NEXT_PUBLIC_APP_URL")).toBe(`http://localhost:${p.web}`);
    expect(envVar(r.stdout, "WEB_ORIGIN")).toBe(`http://localhost:${p.web}`);
    expect(envVar(r.stdout, "NEXT_PUBLIC_RACE_SERVER_URL")).toBe(`http://localhost:${p.race}`);
    expect(envVar(r.stdout, "RACE_SERVER_INTERNAL_URL")).toBe(`http://localhost:${p.race}`);
  });
});
