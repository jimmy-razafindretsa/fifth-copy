import { describe, expect, it } from "vitest";
import { cleanAndAdjustedWpm, EMPTY_OVERLAY, type TextOverlay } from "@fifth-copy/engine";
import {
  DEFAULT_RACE_SETTINGS,
  PLAYER_STATUS_CODES,
  PROTOCOL_VERSION,
  roomCodeSchema,
  type Member,
  type Snapshot,
  type Welcome,
} from "@fifth-copy/protocol";
import { initialRaceState, reduceRace, type RaceEvent, type RaceState } from "../client/store";
import { selectFinishWpm, selectPlace, selectRemaining, selectWpm } from "./counters";

// Contract of #225 C1: the nixie's two numbers as pure selectors over the race store. WPM is the
// engine's clean WPM (ADR 0016) of your predicted state over the corrected clock (#214: device clock +
// `clockOffset`, minus `race.t0`), rounded; `0` before GO; frozen at your finishing key (the engine's
// `finishedAt`). Place is your index in the last snapshot's `ranks`, `0` before the first one, out of the
// seated typists.

const SERVER_NOW = 1_767_225_600_000;
/** The device clock runs 2 s behind the server's: the selector must add the offset. */
const SKEW = 2_000;
const T0 = SERVER_NOW + 3_000;
const TEXT = "ab cd ef gh";

const member = (desk: number, name: string): Member => ({
  desk,
  name,
  isHost: desk === 1,
  isBot: false,
  color: desk - 1,
  marker: "circle",
});

const welcome = (over: Partial<Welcome> = {}): Welcome => ({
  v: PROTOCOL_VERSION,
  role: "player",
  you: 2,
  room: { code: roomCodeSchema.parse("KGB-4821"), phase: "waiting" },
  members: [member(1, "Sparrow-137"), member(2, "Lynx-785")],
  settings: DEFAULT_RACE_SETTINGS,
  race: null,
  state: null,
  overlay: null,
  resumeKey: null,
  serverNow: SERVER_NOW,
  ...over,
});

const RACE = {
  raceId: "3b241101-e2bb-4255-8caf-4136c566a962",
  text: TEXT,
  language: "en" as const,
  wordCount: 4,
  t0: T0,
  timerS: DEFAULT_RACE_SETTINGS.timerS,
};

const run = (...events: RaceEvent[]) => events.reduce(reduceRace, initialRaceState);
const key = (k: string, t: number): RaceEvent => ({ type: "key", keystroke: { t, key: k } });
const keys = (chars: string, from: number, step = 100) =>
  Array.from(chars).map((c, i) => key(c, from + i * step));
const snapshot = (desks: Snapshot["desks"], ranks: number[], t = 500): RaceEvent => ({
  type: "snapshot",
  payload: { v: PROTOCOL_VERSION, t, desks, ranks },
});

const seated = (w = welcome()) =>
  run({ type: "welcome", payload: w, receivedAt: SERVER_NOW - SKEW });
const counting = (w?: Welcome) =>
  reduceRace(seated(w), { type: "countdown", payload: { v: PROTOCOL_VERSION, race: RACE } });
const running = (w?: Welcome) => reduceRace(counting(w), { type: "go" });
/** The device clock at `ms` after GO (server clock = device clock + SKEW). */
const at = (ms: number) => T0 - SKEW + ms;

/** The engine's figure for a state, the one formula (ADR 0007, 0016). */
const engine = (s: RaceState, elapsed: number, overlay: TextOverlay = EMPTY_OVERLAY) =>
  Math.round(cleanAndAdjustedWpm(s.prediction!.state, TEXT, overlay, elapsed).clean);

