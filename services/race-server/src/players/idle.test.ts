import type { Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  PLAYER_STATUS_CODES,
  PROTOCOL_VERSION,
  type RaceEvent,
  type RaceResultsRequest,
} from "@fifth-copy/protocol";
import type { RaceEnded } from "../rooms/lifecycle";
import {
  ackResults,
  connectRedis,
  startedRace,
  typeKeys,
  until,
  watchRace,
  type Booted,
  type Racer,
} from "../testing/harness";

// #183: idle warning at 45 s, kick (asleep) at 60 s, abandon (Reassigned), over the wire (real
// Redis, fake clock and scheduler; ADR 0006, 0007, 0008; ARCHITECTURE 7.1, 7.4). Socket-level: this
// is the card's e2e (the Playwright scenario lands with #233).
let booted: Booted | undefined;
let redis: Redis;
beforeAll(async () => {
  redis = await connectRedis(process.env.REDIS_URL);
});
afterEach(async () => {
  await booted?.stop();
  booted = undefined;
});
afterAll(() => redis.disconnect());

const v = PROTOCOL_VERSION;
const kinds = (r: Racer, kind: RaceEvent["kind"], desk?: number) =>
  r.seen.events.filter(
    (e) => e.kind === kind && (desk === undefined || ("desk" in e && e.desk === desk)),
  );

/** The desk's `[desk, cursor, correct, errors, statusCode]` in the latest snapshot. */
const lastRow = (r: Racer, desk: number) =>
  r.seen.snapshots.at(-1)?.desks.find((d) => d[0] === desk);

const stateOf = (b: Booted, lobby: string, desk: number) => b.server.desks.states(lobby).get(desk);

async function cursorReached(b: Booted, lobby: string, desk: number, cursor: number) {
  await until(() => stateOf(b, lobby, desk)?.cursor === cursor, 2_000, `desk ${desk} at ${cursor}`);
}

/**
 * Advances the fake clock to `ms` since GO (ticks fire along the way, in steps of at most 1 s) and
 * waits until `who` received that tick's snapshot: the events of a tick precede its snapshot on
 * the socket, so everything the tick emitted has arrived.
 */
async function at(b: Booted, t0: number, ms: number, who: Racer) {
  const target = t0 + ms;
  if (b.clock.now() >= target) throw new Error(`clock already past +${ms}`);
  while (b.clock.now() < target) {
    b.clock.advance(Math.min(1_000, target - b.clock.now()));
    await new Promise((r) => setImmediate(r));
  }
  await until(() => (who.seen.snapshots.at(-1)?.t ?? -1) >= ms, 2_000, `snapshot at +${ms}`);
}

/** Advances the fake clock to `ms` since GO in 1 s steps, without waiting for a snapshot. */
async function stepTo(b: Booted, t0: number, ms: number) {
  while (b.clock.now() < t0 + ms) {
    b.clock.advance(Math.min(1_000, t0 + ms - b.clock.now()));
    await new Promise((r) => setImmediate(r));
  }
}

const abandon = (r: Racer) => r.client.emit("abandon", { v });

describe("idle warning and kick (C1)", () => {
  it("warns the room at +45 s with kickAt in race ms, kicks at +60 s; desk 2 typed at +30 s is warned at +75 s", async () => {
    const race = await startedRace(process.env.REDIS_URL, { players: 2 });
    booted = race.booted;
    const { booted: b, lobby, t0 } = race;
    const [one, two] = race.racers as [Racer, Racer];
    typeKeys(one.client, "b", 0);
    await cursorReached(b, lobby, one.desk, 1);
    const lastKeyAt = stateOf(b, lobby, one.desk)!.lastKeyAt;

    await at(b, t0, 30_000, one);
    typeKeys(two.client, "b", 30_000);
    await cursorReached(b, lobby, two.desk, 1);

    await at(b, t0, 44_900, one);
    await until(() => (two.seen.snapshots.at(-1)?.t ?? -1) >= 44_900, 2_000, "two at 44.9");
    expect(kinds(one, "idle-warning")).toHaveLength(0);
    expect(kinds(two, "idle-warning")).toHaveLength(0);

    await at(b, t0, 45_000, one);
    await until(() => (two.seen.snapshots.at(-1)?.t ?? -1) >= 45_000, 2_000, "two at 45");
    const warning = { v, kind: "idle-warning", desk: one.desk, kickAt: lastKeyAt - t0 + 60_000 };
    expect(warning.kickAt).toBe(60_000);
    expect(kinds(one, "idle-warning")).toEqual([warning]);
    expect(kinds(two, "idle-warning")).toEqual([warning]);

    await at(b, t0, 59_900, one);
    expect(kinds(one, "asleep")).toHaveLength(0);
    expect(stateOf(b, lobby, one.desk)?.status).toBe("typing");

    await at(b, t0, 60_000, one);
    await until(() => (two.seen.snapshots.at(-1)?.t ?? -1) >= 60_000, 2_000, "two at 60");
    expect(kinds(one, "asleep")).toEqual([{ v, kind: "asleep", desk: one.desk }]);
    expect(kinds(two, "asleep")).toEqual([{ v, kind: "asleep", desk: one.desk }]);
    expect(lastRow(two, one.desk)?.[4]).toBe(PLAYER_STATUS_CODES.asleep);
    expect(lastRow(two, one.desk)?.[1]).toBe(1);
    // Still one warning for desk 1; none for desk 2 yet.
    expect(kinds(two, "idle-warning")).toEqual([warning]);

    await at(b, t0, 74_900, one);
    expect(kinds(one, "idle-warning", two.desk)).toHaveLength(0);
    await at(b, t0, 75_000, one);
    expect(kinds(one, "idle-warning", two.desk)).toEqual([
      { v, kind: "idle-warning", desk: two.desk, kickAt: 90_000 },
    ]);
  });
});

