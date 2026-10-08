import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  accuracy,
  analyseTrace,
  charsOf,
  EMPTY_LEDGER,
  effectiveText,
  elapsedFor,
  ENGINE_VERSION,
  initialState,
  mulberry32,
  normalizeTypeable,
  progress,
  rawWpm,
  record,
  replayTrace,
  wpm,
  type Keystroke,
  type TraceAnalysisInput,
} from "@fifth-copy/engine";

import {
  DEFAULT_RACE_SETTINGS,
  MAX_TRACE_BASE64_LENGTH,
  PROTOCOL_VERSION,
  raceResultsRequestSchema,
  type RaceResultsRequest,
  type RankingEntry,
} from "@fifth-copy/protocol";
import {
  ackResults,
  HOST_SUB,
  startedRace,
  typeKeys,
  until,
  type Booted,
  type Racer,
} from "../testing/harness";
import { deskBonusOf, type DeskState } from "../rooms/desks-state";
import type { RaceEnded } from "../rooms/lifecycle";
import { rankingFor } from "../rooms/ranking";
import { buildResults, encodeTrace, sendResults, type EndedRoom } from "./results";

// #189 C1: one result per desk at race end, figures from the engine, gzip trace.

const RACE_ID = "6f1c2a4e-8b9d-4c3e-9f0a-1b2c3d4e5f60";
const inflate = (data: string) => JSON.parse(gunzipSync(Buffer.from(data, "base64")).toString());

const deskState = (over: Partial<DeskState> = {}): DeskState => ({
  ...initialState(),
  ...deskBonusOf(7),
  lastKeyAt: 0,
  timingAnomalies: 0,
  droppedKeys: 0,
  trace: [],
  ...over,
});

const entry = (desk: number, place: number, isBot = false): RankingEntry => ({
  place,
  desk,
  name: isBot ? `Bot-${desk}` : `Clerk ${desk}`,
  isBot,
  status: "typing",
  wpm: 12.5,
  rawWpm: 14,
  accuracy: 0.9,
  progress: 0.25,
  finishedAt: null,
});

/** The text and engine settings of the unit rooms (`EndedRoom`, #195). */
const ROOM_TEXT = {
  text: "bonjour",
  engine: { errorMode: "continue", backspace: true },
} as const satisfies Pick<EndedRoom, "text" | "engine">;

const ended = (ranking: RankingEntry[], over: Partial<RaceEnded> = {}): RaceEnded => ({
  lobbyId: "lob_1",
  raceId: RACE_ID,
  reason: "timer",
  ranking,
  endedAt: 1_767_225_660_000,
  elapsedMs: 60_000,
  ...over,
});