describe("selectWpm (#225 C1)", () => {
  it("is 0 before the welcome, while waiting, during the countdown and for a spectator", () => {
    expect(selectWpm(initialRaceState, at(5_000))).toBe(0);
    expect(selectWpm(seated(), at(5_000))).toBe(0);
    // the countdown already holds your prediction; the clock past t0 must not count before GO
    expect(selectWpm(counting(), at(5_000))).toBe(0);
    const spectator = running(welcome({ role: "spectator", you: null }));
    expect(spectator.prediction).toBeNull();
    expect(selectWpm(spectator, at(5_000))).toBe(0);
  });

  it("is 0 at GO before any key", () => {
    expect(selectWpm(running(), at(0))).toBe(0);
    expect(selectWpm(running(), at(3_000))).toBe(0);
  });

  it("is the engine's clean WPM of the predicted state over the corrected clock, rounded", () => {
    const s = keys("ab cd", 100).reduce(reduceRace, running());
    expect(s.prediction!.state.correct).toBe(5);
    // 5 correct chars = 1 word in 6 s on the server clock = 10 WPM
    expect(selectWpm(s, at(6_000))).toBe(10);
    expect(selectWpm(s, at(6_000))).toBe(engine(s, 6_000));
    // rounded to an integer: 1 word in 7 s = 8.57 WPM
    expect(selectWpm(s, at(7_000))).toBe(9);
    expect(Number.isInteger(selectWpm(s, at(7_123)))).toBe(true);
    // the device clock alone (no offset) would read 2 s more of race and a lower figure
    expect(selectWpm(s, at(6_000))).not.toBe(engine(s, 8_000));
  });

  it("counts only base-text characters when an Extra Paperwork overlay adds words (ADR 0016)", () => {
    const overlay: TextOverlay = { extra: ["xy"], removed: [] };
    const s = keys(`${TEXT} x`, 100).reduce(reduceRace, running(welcome({ overlay })));
    expect(s.prediction!.text).toBe(`${TEXT} xy`);
    expect(s.prediction!.state.status).toBe("typing");
    const { clean, adjusted } = cleanAndAdjustedWpm(s.prediction!.state, TEXT, overlay, 6_000);
    expect(clean).not.toBe(adjusted);
    expect(selectWpm(s, at(6_000))).toBe(Math.round(clean));
  });

  it("freezes at your finishing key (the engine's finishedAt), however late the clock reads", () => {
    const s = keys(TEXT, 100).reduce(reduceRace, running());
    const { status, finishedAt } = s.prediction!.state;
    expect(status).toBe("finished");
    expect(finishedAt).toBe(100 + (TEXT.length - 1) * 100);
    const final = selectWpm(s, at(finishedAt!));
    expect(final).toBe(engine(s, finishedAt!));
    expect(final).toBeGreaterThan(0);
    expect(selectWpm(s, at(finishedAt! + 30_000))).toBe(final);
    expect(selectWpm(s, at(finishedAt! + 600_000))).toBe(final);
  });

  it("keeps the finish when a snapshot confirms it, and stops at the last key for a stopped desk", () => {
    // the keys left in batches before the server could confirm them (#559 `sent`)
    const done = reduceRace(keys(TEXT, 100).reduce(reduceRace, running()), {
      type: "sent",
      count: TEXT.length,
    });
    const finishedAt = done.prediction!.state.finishedAt!;
    const { cursor, correct, errors, total } = done.prediction!.state;
    const confirmed = reduceRace(
      done,
      snapshot(
        [
          [1, 0, 0, 0, PLAYER_STATUS_CODES.typing, 0],
          [2, cursor, correct, errors, PLAYER_STATUS_CODES.finished, total],
        ],
        [2, 1],
        finishedAt + 100,
      ),
    );
    expect(selectWpm(confirmed, at(finishedAt + 60_000))).toBe(selectWpm(done, at(finishedAt)));

    // a desk the server stopped (reassigned): the figure holds at its last key, idle time never counts
    const partial = reduceRace(keys("ab cd", 100).reduce(reduceRace, running()), {
      type: "sent",
      count: 5,
    });
    const p = partial.prediction!.state;
    const stopped = reduceRace(
      partial,
      snapshot(
        [[2, p.cursor, p.correct, p.errors, PLAYER_STATUS_CODES.abandoned, p.total]],
        [2],
        3_000,
      ),
    );
    expect(stopped.prediction!.state.status).toBe("abandoned");
    const lastT = stopped.prediction!.state.lastT;
    expect(selectWpm(stopped, at(lastT + 50_000))).toBe(engine(stopped, lastT));
  });
});

describe("selectPlace (#225 C1)", () => {
  it("is place 0 before the first snapshot, out of the seated typists", () => {
    expect(selectPlace(initialRaceState)).toEqual({ place: 0, total: 0 });
    expect(selectPlace(seated())).toEqual({ place: 0, total: 2 });
    expect(selectPlace(running())).toEqual({ place: 0, total: 2 });
  });

  it("is your index in the last snapshot's ranks, 1 = leading", () => {
    const typing = PLAYER_STATUS_CODES.typing;
    const behind = reduceRace(
      running(),
      snapshot(
        [
          [1, 3, 3, 0, typing, 3],
          [2, 0, 0, 0, typing, 0],
        ],
        [1, 2],
      ),
    );
    expect(selectPlace(behind)).toEqual({ place: 2, total: 2 });
    const ahead = reduceRace(
      behind,
      snapshot(
        [
          [1, 3, 3, 0, typing, 3],
          [2, 4, 4, 0, typing, 4],
        ],
        [2, 1],
        600,
      ),
    );
    expect(selectPlace(ahead)).toEqual({ place: 1, total: 2 });
    // the last ranks stand between snapshots: a key moves no place
    expect(selectPlace(reduceRace(ahead, key("a", 700)))).toEqual({ place: 1, total: 2 });
  });

  it("a spectator has no place; a new countdown clears the ranks", () => {
    const spectator = reduceRace(
      running(welcome({ role: "spectator", you: null })),
      snapshot([[1, 0, 0, 0, PLAYER_STATUS_CODES.typing, 0]], [1]),
    );
    expect(selectPlace(spectator)).toEqual({ place: 0, total: 2 });
    const ranked = reduceRace(running(), snapshot([[2, 0, 0, 0, 0, 0]], [2, 1]));
    expect(selectPlace(ranked).place).toBe(1);
    const again = reduceRace(ranked, {
      type: "countdown",
      payload: { v: PROTOCOL_VERSION, race: RACE },
    });
    expect(selectPlace(again)).toEqual({ place: 0, total: 2 });
  });
});