describe("a keystroke clears the warning (C2)", () => {
  it("a key at +50 s after the warning: no asleep at +60 s, one warning per silence, the next at +95 s", async () => {
    const race = await startedRace(process.env.REDIS_URL, { players: 2 });
    booted = race.booted;
    const { booted: b, lobby, t0 } = race;
    const [one] = race.racers as [Racer, Racer];
    typeKeys(one.client, "b", 0);
    await cursorReached(b, lobby, one.desk, 1);

    await at(b, t0, 49_900, one);
    expect(kinds(one, "idle-warning", one.desk)).toHaveLength(1);
    await at(b, t0, 50_000, one);
    typeKeys(one.client, "o", 50_000);
    await cursorReached(b, lobby, one.desk, 2);

    await at(b, t0, 60_000, one);
    expect(kinds(one, "asleep", one.desk)).toHaveLength(0);
    expect(stateOf(b, lobby, one.desk)?.status).toBe("typing");

    await at(b, t0, 94_900, one);
    expect(kinds(one, "idle-warning", one.desk)).toHaveLength(1);
    await at(b, t0, 95_000, one);
    expect(kinds(one, "idle-warning", one.desk)).toEqual([
      { v, kind: "idle-warning", desk: one.desk, kickAt: 60_000 },
      { v, kind: "idle-warning", desk: one.desk, kickAt: 110_000 },
    ]);
    await at(b, t0, 110_000, one);
    expect(kinds(one, "asleep", one.desk)).toHaveLength(1);
    expect(kinds(one, "idle-warning", one.desk)).toHaveLength(2);
  });
});

describe("disconnection is not idle (C3)", () => {
  it("line-cut from +10 s to +80 s: no warning, no asleep; resumed at +80 s, warned at +125 s", async () => {
    const race = await startedRace(process.env.REDIS_URL, { players: 2 });
    booted = race.booted;
    const { booted: b, lobby, t0 } = race;
    const [host, player] = race.racers as [Racer, Racer];
    typeKeys(player.client, "b", 0);
    await cursorReached(b, lobby, player.desk, 1);
    const key = player.seen.welcome!.resumeKey!;

    await at(b, t0, 10_000, host);
    player.client.disconnect();
    await until(() => kinds(host, "line-cut").length === 1, 2_000, "line-cut");

    await at(b, t0, 80_000, host);
    expect(stateOf(b, lobby, player.desk)?.status).toBe("line-cut");
    expect(kinds(host, "idle-warning", player.desk)).toHaveLength(0);
    expect(kinds(host, "asleep", player.desk)).toHaveLength(0);

    const back = b.connect({ v, token: player.token, resumeKey: key });
    const again: Racer = { ...player, client: back, seen: watchRace(back) };
    await until(() => kinds(host, "resumed").length === 1, 2_000, "resumed");
    expect(stateOf(b, lobby, player.desk)).toMatchObject({
      status: "typing",
      lastKeyAt: t0 + 80_000,
    });

    await at(b, t0, 124_900, host);
    expect(kinds(host, "idle-warning", player.desk)).toHaveLength(0);
    await at(b, t0, 125_000, host);
    const warning = { v, kind: "idle-warning", desk: player.desk, kickAt: 140_000 };
    expect(kinds(host, "idle-warning", player.desk)).toEqual([warning]);
    await until(() => kinds(again, "idle-warning").length > 0, 2_000, "resumed tab warned");
    expect(kinds(again, "idle-warning", player.desk)).toEqual([warning]);
  });
});

