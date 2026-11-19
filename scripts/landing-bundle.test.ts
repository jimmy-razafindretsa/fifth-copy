import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { VISITOR_HOME } from "../src/lib/visitor-home";
import {
  CHUNK_FINGERPRINTS,
  clientBoundaries,
  clientGraph,
  fingerprintsIn,
  forbiddenIn,
} from "./landing-bundle";

// #999 C56 (#954, ADR 0026): the route module that serves a cookieless visitor at `/` ships no lobby
// store, no race socket client and no zod. Over the production build: `npm run build` first.
const DIST = path.resolve(".next");
const built = fs.existsSync(path.join(DIST, "server/app/page_client-reference-manifest.js"));

describe("landing bundle analysis", () => {
  it("catches the lobby store, the race socket and zod behind a client boundary", async () => {
    // the live lobby is a client boundary that reaches all three
    const graph = await clientGraph(["src/features/lobby/components/lobby-live.tsx"]);
    const found = forbiddenIn(graph).map((f) => f.split(":")[0]);
    expect(found).toEqual(expect.arrayContaining(["lobby-store", "race/client/socket", "zod"]));
  }, 60_000);

  it("stops at a server action and at a type-only import", async () => {
    // quick-race-button calls a "use server" action that imports zod; room-code-format types zod only
    const graph = await clientGraph([
      "src/features/lobby/components/quick-race-button.tsx",
      "src/features/lobby/components/join-by-code-form.tsx",
    ]);
    expect(graph.has("src/features/lobby/actions/quick-race.ts")).toBe(true);
    expect([...graph.keys()].some((m) => m.startsWith("src/features/lobby/schema"))).toBe(false);
    expect(forbiddenIn(graph)).toEqual([]);
  }, 60_000);

  it("knows zod and the Socket.IO client by their minified fingerprints", () => {
    const hit = (s: string) => CHUNK_FINGERPRINTS.filter((p) => p.re.test(s)).map((p) => p.name);
    expect(hit('class r extends e{static name="$ZodObject"}')).toEqual(["zod"]);
    expect(hit("e.EIO=4,e.transport=t")).toEqual(["socket.io-client"]);
    expect(hit("const q={eio:1};")).toEqual([]);
  });
});

describe.skipIf(!built)(`the visitor landing (${VISITOR_HOME}) on the production build`, () => {
  it("lists the landing's client boundaries and not the Home menu's", () => {
    const roots = clientBoundaries(DIST, VISITOR_HOME);
    expect(roots).toContain("src/features/lobby/components/quick-race-button.tsx");
    expect(roots.filter((r) => /landing\/components\/home-(menu|stage)/.test(r))).toEqual([]);
  });

  it("reaches no lobby store, race socket client or zod", async () => {
    const graph = await clientGraph(clientBoundaries(DIST, VISITOR_HOME));
    expect(forbiddenIn(graph)).toEqual([]);
  }, 120_000);

  it("carries no zod or Socket.IO client runtime in its first-load chunks", () => {
    expect(fingerprintsIn(DIST, VISITOR_HOME)).toEqual([]);
  });
});