// Contract of #240 C1: the timer tube's seconds. `null` without a timer; otherwise the seconds left to
// `race.t0 + race.timerS` on the corrected clock (#214), rounded up, never below 0 nor above `timerS`
// (before GO), frozen at the race end once the server ended it. The WPM stops at the end too.
describe("selectRemaining (#240 C1)", () => {
  const TIMER_S = 60;
  const timed = welcome({ settings: { ...DEFAULT_RACE_SETTINGS, timerS: TIMER_S } });
  const timedRace = { ...RACE, timerS: TIMER_S };
  const countingTimed = () =>
    reduceRace(seated(timed), {
      type: "countdown",
      payload: { v: PROTOCOL_VERSION, race: timedRace },
    });
  const runningTimed = () => reduceRace(countingTimed(), { type: "go" });
  const ended = (s: RaceState, deviceAt: number, reason: "timer" | "all-finished" = "timer") =>
    reduceRace(s, {
      type: "ended",
      payload: { v: PROTOCOL_VERSION, raceId: RACE.raceId, reason, ranking: [] },
      at: deviceAt,
    });

  it("is null without a timer, before any race and for a race with timerS null", () => {
    expect(selectRemaining(initialRaceState, at(0))).toBeNull();
    expect(selectRemaining(seated(timed), at(0))).toBeNull();
    expect(running().race!.timerS).toBeNull();
    expect(selectRemaining(running(), at(5_000))).toBeNull();
  });

  it("counts down from t0 + timerS on the corrected clock, rounded up to whole seconds", () => {
    const s = runningTimed();
    expect(selectRemaining(s, at(0))).toBe(60);
    expect(selectRemaining(s, at(1))).toBe(60);
    expect(selectRemaining(s, at(999))).toBe(60);
    expect(selectRemaining(s, at(1_000))).toBe(59);
    expect(selectRemaining(s, at(30_500))).toBe(30);
    expect(selectRemaining(s, at(59_001))).toBe(1);
    expect(selectRemaining(s, at(60_000))).toBe(0);
    // the device clock alone (no offset) would read 2 s more left
    expect(selectRemaining(s, at(10_000))).toBe(50);
  });

  it("never reads below 0 and never above timerS before GO", () => {
    expect(selectRemaining(runningTimed(), at(75_000))).toBe(0);
    expect(selectRemaining(countingTimed(), at(-3_000))).toBe(60);
  });

  it("freezes at the race end once the server ended it", () => {
    // ended early (all finished) 20.2 s after GO: the tube holds 40 whatever the clock reads later
    const early = ended(runningTimed(), at(20_200), "all-finished");
    expect(early.phase).toBe("ended");
    expect(selectRemaining(early, at(20_200))).toBe(40);
    expect(selectRemaining(early, at(90_000))).toBe(40);
    // the timer's own end arrives a little late: still 0, never negative
    const timeUp = ended(runningTimed(), at(60_150));
    expect(selectRemaining(timeUp, at(61_000))).toBe(0);
    // a timer end read a little early on this device's offset estimate is still the timer's end: 0
    const early2 = ended(runningTimed(), at(59_400));
    expect(selectRemaining(early2, at(59_400))).toBe(0);
  });

  it("selectWpm stops at the race end: a typing desk's figure no longer drifts after RACE OVER", () => {
    const typing = keys("ab cd", 100).reduce(reduceRace, runningTimed());
    expect(typing.prediction!.state.status).toBe("typing");
    const over = ended(typing, at(6_000), "all-finished");
    expect(selectWpm(over, at(6_000))).toBe(engine(typing, 6_000));
    expect(selectWpm(over, at(30_000))).toBe(engine(typing, 6_000));
    // the end is capped at the timer: an `ended` that arrives late counts no more than timerS
    const late = ended(typing, at(65_000));
    expect(selectWpm(late, at(70_000))).toBe(engine(typing, 60_000));
  });

  it("selectFinishWpm is your frozen finish figure, the stamp's and the tube's one formula", () => {
    expect(selectFinishWpm(running())).toBe(0);
    const s = keys(TEXT, 100).reduce(reduceRace, running());
    const { finishedAt } = s.prediction!.state;
    expect(selectFinishWpm(s)).toBe(engine(s, finishedAt!));
    expect(selectFinishWpm(s)).toBe(selectWpm(s, at(finishedAt! + 10_000)));
  });
});
