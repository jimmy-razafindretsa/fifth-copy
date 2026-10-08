import { afterEach, describe, expect, it } from "vitest";
import { charsOf, mulberry32, wordsOf, type BonusKind } from "@fifth-copy/engine";
import {
  DEFAULT_RACE_SETTINGS,
  PROTOCOL_VERSION,
  type RaceEvent,
  type RaceSettings,
} from "@fifth-copy/protocol";
import {
  startedRace,
  typeKeys,
  until,
  watchRace,
  type Booted,
  type Racer,
} from "../testing/harness";
import { BOT_HOLD_MS } from "./bonus-step";

// #190 C3-C5: catch-up bonuses over the wire (real Redis, fake clock and scheduler, seeded rng;
// ADR 0006, 0007, 0008, 0016). Desks 1-4 type 10, 8, 4 and 0 characters at GO, so the live order
// is 1, 2, 3, 4: desk 4 (rankPct 1) is dealt smoke-break, desk 3 (0.67 > 2/3) extra-paperwork.
let booted: Booted | undefined;
afterEach(async () => {
  await booted?.stop();
  booted = undefined;
});

const v = PROTOCOL_VERSION;
const TEXT =
  "un deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze quinze seize";
const LENGTH = charsOf(TEXT).length;

const kinds = <K extends RaceEvent["kind"]>(r: Racer, kind: K) =>
  r.seen.events.filter((e): e is Extract<RaceEvent, { kind: K }> => e.kind === kind);

const stateOf = (b: Booted, lobby: string, desk: number) => b.server.desks.states(lobby).get(desk)!;

/** Advances to `ms` since GO in steps of at most 1 s and waits for `who`'s snapshot of that tick. */
async function at(b: Booted, t0: number, ms: number, who: Racer) {
  const target = t0 + ms;
  if (b.clock.now() >= target) throw new Error(`clock already past +${ms}`);
  while (b.clock.now() < target) {
    b.clock.advance(Math.min(1_000, target - b.clock.now()));
    await new Promise((r) => setImmediate(r));
  }
  await until(() => (who.seen.snapshots.at(-1)?.t ?? -1) >= ms, 2_000, `snapshot at +${ms}`);
}

/** Four desks after GO, typed 10/8/4/0 (or `cursors`), ranked 1, 2, 3, 4. */
async function fourDesks(settings: RaceSettings = DEFAULT_RACE_SETTINGS, cursors = [10, 8, 4, 0]) {
  const race = await startedRace(process.env.REDIS_URL, {
    players: cursors.length,
    text: TEXT,
    settings,
    rng: mulberry32(190),
  });
  booted = race.booted;
  const { booted: b, lobby } = race;
  race.racers.forEach((r, i) => {
    if (cursors[i]! > 0) typeKeys(r.client, TEXT.slice(0, cursors[i]), 0);
  });
  await until(
    () => race.racers.every((r, i) => stateOf(b, lobby, r.desk).cursor === cursors[i]),
    2_000,
    "typed",
  );
  return race;
}

const play = (r: Racer) => r.client.emit("bonus:play", { v });

/** Gives `desk` the card `kind` (the test seam the presence and idle tests use). */
function hold(b: Booted, lobby: string, desk: number, kind: BonusKind) {
  const state = stateOf(b, lobby, desk);
  b.server.desks.set(lobby, desk, { ...state, held: { kind, since: b.clock.now() } });
}

