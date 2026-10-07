import { gzipSync } from "node:zlib";
import { ENGINE_VERSION, initialState, type Keystroke } from "@fifth-copy/engine";
import {
  MAX_RACE_MS,
  MAX_RESULTS_PER_REQUEST,
  MAX_TRACE_BASE64_LENGTH,
  PROTOCOL_VERSION,
  raceResultsRequestSchema,
  type InternalRaceResult,
  type RaceResultsRequest,
} from "@fifth-copy/protocol";
import type { DeskState } from "../rooms/desks-state";
import type { RaceEnded } from "../rooms/lifecycle";
import { elapsedOf } from "../rooms/ranking";
import type { RaceDesk } from "../rooms/registry";
import type { WebApi } from "./web-api";

/** What `buildResults` reads of a room at its end: the desks at start and their final states. */
export type EndedRoom = {
  readonly desks: readonly RaceDesk[];
  readonly states: ReadonlyMap<number, DeskState>;
};

/** gzip (`node:zlib`) of the JSON keystroke array, base64, as `InternalRaceResult.trace`. */
export function encodeTrace(trace: readonly Keystroke[]): InternalRaceResult["trace"] {
  return {
    encoding: "gzip+base64",
    data: gzipSync(JSON.stringify(trace)).toString("base64"),
    count: trace.length,
  };
}

const EMPTY_TRACE = encodeTrace([]);

const log = (msg: string, fields: Record<string, unknown>) =>
  console.log(JSON.stringify({ level: "info", msg, ...fields }));

/**
 * The results of an ended race (ADR 0007, 0008; #189), one per desk of `ended.ranking`: place and
 * figures from the engine's ranking, counters and finish from the desk's state, `durationMs` from
 * `elapsedOf`, the gzip trace for a human desk (a bot's is empty). Chunked into requests of at most
 * `MAX_RESULTS_PER_REQUEST`. Extension point: #190 (clean/adjusted WPM, bonus log) and #195 (flags)
 * fill their fields here. A trace over the wire bound is sent empty (logged) rather than blocking
 * the race's results forever. A `void` end builds nothing.
 */
export function buildResults(ended: RaceEnded, room: EndedRoom): RaceResultsRequest[] {
  // A void race is never persisted (#204).
  if (ended.reason === "void") return [];
  const { reason } = ended;
  const byDesk = new Map(room.desks.map((d) => [d.desk, d]));
  const results = ended.ranking.map((entry): InternalRaceResult => {
    const desk = byDesk.get(entry.desk);
    const state = room.states.get(entry.desk) ?? { ...initialState(), trace: [] };
    const isBot = desk?.isBot ?? entry.isBot;
    let trace = isBot ? EMPTY_TRACE : encodeTrace(state.trace);
    if (trace.data.length > MAX_TRACE_BASE64_LENGTH) {
      log("results trace too large", { race: ended.raceId, desk: entry.desk, count: trace.count });
      trace = EMPTY_TRACE;
    }
    const durationMs = Math.min(
      MAX_RACE_MS,
      Math.max(0, Math.round(elapsedOf(state, ended.elapsedMs))),
    );
    return {
      desk: entry.desk,
      userId: isBot ? null : (desk?.userId ?? null),
      name: entry.name,
      isBot,
      place: entry.place,
      status: entry.status,
      wpm: entry.wpm,
      rawWpm: entry.rawWpm,
      // Until #190: clean and adjusted WPM equal WPM (ADR 0007).
      cleanWpm: entry.wpm,
      adjustedWpm: entry.wpm,
      accuracy: entry.accuracy,
      progress: entry.progress,
      correct: state.correct,
      errors: state.errors,
      total: state.total,
      durationMs,
      finishedAtMs: entry.finishedAt,
      bonusesSent: 0,
      bonusesReceived: 0,
      bonusLog: [],
      flags: [],
      engineVersion: ENGINE_VERSION,
      trace,
    };
  });

  const requests: RaceResultsRequest[] = [];
  for (let i = 0; i < results.length; i += MAX_RESULTS_PER_REQUEST) {
    requests.push({
      v: PROTOCOL_VERSION,
      raceId: ended.raceId,
      endedAt: ended.endedAt,
      reason,
      lobbySize: ended.ranking.length,
      results: results.slice(i, i + MAX_RESULTS_PER_REQUEST),
    });
  }
  return requests;
}

/**
 * The outbox's `send` for results: posts one chunk, acknowledged only by a 200 for the same race
 * whose `persisted` covers every desk of the chunk (anything else is retried).
 */
export const sendResults =
  (webApi: Pick<WebApi, "postResults">) =>
  async (entry: unknown): Promise<boolean> => {
    const request = raceResultsRequestSchema.parse(entry);
    const answer = await webApi.postResults(request);
    const persisted = new Set(answer.persisted);
    return answer.raceId === request.raceId && request.results.every((r) => persisted.has(r.desk));
  };
