import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { wordCount } from "@fifth-copy/engine";
import {
  DEFAULT_RACE_SETTINGS,
  PROTOCOL_VERSION,
  type StartRaceRequest,
} from "@fifth-copy/protocol";
import { clearCorpusCache } from "@/features/texts/server";
import { createPrismaClient } from "@/server/db-client";

// #346 C5: startRace takes its text from the corpus provider: the content files while the `Text`
// table holds fewer than 20 rows of the language, the rows once it holds 20.
// ADR 0003: DB-backed tests target the test database. The 20-row case runs in a rolled-back
// transaction, so parallel test files keep an empty `Text` table.
// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

vi.mock("@/server/db", () => ({ db: {} }));
const { startRace } = await import("./start-race");

const MARKER = "quokka";
const passage = (i: number) =>
  `The ${MARKER} number ${i} walked across the sunny field and waved at the children near the river.`;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe.skipIf(!testDatabaseUrl)("startRace text source (needs TEST_DATABASE_URL)", () => {
  let db: ReturnType<typeof createPrismaClient>;
  const PREFIX = "test-start-corpus-";
  const CODE = "TXT-3461";
  const raceIds: string[] = [];
  let host: { id: string };
  let lobby: { id: string };
  class Rollback extends Error {}

  const request = (): StartRaceRequest => {
    const raceId = randomUUID();
    raceIds.push(raceId);
    return {
      v: PROTOCOL_VERSION,
      raceId,
      lobbyId: lobby.id,
      hostUserId: host.id,
      settings: { ...DEFAULT_RACE_SETTINGS, language: "en", textType: "sentences", wordCount: 30 },
      desks: [{ desk: 1, userId: host.id, name: "Ada", isBot: false }],
    };
  };
  const cleanup = async () => {
    await db.race.deleteMany({ where: { id: { in: raceIds } } });
    await db.lobby.deleteMany({ where: { code: CODE } });
    await db.user.deleteMany({ where: { typistName: { startsWith: PREFIX } } });
  };

  beforeAll(async () => {
    db = createPrismaClient(testDatabaseUrl!);
    await cleanup();
    host = await db.user.create({ data: { isGuest: true, typistName: `${PREFIX}host` } });
    lobby = await db.lobby.create({ data: { code: CODE, hostUserId: host.id } });
  });
  beforeEach(() => clearCorpusCache());
  afterAll(async () => {
    await cleanup();
    await db.$disconnect();
  });

  it("with an empty table, the text comes from the content files", async () => {
    expect(await db.text.count({ where: { language: "EN" } })).toBeLessThan(20);
    const result = await startRace(request(), { db });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.text.sourceRef).toMatch(/^files:en:/);
    expect(result.response.text.content).not.toContain(MARKER);
    const stored = await db.race.findUnique({ where: { id: result.response.raceId } });
    expect(stored?.textSourceRef).toBe(result.response.text.sourceRef);
  });

  it("with 20 imported rows, the text comes from the rows and the ref names db:", async () => {
    const outcome = await db
      .$transaction(
        async (tx) => {
          await tx.text.createMany({
            data: Array.from({ length: 20 }, (_, i) => ({
              language: "EN" as const,
              content: passage(i),
              contentHash: sha(passage(i)),
              wordCount: wordCount(passage(i)),
              source: "Test work",
              licence: "public domain",
              authorType: "PUBLIC_DOMAIN" as const,
            })),
          });
          const result = await startRace(request(), { db: tx });
          if (!result.ok) throw new Error("startRace refused");
          const stored = await tx.race.findUnique({ where: { id: result.response.raceId } });
          throw new Rollback(
            JSON.stringify({ text: result.response.text, ref: stored?.textSourceRef }),
          );
        },
        { timeout: 60_000, maxWait: 30_000 },
      )
      .catch((e: unknown) => {
        if (e instanceof Rollback) return JSON.parse(e.message);
        throw e;
      });
    expect(outcome.text.sourceRef).toMatch(/^db:20:\d{4}-\d\d-\d\dT/);
    expect(outcome.ref).toBe(outcome.text.sourceRef);
    expect(outcome.text.content).toContain(MARKER);
    expect(wordCount(outcome.text.content)).toBe(30);
    expect(await db.text.count({ where: { contentHash: sha(passage(0)) } })).toBe(0);
  });
});