describe("eligibility by live rank (C3)", () => {
  it("the last of 4 is dealt smoke-break within one tick; the leader and rank 2 (0.33) never", async () => {
    const race = await fourDesks();
    const { booted: b, t0 } = race;
    const [one, two, three, four] = race.racers as [Racer, Racer, Racer, Racer];
    await at(b, t0, 100, four);
    await until(() => (three.seen.snapshots.at(-1)?.t ?? -1) >= 100, 2_000, "three at 100");
    expect(kinds(four, "bonus-earned")).toEqual([
      { v, kind: "bonus-earned", desk: four.desk, bonus: "smoke-break" },
    ]);
    expect(kinds(three, "bonus-earned")).toEqual([
      { v, kind: "bonus-earned", desk: three.desk, bonus: "extra-paperwork" },
    ]);
    await at(b, t0, 2_000, one);
    await until(() => (two.seen.snapshots.at(-1)?.t ?? -1) >= 2_000, 2_000, "two at 2 s");
    expect(kinds(one, "bonus-earned")).toEqual([]);
    expect(kinds(two, "bonus-earned")).toEqual([]);
    // Holding a card: no second deal.
    expect(kinds(four, "bonus-earned")).toHaveLength(1);
  });

  it("settings.bonuses false: nobody is dealt a card and bonus:play is rejected no-bonus", async () => {
    const race = await fourDesks({ ...DEFAULT_RACE_SETTINGS, bonuses: false });
    const { booted: b, t0 } = race;
    const four = race.racers[3]!;
    await at(b, t0, 1_000, four);
    for (const r of race.racers) expect(kinds(r, "bonus-earned")).toEqual([]);
    play(four);
    await until(() => four.seen.rejected.length === 1, 2_000, "rejected");
    expect(four.seen.rejected).toEqual([{ v, reason: "no-bonus" }]);
    expect(race.racers.flatMap((r) => kinds(r, "bonus-sent"))).toEqual([]);
  });
});

describe("effects over the wire (C4)", () => {
  it("extra-paperwork: bonus-sent to the room, the leader's bonus-hit has 5 extra words, its next welcome carries the overlay", async () => {
    const race = await fourDesks();
    const { booted: b, lobby, t0 } = race;
    const [one, , three] = race.racers as [Racer, Racer, Racer, Racer];
    await at(b, t0, 100, three);
    play(three);
    await until(() => kinds(one, "bonus-hit").length === 1, 2_000, "leader hit");
    const sent = { v, kind: "bonus-sent", from: three.desk, to: [one.desk], bonus: "extra-paperwork" };
    for (const r of race.racers) {
      await until(() => kinds(r, "bonus-sent").length === 1, 2_000, `sent to ${r.desk}`);
      expect(kinds(r, "bonus-sent")).toEqual([sent]);
    }
    const [hit] = kinds(one, "bonus-hit");
    expect(hit).toMatchObject({ desk: one.desk, bonus: "extra-paperwork", blurUntil: null });
    expect(hit!.overlay!.removed).toEqual([]);
    expect(hit!.overlay!.extra).toHaveLength(5);
    for (const word of hit!.overlay!.extra) expect(wordsOf(TEXT)).toContain(word);
    expect(kinds(three, "bonus-hit")).toEqual([]);
    // The leader's text grew: progress is over the effective length.
    expect(stateOf(b, lobby, one.desk).textLength).toBe(
      LENGTH + hit!.overlay!.extra.join(" ").length + 1,
    );

    const tab = b.connect({ v, token: one.token });
    const second = watchRace(tab);
    await until(() => !!second.welcome, 2_000, "second tab welcome");
    expect(second.welcome).toMatchObject({ you: one.desk, overlay: hit!.overlay });
    // Everyone else's welcome still has no overlay.
    expect(race.racers[1]!.seen.welcome!.overlay).toBeNull();
  });

  it("exemption: the sender's bonus-hit removes 5 base words and its next snapshot rank jumps", async () => {
    const race = await fourDesks();
    const { booted: b, lobby, t0 } = race;
    const [one, two] = race.racers as [Racer, Racer, Racer, Racer];
    await at(b, t0, 100, two);
    expect(two.seen.snapshots.at(-1)!.ranks.slice(0, 2)).toEqual([one.desk, two.desk]);
    hold(b, lobby, two.desk, "exemption");
    play(two);
    await until(() => kinds(two, "bonus-hit").length === 1, 2_000, "exemption hit");
    // "un deux |trois": the cursor word is "trois" (2); quatre..huit (3-7) go.
    expect(kinds(two, "bonus-hit")).toEqual([
      {
        v,
        kind: "bonus-hit",
        desk: two.desk,
        bonus: "exemption",
        overlay: { extra: [], removed: [3, 4, 5, 6, 7] },
        blurUntil: null,
      },
    ]);
    await until(() => kinds(one, "bonus-sent").length === 1, 2_000, "sent");
    expect(kinds(one, "bonus-sent")).toEqual([
      { v, kind: "bonus-sent", from: two.desk, to: [two.desk], bonus: "exemption" },
    ]);
    expect(stateOf(b, lobby, two.desk)).toMatchObject({
      cursor: 8,
      textLength: LENGTH - "quatre cinq six sept huit ".length,
    });
    // 8 / 62 > 10 / 88: desk 2 now leads the live order.
    await at(b, t0, 200, two);
    expect(two.seen.snapshots.at(-1)!.ranks.slice(0, 2)).toEqual([two.desk, one.desk]);
    // The rest of its text: typed on the effective text, it finishes at its effective end.
    const rest = "trois neuf dix onze douze treize quatorze quinze seize";
    typeKeys(two.client, rest, 200);
    await until(() => stateOf(b, lobby, two.desk).status === "finished", 2_000, "finished");
    expect(stateOf(b, lobby, two.desk)).toMatchObject({ correct: 8 + rest.length, errors: 0 });
  });

  it("smoke-break: every desk ahead gets bonus-hit with blurUntil = now + 5000 and no overlay", async () => {
    const race = await fourDesks();
    const { booted: b, lobby, t0 } = race;
    const [one, two, three, four] = race.racers as [Racer, Racer, Racer, Racer];
    await at(b, t0, 100, four);
    play(four);
    for (const r of [one, two, three]) {
      await until(() => kinds(r, "bonus-hit").length === 1, 2_000, `hit ${r.desk}`);
      expect(kinds(r, "bonus-hit")).toEqual([
        { v, kind: "bonus-hit", desk: r.desk, bonus: "smoke-break", overlay: null, blurUntil: 5_100 },
      ]);
      expect(stateOf(b, lobby, r.desk)).toMatchObject({
        blurUntil: 5_100,
        overlay: null,
        lastHitBy: "smoke-break",
      });
    }
    await until(() => kinds(four, "bonus-sent").length === 1, 2_000, "sent");
    expect(kinds(four, "bonus-sent")).toEqual([
      { v, kind: "bonus-sent", from: four.desk, to: [one.desk, two.desk, three.desk], bonus: "smoke-break" },
    ]);
    expect(kinds(four, "bonus-hit")).toEqual([]);
    expect(stateOf(b, lobby, four.desk)).toMatchObject({ held: null, lastPlayedAt: 100 });
  });
});

