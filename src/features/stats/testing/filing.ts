// Test support (#999 C35, C41): file a race chunk through the real results filing path, with the stats
// after-save steps, against the test database (ADR 0003). Only *.test.ts files import this.
import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { ENGINE_VERSION, type Keystroke } from "@fifth-copy/engine";
import {
  PROTOCOL_VERSION,
  type InternalRaceResult,
  type RaceResultsRequest,
  type TextType,
} from "@fifth-copy/protocol";
import type { AfterSaveStep } from "@/features/results/server";
import type { createPrismaClient } from "@/server/db-client";

type Client = ReturnType<typeof createPrismaClient>;

export type FilingDesk = {
  userId: string | null;
  place?: number;
  status?: InternalRaceResult["status"];
  cleanWpm?: number;
  accuracy?: number;
  flagged?: boolean;
};

export type FilingRace = {
  language?: "FR" | "EN";
  wordCount?: number;
  textType?: TextType;
  accentEveryWord?: boolean;
  lobbySize?: number;
};

const TEXT = "bonjour";
const typed: Keystroke[] = [...TEXT].map((key, i) => ({ t: i * 400, key }));
const traceOf = (keys: Keystroke[]) => ({
  encoding: "gzip+base64" as const,
  data: gzipSync(JSON.stringify(keys)).toString("base64"),
  count: keys.length,
});

/** Creates a race row; returns its id (caller deletes it). */
export async function createRace(db: Client, race: FilingRace = {}): Promise<string> {
  const id = randomUUID();
  await db.race.create({
    data: {
      id,
      textContent: TEXT,
      textLanguage: race.language ?? "FR",
      textWordCount: race.wordCount ?? 20,
      settings: {
        language: (race.language ?? "FR").toLowerCase(),
        textType: race.textType ?? "sentences",
        accentEveryWord: race.accentEveryWord ?? false,
        errorMode: "continue",
        backspace: true,
      },
      startedAt: new Date(),
      engineVersion: ENGINE_VERSION,
      protocolVersion: PROTOCOL_VERSION,
    },
  });
  return id;
}

/** One protocol result for `desk`. */
export function resultOf(desk: number, d: FilingDesk): InternalRaceResult {
  const human = d.userId !== null;
  const cleanWpm = d.cleanWpm ?? 40;
  return {
    desk,
    userId: d.userId,
    name: human ? `Clerk ${desk}` : `Bot ${desk}`,
    isBot: !human,
    place: d.place ?? desk,
    status: d.status ?? "finished",
    wpm: cleanWpm,
    rawWpm: cleanWpm,
    cleanWpm,
    adjustedWpm: cleanWpm,
    accuracy: d.accuracy ?? 0.97,
    progress: 1,
    correct: 7,
    errors: 0,
    total: 7,
    durationMs: 2_800,
    finishedAtMs: 2_800,
    bonusesSent: 0,
    bonusesReceived: 0,
    bonusLog: [],
    overlay: null,
    flags: d.flagged ? [{ code: "uniform-timing" }] : [],
    engineVersion: ENGINE_VERSION,
    trace: human ? traceOf(typed) : traceOf([]),
  };
}

/** The filing request of `desks` (desk = index + 1) for `raceId`. */
export function requestOf(
  raceId: string,
  desks: FilingDesk[],
  lobbySize = desks.length,
): RaceResultsRequest {
  return {
    v: PROTOCOL_VERSION,
    raceId,
    endedAt: Date.now(),
    reason: "all-finished",
    lobbySize,
    results: desks.map((d, i) => resultOf(i + 1, d)),
  };
}

export type { AfterSaveStep };
