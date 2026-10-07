// Called only by the HMAC-verified route `POST /api/internal/races/:id/results`. `server-only`, and
// never a `"use server"` module: a server action would be callable from any browser without the HMAC.
import "server-only";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import {
  charsOf,
  normalizeTypeable,
  traceCapOf,
  type Keystroke,
  type PlayerStatus,
} from "@fifth-copy/engine";
import {
  keystrokeSchema,
  MAX_RESULTS_PER_REQUEST,
  MAX_TRACE_BASE64_LENGTH,
  PROTOCOL_VERSION,
  type InternalRaceResult,
  type RaceResultsRequest,
  type RaceResultsResponse,
} from "@fifth-copy/protocol";
import { Prisma, type RaceEndReason, type ResultStatus } from "@/generated/prisma/client";
import { db as appDb } from "@/server/db";

/**
 * Body cap of `POST /api/internal/races/:id/results`, from the protocol's own bounds:
 * `MAX_RESULTS_PER_REQUEST` results, each a trace of at most `MAX_TRACE_BASE64_LENGTH` plus 128 KiB
 * for the rest of the result (a full 1 024-entry bonus log, 32 flags, names and figures). About
 * 9.6 MiB; every other internal route keeps the 64 KiB default.
 */
export const MAX_RESULTS_BODY_BYTES =
  MAX_RESULTS_PER_REQUEST * (MAX_TRACE_BASE64_LENGTH + 128 * 1024);

export type PersistResultsResult =
  { ok: true; response: RaceResultsResponse } | { ok: false; error: "not-found" | "bad-body" };

type Db = Pick<typeof appDb, "race" | "user" | "$transaction">;

/** Engine status -> stored status (prisma/schema/race.prisma); `typing` at the end timed out. */
const STATUS_TO_DB: Record<PlayerStatus, ResultStatus> = {
  typing: "TIMED_OUT",
  finished: "FINISHED",
  abandoned: "REASSIGNED",
  asleep: "ASLEEP",
  "line-cut": "LINE_CUT",
  expired: "EXPIRED",
};
const REASON_TO_DB: Record<RaceResultsRequest["reason"], RaceEndReason> = {
  "all-finished": "ALL_FINISHED",
  timer: "TIMER",
};

/**
 * The largest JSON of one keystroke plus its separator, in bytes: `{"t":3600000,"key":"Backspace"},`
 * (`t` <= MAX_RACE_MS; any other key is one character, at most 6 bytes once quoted or escaped).
 * Bounds the inflated size of a trace of `count` keystrokes.
 */
export const MAX_KEYSTROKE_JSON_BYTES = 32;

export type DecodedTrace = { data: Buffer; keystrokes: Keystroke[] };

/**
 * Checks one result's trace without trusting its gzip (#189): `count` at most `maxKeys`, inflation
 * capped at `count * MAX_KEYSTROKE_JSON_BYTES + 2` bytes (a gzip bomb stops there), then the JSON
 * must be an array of exactly `count` protocol keystrokes. Returns the bytes as received, or null.
 */