describe("cooldown, immunity, bots (C5)", () => {
  it("a second play within 15 s is rejected and the card kept; accepted at 15 s; the same kind on the same target twice is refused", async () => {
    // Desk 1 far ahead: 5 extra words do not cost it the lead (30 / 113 > 8 / 88).
    const race = await fourDesks(DEFAULT_RACE_SETTINGS, [30, 8, 4, 0]);
    const { booted: b, lobby, t0 } = race;
    const [one, , , four] = race.racers as [Racer, Racer, Racer, Racer];
    await at(b, t0, 100, four);
    play(four);
    await until(() => kinds(four, "bonus-sent").length === 1, 2_000, "first play");

    // Dealt again on the next tick (still last), but within the cooldown.
    await at(b, t0, 200, four);
    expect(kinds(four, "bonus-earned")).toHaveLength(2);
    hold(b, lobby, four.desk, "extra-paperwork");
    play(four);
    await until(() => four.seen.rejected.length === 1, 2_000, "cooldown refusal");
    expect(four.seen.rejected).toEqual([{ v, reason: "no-bonus" }]);
    expect(stateOf(b, lobby, four.desk).held?.kind).toBe("extra-paperwork");

    await at(b, t0, 15_000, four);
    play(four);
    await until(() => four.seen.rejected.length === 2, 2_000, "still cooling at +15.0 s - 100 ms");
    await at(b, t0, 15_100, four);
    play(four);
    await until(() => kinds(one, "bonus-hit").length === 2, 2_000, "accepted at 15 s");
    expect(kinds(one, "bonus-hit")[1]).toMatchObject({ bonus: "extra-paperwork" });
    expect(stateOf(b, lobby, four.desk)).toMatchObject({ lastPlayedAt: 15_100 });

    // Immunity: the leader was last hit by extra-paperwork; the same kind again is refused.
    await at(b, t0, 30_200, four);
    hold(b, lobby, four.desk, "extra-paperwork");
    play(four);
    await until(() => four.seen.rejected.length === 3, 2_000, "immunity refusal");
    expect(four.seen.rejected.at(-1)).toEqual({ v, reason: "no-bonus" });
    expect(stateOf(b, lobby, four.desk).held?.kind).toBe("extra-paperwork");
    expect(kinds(one, "bonus-hit")).toHaveLength(2);
    // Another kind still lands on it.
    hold(b, lobby, four.desk, "smoke-break");
    play(four);
    await until(() => kinds(one, "bonus-hit").length === 3, 2_000, "another kind");
  });

  it("a bot holding a card for 3 s plays it automatically", async () => {
    const race = await fourDesks(
      { ...DEFAULT_RACE_SETTINGS, bots: [{ level: "clerk" }] },
      [10, 8, 4],
    );
    const { booted: b, lobby, t0 } = race;
    const one = race.racers[0]!;
    const bot = b.server.desks.get(lobby)!.desks.find((d) => d.isBot)!.desk;
    await at(b, t0, 100, one);
    expect(stateOf(b, lobby, bot).held).toEqual({ kind: "smoke-break", since: t0 + 100 });
    await at(b, t0, 100 + BOT_HOLD_MS - 100, one);
    expect(kinds(one, "bonus-sent")).toEqual([]);
    await at(b, t0, 100 + BOT_HOLD_MS, one);
    await until(() => kinds(one, "bonus-sent").length === 1, 2_000, "bot played");
    expect(kinds(one, "bonus-sent")[0]).toMatchObject({ from: bot, bonus: "smoke-break" });
    expect(kinds(one, "bonus-hit")).toEqual([
      { v, kind: "bonus-hit", desk: one.desk, bonus: "smoke-break", overlay: null, blurUntil: 8_100 },
    ]);
  });
});