describe("buildResults (unit)", () => {
  it("a bot has no user and an empty trace; a human keeps its user and trace", () => {
    const trace: Keystroke[] = [
      { t: 10, key: "b" },
      { t: 20, key: "o" },
    ];
    const [request] = buildResults(ended([entry(2, 1), entry(1, 2, true)]), {
      ...ROOM_TEXT,
      desks: [
        { desk: 1, userId: null, name: "Bot-1", isBot: true },
        { desk: 2, userId: "usr_2", name: "Clerk 2", isBot: false },
      ],
      states: new Map([
        [1, deskState({ trace: [{ t: 5, key: "x" }] })],
        [2, deskState({ trace, correct: 2, total: 2, lastT: 20, cursor: 2 })],
      ]),
    });
    const parsed = raceResultsRequestSchema.parse(request);
    expect(parsed).toMatchObject({ v: PROTOCOL_VERSION, raceId: RACE_ID, lobbySize: 2 });
    const [human, bot] = parsed.results;
    expect(human).toMatchObject({ desk: 2, userId: "usr_2", place: 1, correct: 2, total: 2 });
    expect(inflate(human!.trace.data)).toEqual(trace);
    expect(human!.trace.count).toBe(2);
    expect(bot).toMatchObject({ desk: 1, userId: null, isBot: true, place: 2 });
    expect(bot!.trace.count).toBe(0);
    expect(inflate(bot!.trace.data)).toEqual([]);
  });

  it("an abandoned desk keeps its frozen figures: status abandoned, progress 3/7 (#183 C4)", () => {
    // Stored as REASSIGNED by the web (src/features/results/actions/persist-results.ts).
    const text = "bonjour";
    const abandoned: RankingEntry = {
      ...entry(1, 2),
      status: "abandoned",
      progress: progress({ ...initialState(), cursor: 3 }, text.length),
    };
    const trace: Keystroke[] = [...text.slice(0, 3)].map((key, i) => ({ t: 100 * i, key }));
    const [request] = buildResults(ended([entry(2, 1), abandoned]), {
      ...ROOM_TEXT,
      desks: [
        { desk: 1, userId: "usr_1", name: "Clerk 1", isBot: false },
        { desk: 2, userId: "usr_2", name: "Clerk 2", isBot: false },
      ],
      states: new Map([
        [
          1,
          deskState({
            status: "abandoned",
            cursor: 3,
            correct: 3,
            total: 3,
            lastT: 200,
            trace,
          }),
        ],
        [2, deskState()],
      ]),
    });
    const result = raceResultsRequestSchema.parse(request).results.find((r) => r.desk === 1);
    expect(result).toMatchObject({
      status: "abandoned",
      progress: 3 / 7,
      place: 2,
      correct: 3,
      total: 3,
      durationMs: 200,
    });
    expect(inflate(result!.trace.data)).toEqual(trace);
  });

  it("chunks 30 desks into requests of 25 and 5; a void end builds nothing", () => {
    const ranking = Array.from({ length: 30 }, (_, i) => entry(i + 1, i + 1));
    const room = {
      ...ROOM_TEXT,
      desks: ranking.map((e) => ({
        desk: e.desk,
        userId: `u${e.desk}`,
        name: e.name,
        isBot: false,
      })),
      states: new Map<number, DeskState>(),
    };
    const requests = buildResults(ended(ranking), room);
    expect(requests.map((r) => r.results.length)).toEqual([25, 5]);
    expect(requests.every((r) => r.lobbySize === 30)).toBe(true);
    expect(requests.flatMap((r) => r.results.map((x) => x.desk))).toEqual(
      ranking.map((e) => e.desk),
    );
    expect(buildResults(ended(ranking, { reason: "void" }), room)).toEqual([]);
  });

  it("a trace over the wire bound is sent empty instead of blocking the race's results", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    let seed = 7;
    const next = () => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31);
    const trace = Array.from({ length: 120_000 }, () => ({
      t: next() % 3_600_000,
      key: String.fromCharCode(33 + (next() % 94)),
    }));
    expect(encodeTrace(trace).data.length).toBeGreaterThan(MAX_TRACE_BASE64_LENGTH);
    const [request] = buildResults(ended([entry(1, 1)]), {
      ...ROOM_TEXT,
      desks: [{ desk: 1, userId: "u1", name: "Clerk 1", isBot: false }],
      states: new Map([[1, deskState({ trace })]]),
    });
    expect(raceResultsRequestSchema.parse(request).results[0]!.trace.count).toBe(0);
    vi.restoreAllMocks();
  });
});