export function decodeTrace(
  trace: InternalRaceResult["trace"],
  maxKeys: number,
): DecodedTrace | null {
  if (trace.count > maxKeys) return null;
  const data = Buffer.from(trace.data, "base64");
  let json: string;
  try {
    json = gunzipSync(data, {
      maxOutputLength: trace.count * MAX_KEYSTROKE_JSON_BYTES + 2,
    }).toString("utf8");
  } catch {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  const parsed = z.array(keystrokeSchema).length(trace.count).safeParse(value);
  return parsed.success ? { data, keystrokes: parsed.data } : null;
}

/** Same printable rule as the protocol's names and keys (#557): ids reach Postgres as text. */
const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/u;

/** Request rules the wire schema cannot state: unique desks, bots without users, printable ids. */
function coherent(request: RaceResultsRequest): boolean {
  const desks = new Set(request.results.map((r) => r.desk));
  if (desks.size !== request.results.length) return false;
  return request.results.every(
    (r) => (r.isBot ? r.userId === null : true) && !UNPRINTABLE.test(r.userId ?? ""),
  );
}

const isKnownError = (err: unknown, code: string) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === code;

/**
 * Stores one chunk of an ended race's results (ADR 0008 write path, ARCHITECTURE 9.3), in one
 * transaction: the race's end (`endedAt`, `endReason`, `lobbySize`; first write wins), one
 * `RaceResult` per desk and the `RaceKeystrokes` of each human desk with keystrokes, all upserted by
 * `(raceId, desk)` with no update, so a repeat is a no-op and answers the same. Numbers are stored
 * as sent: the race server ran the engine (ADR 0007). Refuses an unknown race (`not-found`) and an
 * incoherent chunk or a trace that does not inflate to `count` keystrokes within the race's
 * `traceCapOf` (`bad-body`, nothing written). A desk whose user no longer exists (account deleted
 * mid-race) is acknowledged without a row: its deletion would have removed it anyway.
 */
export async function persistRaceResults(
  request: RaceResultsRequest,
  { db = appDb }: { db?: Db } = {},
): Promise<PersistResultsResult> {
  const race = await db.race.findUnique({
    where: { id: request.raceId },
    select: { textContent: true },
  });
  if (!race) return { ok: false, error: "not-found" };
  if (!coherent(request)) return { ok: false, error: "bad-body" };

  const maxKeys = traceCapOf(charsOf(normalizeTypeable(race.textContent)).length);
  const traces = new Map<number, DecodedTrace>();
  for (const result of request.results) {
    const decoded = decodeTrace(result.trace, maxKeys);
    if (!decoded) return { ok: false, error: "bad-body" };
    if (!result.isBot && result.userId !== null && result.trace.count > 0) {
      traces.set(result.desk, decoded);
    }
  }

  const userIds = [...new Set(request.results.flatMap((r) => (r.userId ? [r.userId] : [])))];
  const write = async () => {
    const known = new Set(
      (await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true } })).map(
        (u) => u.id,
      ),
    );
    const stored = request.results.filter((r) => r.userId === null || known.has(r.userId));
    await db.$transaction(async (tx) => {
      await tx.race.updateMany({
        where: { id: request.raceId, endedAt: null },
        data: {
          endedAt: new Date(request.endedAt),
          endReason: REASON_TO_DB[request.reason],
          lobbySize: request.lobbySize,
        },
      });
      for (const r of stored) {
        await tx.raceResult.upsert({
          where: { raceId_desk: { raceId: request.raceId, desk: r.desk } },
          update: {},
          create: {
            raceId: request.raceId,
            userId: r.userId,
            desk: r.desk,
            name: r.name,
            isBot: r.isBot,
            place: r.place,
            status: STATUS_TO_DB[r.status],
            wpm: r.wpm,
            rawWpm: r.rawWpm,
            cleanWpm: r.cleanWpm,
            adjustedWpm: r.adjustedWpm,
            accuracy: r.accuracy,
            progress: r.progress,
            correct: r.correct,
            errors: r.errors,
            total: r.total,
            durationMs: r.durationMs,
            finishedAtMs: r.finishedAtMs,
            bonusesSent: r.bonusesSent,
            bonusesReceived: r.bonusesReceived,
            bonusLog: r.bonusLog,
            engineVersion: r.engineVersion,
          },
        });
      }
      for (const r of stored) {
        const trace = traces.get(r.desk);
        if (!trace || r.userId === null) continue;
        await tx.raceKeystrokes.upsert({
          where: { raceId_desk: { raceId: request.raceId, desk: r.desk } },
          update: {},
          create: {
            raceId: request.raceId,
            desk: r.desk,
            userId: r.userId,
            data: new Uint8Array(trace.data),
            count: r.trace.count,
          },
        });
      }
    });
  };

  try {
    await write();
  } catch (err) {
    // A concurrent repeat of this chunk won an insert (P2002), or a user was deleted between the
    // check and the insert (P2003): the transaction rolled back; once more sees the stored rows.
    if (!isKnownError(err, "P2002") && !isKnownError(err, "P2003")) throw err;
    await write();
  }
  return {
    ok: true,
    response: {
      v: PROTOCOL_VERSION,
      raceId: request.raceId,
      persisted: request.results.map((r) => r.desk),
    },
  };
}