describe("the bonus:play edge refuses what it should", () => {
  it("before GO is before-go; a malformed payload is dropped; no card is no-bonus; a finished desk is no-bonus", async () => {
    const race = await startedRace(process.env.REDIS_URL, {
      players: 3,
      text: "abc def",
      go: false,
      rng: mulberry32(1),
    });
    booted = race.booted;
    const { booted: b, lobby, t0 } = race;
    const [one, two] = race.racers as [Racer, Racer, Racer];
    play(two);
    await until(() => two.seen.rejected.length === 1, 2_000, "before-go");
    expect(two.seen.rejected).toEqual([{ v, reason: "before-go" }]);

    b.clock.advance(t0 - b.clock.now());
    await until(() => b.server.desks.get(lobby)?.phase === "running", 3_000, "GO");
    two.client.emit("bonus:play", { v: 999 } as never);
    two.client.emit("bonus:play", "x" as never);
    play(one); // holds nothing: no-bonus
    await until(() => one.seen.rejected.length === 1, 2_000, "no card");
    expect(one.seen.rejected).toEqual([{ v, reason: "no-bonus" }]);
    expect(two.seen.rejected).toHaveLength(1);

    typeKeys(one.client, "abc def", 0);
    await until(() => stateOf(b, lobby, one.desk).status === "finished", 2_000, "finished");
    hold(b, lobby, one.desk, "exemption");
    play(one);
    await until(() => one.seen.rejected.length === 2, 2_000, "finished refusal");
    expect(one.seen.rejected[1]).toEqual({ v, reason: "no-bonus" });
    expect(race.racers.flatMap((r) => kinds(r, "bonus-sent"))).toEqual([]);
  });
});