describe("buildResults flags (#195 C3)", () => {
  // The engine's trace fixtures are data files (read, not imported: packages are consumed by name).
  const fixture = (name: string) =>
    JSON.parse(
      readFileSync(
        new URL(`../../../../packages/engine/src/anticheat/fixtures/${name}.json`, import.meta.url),
        "utf8",
      ),
    ) as TraceAnalysisInput;
  const constant = fixture("scripted-constant");
  const human = fixture("human-1");
  /** A desk whose state is the fixture's recorded counters and trace (what the server applied). */
  const fromFixture = (f: TraceAnalysisInput) =>
    deskState({ ...f.recorded, total: f.keystrokes.length, trace: [...f.keystrokes] });

  it("a human desk with a scripted-constant trace carries regular-rhythm; a bot with the same trace is not analysed", () => {
    const analyse = vi.fn(analyseTrace);
    const [request] = buildResults(
      ended([entry(1, 1), entry(2, 2, true)]),
      {
        text: constant.text,
        engine: constant.settings,
        desks: [
          { desk: 1, userId: "usr_1", name: "Clerk 1", isBot: false },
          { desk: 2, userId: null, name: "Bot-2", isBot: true },
        ],
        states: new Map([
          [1, fromFixture(constant)],
          [2, fromFixture(constant)],
        ]),
      },
      { analyse },
    );
    const [clerk, bot] = raceResultsRequestSchema.parse(request).results;
    expect(clerk).toMatchObject({ desk: 1, flags: [{ code: "regular-rhythm" }] });
    expect(bot).toMatchObject({ desk: 2, isBot: true, flags: [] });
    expect(analyse).toHaveBeenCalledTimes(1);
    expect(analyse.mock.calls[0]![0]).toMatchObject({
      text: constant.text,
      recorded: constant.recorded,
      timingAnomalies: 0,
    });
    expect(analyse.mock.calls[0]![0].keystrokes).toEqual(constant.keystrokes);
  });

  it("a human desk with a human fixture carries no flag; the live anomaly count is analysed", () => {
    const room = (anomalies: number) => ({
      text: human.text,
      engine: human.settings,
      desks: [{ desk: 1, userId: "usr_1", name: "Clerk 1", isBot: false }],
      states: new Map([[1, { ...fromFixture(human), timingAnomalies: anomalies }]]),
    });
    const flagsOf = (anomalies: number) =>
      raceResultsRequestSchema.parse(buildResults(ended([entry(1, 1)]), room(anomalies))[0])
        .results[0]!.flags;
    expect(flagsOf(0)).toEqual([]);
    expect(flagsOf(25)).toMatchObject([{ code: "timing-anomalies" }]);
  });

  it("an oversized trace is analysed as applied, before it is sent empty", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const analyse = vi.fn<typeof analyseTrace>(() => []);
    const trace = Array.from({ length: 120_000 }, (_, i) => ({ t: i, key: "x" }));
    const [request] = buildResults(
      ended([entry(1, 1)]),
      {
        ...ROOM_TEXT,
        desks: [{ desk: 1, userId: "u1", name: "Clerk 1", isBot: false }],
        states: new Map([[1, deskState({ trace })]]),
      },
      { analyse },
    );
    expect(raceResultsRequestSchema.parse(request).results[0]!.trace.count).toBe(0);
    expect(analyse).toHaveBeenCalledTimes(1);
    expect(analyse.mock.calls[0]![0]).toMatchObject({ keystrokes: trace });
    vi.restoreAllMocks();
  });
});

describe("sendResults (unit)", () => {
  const [request] = buildResults(ended([entry(1, 1), entry(2, 2)]), {
    ...ROOM_TEXT,
    desks: [
      { desk: 1, userId: "u1", name: "Clerk 1", isBot: false },
      { desk: 2, userId: "u2", name: "Clerk 2", isBot: false },
    ],
    states: new Map(),
  }) as [RaceResultsRequest];

  it("acknowledges only an answer for the same race covering every desk", async () => {
    expect(await sendResults({ postResults: ackResults })(request)).toBe(true);
    const partial = async (r: RaceResultsRequest) => ({ ...(await ackResults(r)), persisted: [1] });
    expect(await sendResults({ postResults: partial })(request)).toBe(false);
    const other = async (r: RaceResultsRequest) => ({
      ...(await ackResults(r)),
      raceId: randomUUID(),
    });
    expect(await sendResults({ postResults: other })(request)).toBe(false);
    await expect(sendResults({ postResults: ackResults })({ nope: 1 })).rejects.toThrow();
  });
});

let booted: Booted | undefined;
afterEach(async () => {
  await booted?.stop();
  booted = undefined;
});