describe("abandon (C4)", () => {
  it("Reassigned keeps cursor 3, ignores later keys, ranks last after expired 4 and asleep 2; result abandoned 3/7", async () => {
    const posted: RaceResultsRequest[] = [];
    const race = await startedRace(process.env.REDIS_URL, {
      players: 3,
      postResults: async (request) => {
        posted.push(request);
        return ackResults(request);
      },
    });
    booted = race.booted;
    const { booted: b, lobby, t0 } = race;
    const [quitter, cut, sleeper] = race.racers as [Racer, Racer, Racer];
    typeKeys(quitter.client, "bon", 0);
    typeKeys(cut.client, "bonj", 0);
    typeKeys(sleeper.client, "bo", 0);
    await cursorReached(b, lobby, quitter.desk, 3);
    await cursorReached(b, lobby, cut.desk, 4);
    await cursorReached(b, lobby, sleeper.desk, 2);
    cut.client.disconnect();
    await until(() => kinds(sleeper, "line-cut").length === 1, 2_000, "line-cut");

    // A malformed abandon is dropped silently.
    quitter.client.emit("abandon", { v: v - 1 } as never);
    await at(b, t0, 1_000, sleeper);
    expect(kinds(sleeper, "abandoned")).toHaveLength(0);
    expect(quitter.seen.rejected).toHaveLength(0);

    abandon(quitter);
    await until(() => kinds(sleeper, "abandoned").length === 1, 2_000, "abandoned");
    expect(kinds(sleeper, "abandoned")).toEqual([{ v, kind: "abandoned", desk: quitter.desk }]);
    await until(() => kinds(quitter, "abandoned").length === 1, 2_000, "abandoned to the sender");
    await at(b, t0, 1_100, sleeper);
    expect(lastRow(sleeper, quitter.desk)).toEqual([
      quitter.desk,
      3,
      3,
      0,
      PLAYER_STATUS_CODES.abandoned,
    ]);

    // Later keys change nothing; a second abandon is refused.
    typeKeys(quitter.client, "jour", 1_100);
    abandon(quitter);
    await until(() => quitter.seen.rejected.length === 1, 2_000, "rejected");
    expect(quitter.seen.rejected).toEqual([{ v, reason: "not-running" }]);
    await at(b, t0, 1_200, sleeper);
    expect(stateOf(b, lobby, quitter.desk)).toMatchObject({ cursor: 3, status: "abandoned" });
    expect(lastRow(sleeper, quitter.desk)?.[1]).toBe(3);
    expect(kinds(sleeper, "abandoned")).toHaveLength(1);

    // Asleep at +60 s; the line-cut desk expires at +120 s: every desk is terminal.
    await at(b, t0, 60_000, sleeper);
    expect(kinds(sleeper, "asleep", sleeper.desk)).toHaveLength(1);
    await stepTo(b, t0, 122_000);
    await until(() => sleeper.seen.ended.length === 1, 3_000, "ended");
    const ended = sleeper.seen.ended[0]!;
    expect(ended.reason).toBe("all-finished");
    expect(ended.ranking.map((r) => [r.desk, r.status])).toEqual([
      [cut.desk, "expired"],
      [sleeper.desk, "asleep"],
      [quitter.desk, "abandoned"],
    ]);
    expect(ended.ranking.at(-1)?.progress).toBeCloseTo(3 / 7);

    // The result #189 builds for it: engine status `abandoned` (stored as REASSIGNED by the web).
    await until(() => posted.length === 1, 3_000, "results posted");
    expect(posted[0]!.results.find((r) => r.desk === quitter.desk)).toMatchObject({
      status: "abandoned",
      progress: 3 / 7,
      correct: 3,
      place: 3,
    });
  });

  it("abandon during the countdown is not-running", async () => {
    const race = await startedRace(process.env.REDIS_URL, { players: 2, go: false });
    booted = race.booted;
    const [host] = race.racers as [Racer, Racer];
    abandon(host);
    await until(() => host.seen.rejected.length === 1, 2_000, "rejected");
    expect(host.seen.rejected).toEqual([{ v, reason: "not-running" }]);
    expect(kinds(host, "abandoned")).toHaveLength(0);
  });
});

describe("both exits end the race (C5)", () => {
  async function finishedAndOther() {
    const reasons: RaceEnded["reason"][] = [];
    const race = await startedRace(process.env.REDIS_URL, {
      players: 2,
      onRaceEnded: (e) => void reasons.push(e.reason),
    });
    booted = race.booted;
    const [one, two] = race.racers as [Racer, Racer];
    typeKeys(one.client, "bonjour", 0);
    await until(
      () => stateOf(race.booted, race.lobby, one.desk)?.status === "finished",
      2_000,
      "finished",
    );
    return { ...race, one, two, reasons };
  }

  it("finished + abandoned: ended all-finished once", async () => {
    const { booted: b, one, two, reasons } = await finishedAndOther();
    abandon(two);
    await until(() => one.seen.ended.length === 1, 3_000, "ended");
    expect(one.seen.ended[0]!.reason).toBe("all-finished");
    b.clock.advance(2_000);
    await new Promise((r) => setTimeout(r, 100));
    expect(one.seen.ended).toHaveLength(1);
    expect(reasons).toEqual(["all-finished"]);
  });

  it("finished + kicked: ended all-finished once at +60 s", async () => {
    const { booted: b, t0, one, reasons } = await finishedAndOther();
    await stepTo(b, t0, 60_000);
    await until(() => one.seen.ended.length === 1, 3_000, "ended");
    expect(one.seen.ended[0]!.reason).toBe("all-finished");
    b.clock.advance(2_000);
    await new Promise((r) => setTimeout(r, 100));
    expect(one.seen.ended).toHaveLength(1);
    expect(reasons).toEqual(["all-finished"]);
  });
});
