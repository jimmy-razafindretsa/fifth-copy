// Called only by the HMAC-verified route `POST /api/internal/races/:id/results`. `server-only`, and
// never a `"use server"` module: a server action would be callable from any browser without the HMAC.
import "server-only";
import {
  charsOf,
  MAX_EXTRA_WORD_LENGTH,
  normalizeTypeable,
  TRACE_KEYS_PER_CHAR,
  traceCapOf,
  type Keystroke,
  type PlayerStatus,
} from "@fifth-copy/engine";
import {
  MAX_OVERLAY_WORDS,
  MAX_RESULTS_PER_REQUEST,
  MAX_TRACE_BASE64_LENGTH,
  PROTOCOL_VERSION,
  type InternalRaceResult,
  type RaceResultsRequest,
  type RaceResultsResponse,
} from "@fifth-copy/protocol";
import {
  Prisma,
  type RaceEndReason,
  type RaceLanguage,
  type ResultStatus,
} from "@/generated/prisma/client";
import { db as appDb } from "@/server/db";
import { filedSeriesOf } from "../filed-series";
import { decodeKeystrokes, MAX_KEYSTROKE_JSON_BYTES } from "../trace-codec";

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

/** The race a chunk was filed for, as the after-save steps see it (inside the transaction). */
export type FiledRace = {
  id: string;
  textLanguage: RaceLanguage;
  textWordCount: number;
  /** `Race.settings`: untyped JSON (the wire's race settings); parse before use. */
  settings: unknown;
  /** Desks at the start, from the request. */
  lobbySize: number;
  endedAt: Date;
};

/** One stored human result of the chunk (a desk with a user), as the after-save steps see it. */
export type FiledResult = {
  userId: string;
  desk: number;
  isBot: boolean;
  place: number;
  status: ResultStatus;
  /** ADR 0016: the only speed award rules read. */
  cleanWpm: number;
  /** 0..1. */
  accuracy: number;
  /** An anti-cheat flag was raised (#195): nothing is ever awarded from it. */
  suspicious: boolean;
};

/**
 * A step run inside the filing transaction after the chunk's rows are written (#999 C35, C41): the
 * stats feature's personal bests and achievements, composed by the route (results never imports
 * stats, which imports results). Each step must be idempotent: a repeated chunk runs them again.
 */
export type AfterSaveStep = (
  tx: Prisma.TransactionClient,
  filed: { race: FiledRace; results: FiledResult[] },
) => Promise<void>;

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

// The stored blob's codec (#865 moved it to a pure module the WPM series reads too).
export { MAX_KEYSTROKE_JSON_BYTES };

/**
 * The most keystrokes a stored trace may hold for a race whose base text has `baseLength`
 * characters (#190): the race server caps each desk at `traceCapOf` of its effective text, which
 * Extra Paperwork lengthens by at most `MAX_OVERLAY_WORDS` words of `MAX_EXTRA_WORD_LENGTH`
 * characters plus a separator each (Exemption only shortens it). The check runs before the
 * result's own overlay is trusted, so it bounds by the largest one the wire allows (#623 stores the
 * overlay; tightening this bound to it is ADR 0016's follow-up); the inflation cap of `decodeTrace`
 * follows from the count it admits.
 */
export function maxStoredTraceKeys(baseLength: number): number {
  return (
    traceCapOf(baseLength) + TRACE_KEYS_PER_CHAR * MAX_OVERLAY_WORDS * (MAX_EXTRA_WORD_LENGTH + 1)
  );
}

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
  const keystrokes = decodeKeystrokes(data, trace.count);
  return keystrokes ? { data, keystrokes } : null;
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
 * transaction: the race's end (`endedAt`, `endReason`, `lobbySize`; first write wins, over a VOID set
 * by the `race.void` sweep too, #613), one
 * `RaceResult` per desk and the `RaceKeystrokes` of each human desk with keystrokes, all upserted by
 * `(raceId, desk)` with no update, so a repeat is a no-op and answers the same. Each result keeps the
 * desk's final text `overlay` (`null` when untouched, #623). Numbers are stored
 * as sent: the race server ran the engine (ADR 0007), its anti-cheat flags included (`suspicious`,
 * `suspiciousReason` = the flag codes joined by `,`; #195). Refuses an unknown race (`not-found`) and an
 * incoherent chunk or a trace that does not inflate to `count` keystrokes within
 * `maxStoredTraceKeys` of the race's base text (`bad-body`, nothing written). A desk whose user no longer exists (account deleted
 * mid-race) is acknowledged without a row: its deletion would have removed it anyway. Each human,
 * unflagged desk with a trace also stores its speed curve (`wpmSeries`, ADR 0027). The `afterSave`
 * steps run last, in the same transaction, with the stored human results (#999 C35, C41).
 */
export async function persistRaceResults(
  request: RaceResultsRequest,
  { db = appDb, afterSave = [] }: { db?: Db; afterSave?: readonly AfterSaveStep[] } = {},
): Promise<PersistResultsResult> {
  const race = await db.race.findUnique({
    where: { id: request.raceId },
    select: { textContent: true, textLanguage: true, textWordCount: true, settings: true },
  });
  if (!race) return { ok: false, error: "not-found" };
  if (!coherent(request)) return { ok: false, error: "bad-body" };

  const maxKeys = maxStoredTraceKeys(charsOf(normalizeTypeable(race.textContent)).length);
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
    // The speed curve of each human, unflagged desk with a trace (ADR 0027): computed once here, so
    // no request ever replays another user's keystrokes. Bots and flagged rows store none.
    const series = new Map<number, ReturnType<typeof filedSeriesOf>>();
    for (const r of stored) {
      const trace = traces.get(r.desk);
      if (!trace || r.flags.length > 0) continue;
      series.set(
        r.desk,
        filedSeriesOf({
          textContent: race.textContent,
          settings: race.settings,
          overlay: r.overlay,
          keystrokes: trace.keystrokes,
          durationMs: r.durationMs,
        }),
      );
    }
    await db.$transaction(async (tx) => {
      await tx.race.updateMany({
        // First real end wins; a VOID end is the race.void sweep's guess (#613) and gives way.
        where: { id: request.raceId, OR: [{ endedAt: null }, { endReason: "VOID" }] },
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
            // The desk's final text overlay (#623): what a replay of its trace must type. Prisma
            // takes SQL NULL on a `Json?` column only as `DbNull`; it reads back as `null`.
            overlay: r.overlay ?? Prisma.DbNull,
            // Flags from the race server's trace analysis (#195, ADR 0007): stored, never re-run.
            suspicious: r.flags.length > 0,
            suspiciousReason: r.flags.map((f) => f.code).join(",") || null,
            engineVersion: r.engineVersion,
            wpmSeries: series.get(r.desk) ?? Prisma.DbNull,
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
      if (afterSave.length === 0) return;
      const filed = {
        race: {
          id: request.raceId,
          textLanguage: race.textLanguage,
          textWordCount: race.textWordCount,
          settings: race.settings,
          lobbySize: request.lobbySize,
          endedAt: new Date(request.endedAt),
        },
        results: stored.flatMap((r): FiledResult[] =>
          r.userId === null
            ? []
            : [
                {
                  userId: r.userId,
                  desk: r.desk,
                  isBot: r.isBot,
                  place: r.place,
                  status: STATUS_TO_DB[r.status],
                  cleanWpm: r.cleanWpm,
                  accuracy: r.accuracy,
                  suspicious: r.flags.length > 0,
                },
              ],
        ),
      };
      for (const step of afterSave) await step(tx, filed);
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