describe("results at race end over the wire (C1)", () => {
  it("a 3-desk race ending by timer posts 3 results matching the ranking, the engine and the traces", async () => {
    const posted: RaceResultsRequest[] = [];
    const seenEnd: { ended?: RaceEnded; states?: Map<number, DeskState> } = {};
    const holder: { booted?: Booted; lobby?: string } = {};
    const text = "bonjour madame";
    const r = await startedRace(process.env.REDIS_URL, {
      players: 3,
      text,
      settings: { ...DEFAULT_RACE_SETTINGS, timerS: 60 },
      redisPrefix: `t189-results-${randomUUID()}:`,
      postResults: async (request) => {
        posted.push(request);
        return ackResults(request);
      },
      onRaceEnded: (e) => {
        seenEnd.ended = e;
        const states = holder.booted!.server.desks.states(holder.lobby!);
        seenEnd.states = new Map(
          [...states].map(([desk, s]) => [desk, { ...s, trace: [...s.trace] }]),
        );
      },
    });
    booted = r.booted;
    holder.booted = r.booted;
    holder.lobby = r.lobby;
    const [one, two] = r.racers;
    const desks = () => r.booted.server.desks.states(r.lobby);

    typeKeys(one!.client, "bonjour", 100, 50);
    typeKeys(two!.client, "bx", 200, 80);
    await until(() => desks().get(one!.desk)?.trace.length === 7, 2_000, "desk 1 keys");
    await until(() => desks().get(two!.desk)?.trace.length === 2, 2_000, "desk 2 keys");

    r.booted.clock.advance(r.t0 + 60_000 - r.booted.clock.now());
    await until(() => posted.length === 1, 3_000, "results posted");

    const request = raceResultsRequestSchema.parse(posted[0]);
    const { ended: end, states } = seenEnd as Required<typeof seenEnd>;
    expect(request).toMatchObject({
      v: PROTOCOL_VERSION,
      raceId: end.raceId,
      reason: "timer",
      endedAt: end.endedAt,
      lobbySize: 3,
    });
    expect(request.results).toHaveLength(3);
    const textLength = charsOf(normalizeTypeable(text)).length;
    const users = new Map(r.racers.map((x, i) => [x.desk, i === 0 ? HOST_SUB : `usr_p${i}`]));
    for (const result of request.results) {
      const state = states.get(result.desk)!;
      const elapsed = elapsedFor(state, state.status === "typing" ? end.elapsedMs : state.lastT);
      expect(result.place).toBe(end.ranking.find((e) => e.desk === result.desk)!.place);
      expect(result).toMatchObject({
        userId: users.get(result.desk),
        isBot: false,
        status: state.status,
        wpm: wpm(state, elapsed),
        rawWpm: rawWpm(state, elapsed),
        cleanWpm: wpm(state, elapsed),
        adjustedWpm: wpm(state, elapsed),
        accuracy: accuracy(state),
        progress: progress(state, textLength),
        correct: state.correct,
        errors: state.errors,
        total: state.total,
        durationMs: elapsed,
        finishedAtMs: state.finishedAt,
        bonusesSent: 0,
        bonusesReceived: 0,
        bonusLog: [],
        flags: [],
        engineVersion: ENGINE_VERSION,
      });
      expect(inflate(result.trace.data)).toEqual(state.trace);
      expect(result.trace.count).toBe(state.trace.length);
    }
    expect(request.results.find((x) => x.desk === one!.desk)!.trace.count).toBe(7);
    expect(request.results.find((x) => x.desk === two!.desk)!.errors).toBeGreaterThan(0);
  });
});

