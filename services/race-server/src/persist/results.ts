import { gzipSync } from "node:zlib";
import {
  analyseTrace,
  cleanAndAdjustedWpm,
  EMPTY_LEDGER,
  EMPTY_OVERLAY,
  effectiveText,
  ENGINE_VERSION,
  initialState,
  MAX_LOG_ENTRIES,
  type EngineSettings,
  type Keystroke,
} from "@fifth-copy/engine";
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

/**
 * What `buildResults` reads of a room at its end: the desks at start, their final states, and the
 * normalised base text and engine settings the states were computed with (each desk's trace is
 * replayed by `analyseTrace` on its effective text: the base plus its overlay, #190).
 */
export type EndedRoom = {
  readonly text: string;
  readonly engine: EngineSettings;
  readonly desks: readonly RaceDesk[];
  readonly states: ReadonlyMap<number, DeskState>;
};

/** The trace analysis seam (#195): the engine's `analyseTrace`, injected so tests can spy on it. */
export type ResultsDeps = { readonly analyse: typeof analyseTrace };
const DEFAULT_DEPS: ResultsDeps = { analyse: analyseTrace };

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
 * `MAX_RESULTS_PER_REQUEST`. Bonuses (#190, ADR 0016): `cleanWpm`/`adjustedWpm` from the engine's
 * `cleanAndAdjustedWpm` over the desk's overlay (equal to `wpm` without one), `bonusesSent`,
 * `bonusesReceived` and `bonusLog` from its ledger. Flags (#195, ADR 0007): every human desk's in-memory trace goes through `analyseTrace`
 * against its recorded counters and live `timingAnomalies`; a bot is never analysed. The analysis
 * runs on the trace as applied, before a trace over the wire bound is sent empty (logged) rather
 * than blocking the race's results forever. A `void` end builds nothing.
 */
export function buildResults(
  ended: RaceEnded,
  room: EndedRoom,
  { analyse }: ResultsDeps = DEFAULT_DEPS,
): RaceResultsRequest[] {
  // A void race is never persisted (#204).
  if (ended.reason === "void") return [];
  const { reason } = ended;
  const byDesk = new Map(room.desks.map((d) => [d.desk, d]));
  const results = ended.ranking.map((entry): InternalRaceResult => {
    const desk = byDesk.get(entry.desk);
    const state = room.states.get(entry.desk) ?? { ...initialState(), trace: [] };
    const isBot = desk?.isBot ?? entry.isBot;
    const overlay = ("overlay" in state ? state.overlay : null) ?? EMPTY_OVERLAY;
    const ledger = "ledger" in state ? state.ledger : EMPTY_LEDGER;
    const flags = isBot
      ? []
      : analyse({
          keystrokes: state.trace,
          // The text the desk typed: replaying on the base would flag an overlaid desk.
          text: effectiveText(room.text, overlay),
          settings: room.engine,
          recorded: { cursor: state.cursor, correct: state.correct, errors: state.errors },
          timingAnomalies: "timingAnomalies" in state ? state.timingAnomalies : 0,
        });
    let trace = isBot ? EMPTY_TRACE : encodeTrace(state.trace);
    if (trace.data.length > MAX_TRACE_BASE64_LENGTH) {
      log("results trace too large", { race: ended.raceId, desk: entry.desk, count: trace.count });
      trace = EMPTY_TRACE;
    }
    const elapsed = elapsedOf(state, ended.elapsedMs);
    const durationMs = Math.min(MAX_RACE_MS, Math.max(0, Math.round(elapsed)));
    const { clean, adjusted } = cleanAndAdjustedWpm(state, room.text, overlay, elapsed);
    return {
      desk: entry.desk,
      userId: isBot ? null : (desk?.userId ?? null),
      name: entry.name,
      isBot,
      place: entry.place,
      status: entry.status,
      wpm: entry.wpm,
      rawWpm: entry.rawWpm,
      cleanWpm: clean,
      adjustedWpm: adjusted,
      accuracy: entry.accuracy,
      progress: entry.progress,
      correct: state.correct,
      errors: state.errors,
      total: state.total,
      durationMs,
      finishedAtMs: entry.finishedAt,
      bonusesSent: ledger.sent,
      bonusesReceived: ledger.received,
      bonusLog: ledger.log.slice(0, MAX_LOG_ENTRIES).map((e) => ({ ...e })),
      flags,
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