// #190 C6: clean and adjusted WPM, the bonus counts and log, and the analysis on the effective text.
describe("bonus fields of the results (#190 C6)", () => {
  it("unit: extra words typed -> clean < adjusted; counts and log from the ledger; replayed on the effective text", () => {
    const base = "le formulaire est en triple";
    const overlay = { extra: ["vite", "encore"], removed: [] };
    const text = effectiveText(base, overlay);
    const rng = mulberry32(6);
    let t = 0;
    const trace: Keystroke[] = [...text].map((key) => ({
      t: (t += 120 + Math.floor(rng() * 160)),
      key,
    }));
    const engine = { errorMode: "continue", backspace: true } as const;
    const typed = replayTrace(trace, text, engine);
    expect(typed.status).toBe("finished");
    const hit = { t: 400, kind: "extra-paperwork" as const, from: 2, to: [1] };
    const self = { t: 900, kind: "exemption" as const, from: 2, to: [2] };
    const states = new Map<number, DeskState>([
      [
        1,
        deskState({
          ...typed,
          trace,
          overlay,
          textLength: text.length,
          reach: text.length,
          ledger: record(EMPTY_LEDGER, 1, hit),
        }),
      ],
      [2, deskState({ ledger: record(record(EMPTY_LEDGER, 2, hit), 2, self) })],
    ]);
    const desks = [
      { desk: 1, userId: "usr_1", name: "Clerk 1", isBot: false },
      { desk: 2, userId: "usr_2", name: "Clerk 2", isBot: false },
    ];
    const ranking = rankingFor(desks, states, base.length, 60_000);
    const [request] = buildResults(ended(ranking), { text: base, engine, desks, states });
    const results = raceResultsRequestSchema.parse(request).results;
    const one = results.find((x) => x.desk === 1)!;
    const two = results.find((x) => x.desk === 2)!;

    expect(one.cleanWpm).toBeLessThan(one.adjustedWpm);
    expect(one.adjustedWpm).toBe(one.wpm);
    expect(one.cleanWpm).toBeCloseTo(base.length / 5 / (typed.finishedAt! / 60_000), 9);
    expect(one).toMatchObject({ bonusesSent: 0, bonusesReceived: 1, progress: 1 });
    expect(one.bonusLog).toEqual([{ t: 400, kind: "extra-paperwork", from: 2, to: 1 }]);
    expect(two).toMatchObject({ bonusesSent: 2, bonusesReceived: 0, cleanWpm: 0, adjustedWpm: 0 });
    expect(two.bonusLog).toEqual([
      { t: 400, kind: "extra-paperwork", from: 2, to: 1 },
      { t: 900, kind: "exemption", from: 2, to: 2 },
    ]);
    // Replayed on the base text, the innocent overlaid desk would be "unreproducible".
    expect(one.flags.map((f) => f.code)).not.toContain("unreproducible");
    const onBase = analyseTrace({
      keystrokes: trace,
      text: base,
      settings: engine,
      recorded: { cursor: typed.cursor, correct: typed.correct, errors: typed.errors },
      timingAnomalies: 0,
    });
    expect(onBase.map((f) => f.code)).toContain("unreproducible");
  });

  it("over the wire: the leader hit by extra-paperwork types its effective text; clean < adjusted, counts and log match the events", async () => {
    const posted: RaceResultsRequest[] = [];
    const text = "un deux trois quatre cinq six sept huit";
    const r = await startedRace(process.env.REDIS_URL, {
      players: 4,
      text,
      settings: { ...DEFAULT_RACE_SETTINGS, timerS: 60 },
      rng: mulberry32(3),
      redisPrefix: `t190-results-${randomUUID()}:`,
      postResults: async (request) => {
        posted.push(request);
        return ackResults(request);
      },
    });
    booted = r.booted;
    const [one, two, three] = r.racers as [Racer, Racer, Racer, Racer];
    const desks = () => r.booted.server.desks.states(r.lobby);
    typeKeys(one.client, text.slice(0, 10), 0);
    typeKeys(two.client, text.slice(0, 6), 0);
    typeKeys(three.client, text.slice(0, 2), 0);
    await until(() => desks().get(three.desk)?.cursor === 2, 2_000, "typed");
    await until(() => desks().get(one.desk)?.cursor === 10, 2_000, "typed one");
    r.booted.clock.advance(100);
    await until(() => desks().get(three.desk)?.held?.kind === "extra-paperwork", 2_000, "dealt");
    three.client.emit("bonus:play", { v: PROTOCOL_VERSION });
    await until(() => desks().get(one.desk)?.overlay !== null, 2_000, "hit");
    const overlay = desks().get(one.desk)!.overlay!;
    const rest = effectiveText(text, overlay).slice(10);
    typeKeys(one.client, rest, 200, 37);
    await until(() => desks().get(one.desk)?.status === "finished", 2_000, "leader finished");

    r.booted.clock.advance(r.t0 + 60_000 - r.booted.clock.now());
    await until(() => posted.length === 1, 3_000, "results posted");
    const results = raceResultsRequestSchema.parse(posted[0]).results;
    const leader = results.find((x) => x.desk === one.desk)!;
    const sender = results.find((x) => x.desk === three.desk)!;
    expect(leader.cleanWpm).toBeLessThan(leader.adjustedWpm);
    expect(leader).toMatchObject({
      bonusesReceived: 1,
      bonusesSent: 0,
      status: "finished",
      progress: 1,
    });
    const entry = { t: 100, kind: "extra-paperwork", from: three.desk, to: one.desk };
    expect(leader.bonusLog).toEqual([entry]);
    expect(sender).toMatchObject({ bonusesSent: 1, bonusesReceived: 0, bonusLog: [entry] });
    expect(results.find((x) => x.desk === two.desk)).toMatchObject({
      bonusesSent: 0,
      bonusLog: [],
    });
    expect(leader.flags.map((f) => f.code)).not.toContain("unreproducible");
  });
});
