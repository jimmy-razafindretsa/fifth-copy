import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_RACE_SETTINGS,
  PROTOCOL_VERSION,
  welcomeSchema,
  type RaceResultsRequest,
} from "@fifth-copy/protocol";
import {
  ackResults,
  boot,
  HOST_SUB,
  reachGo,
  textWebApi,
  typeKeys,
  until,
  watchRace,
  type Booted,
  type Client,
  type RaceSeen,
} from "../testing/harness";
import { TICK_MS } from "../rooms/tick";

// #187: the spectator channel (ADR 0006 point 8, ARCHITECTURE 7.8). Real Redis, fake clock, real
// socket.io-client sockets against the server on an ephemeral port.
let t: Booted | undefined;
afterEach(async () => {
  await t?.stop();
  t = undefined;
});

const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));
type Seat = { client: Client; seen: RaceSeen; token: string };

/** A waiting room with the host (desk 1) and `players - 1` players seated; results recorded. */
async function room(players = 2, text = "bonjour") {
  const results: RaceResultsRequest[] = [];
  t = await boot(process.env.REDIS_URL, {
    webApi: textWebApi(text, (request) => {
      results.push(request);
      return ackResults(request);
    }),
  });
  const booted = t;
  const lobby = await booted.openRoom();
  const seat = async (sub: string, role: "host" | "player" | "spectator"): Promise<Seat> => {
    const token = await booted.token({ lobby, sub, name: `N ${sub.slice(-6)}`, role });
    const client = booted.connect({ v: PROTOCOL_VERSION, token });
    const seen = watchRace(client);
    await until(() => !!seen.welcome, 5_000, `welcome ${sub}`);
    return { client, seen, token };
  };
  const seats: Seat[] = [];
  for (let i = 0; i < players; i++) {
    seats.push(await seat(i === 0 ? HOST_SUB : `usr_p${i}_${lobby}`, i === 0 ? "host" : "player"));
  }
  await until(() => seats.every((s) => s.seen.roster?.length === players), 5_000, "seated");
  const spectate = (sub = `usr_watch_${Math.random()}`) => seat(sub, "spectator");
  const start = () =>
    seats[0]!.client.timeout(2_000).emitWithAck("host:start", { v: PROTOCOL_VERSION });
  return { booted, lobby, seats, seat, spectate, start, results };
}

/** One tick of the fake clock, then a real pause for the sockets to deliver. */
async function tick(booted: Booted, n = 1) {
  for (let i = 0; i < n; i++) {
    booted.clock.advance(TICK_MS);
    await settle(30);
  }
}

describe("spectator welcome and membership (C2)", () => {
  it("welcome { spectator, you: null } lists both members; the roster stays at 2", async () => {
    const r = await room();
    const [host, player] = r.seats;
    const rostersBefore = [host!.seen.rosters, player!.seen.rosters];
    const watch = await r.spectate();
    const welcome = welcomeSchema.parse(watch.seen.welcome);
    expect(welcome).toMatchObject({
      role: "spectator",
      you: null,
      room: { code: "KGB-4821", phase: "waiting" },
      state: null,
      overlay: null,
      resumeKey: null,
    });
    expect(welcome.members.map((m) => m.desk)).toEqual([1, 2]);
    await settle();
    expect([host!.seen.rosters, player!.seen.rosters]).toEqual(rostersBefore);
    expect(host!.seen.roster).toHaveLength(2);
    expect(await r.booted.server.registry.members(r.lobby)).toHaveLength(2);
    expect(r.booted.server.io.sockets.adapter.rooms.get(`lobby:${r.lobby}`)?.size).toBe(2);
  });

  it("too-few with one player and a spectator; ok once a second player is back", async () => {
    const r = await room();
    const watch = await r.spectate();
    r.seats[1]!.client.disconnect();
    await until(() => r.seats[0]!.seen.roster?.length === 1, 3_000, "player left");
    // The spectator hears the roster too (projector list).
    await until(() => watch.seen.roster?.length === 1, 3_000, "spectator roster");
    expect(await r.start()).toEqual({ ok: false, error: "too-few" });

    await r.seat(`usr_back_${r.lobby}`, "player");
    await until(() => r.seats[0]!.seen.roster?.length === 2, 3_000, "player back");
    expect(await r.start()).toMatchObject({ ok: true });
  });

  it("a spectator token is admitted to a running room it is not a member of", async () => {
    const r = await room();
    await r.start();
    await reachGo(r.booted, r.lobby, r.booted.clock.now() + 3_000);
    const late = await r.spectate();
    expect(late.seen.welcome).toMatchObject({ role: "spectator", you: null });
    expect(late.seen.welcome?.room.phase).toBe("running");
    expect(late.seen.welcome?.race?.text).toBe("bonjour");
    expect(await r.booted.server.registry.members(r.lobby)).toHaveLength(2);
  });
});

const countdowns = new Map<Seat, number>();
function countCountdowns(s: Seat) {
  countdowns.set(s, 0);
  s.client.on("countdown", () => void countdowns.set(s, (countdowns.get(s) ?? 0) + 1));
}

describe("fan-out to spectators (C3)", () => {
  it("countdown, >= 9 snapshots per fake second deep-equal to a player's, events and ended", async () => {
    const r = await room();
    const [host, player] = r.seats;
    const watch = await r.spectate();
    countCountdowns(watch);
    countCountdowns(host!);
    expect((await r.start()).ok).toBe(true);
    await until(() => countdowns.get(watch) === 1, 3_000, "spectator countdown");
    await reachGo(r.booted, r.lobby, r.booted.clock.now() + 3_000);

    const from = watch.seen.snapshots.length;
    await tick(r.booted, 10);
    await until(() => watch.seen.snapshots.length - from >= 9, 3_000, "9 snapshots in 1 s");

    // Desk 1 types first, then desk 2 passes it: overtake, passed and new-leader.
    typeKeys(host!.client, "bo", 900, 10);
    await until(() => r.booted.server.desks.states(r.lobby).get(1)?.cursor === 2, 2_000, "d1");
    await tick(r.booted);
    typeKeys(player!.client, "bonj", 1_000, 10);
    await until(() => r.booted.server.desks.states(r.lobby).get(2)?.cursor === 4, 2_000, "d2");
    await tick(r.booted, 2);
    const kinds = (s: Seat) => s.seen.events.map((e) => e.kind);
    await until(() => kinds(watch).includes("new-leader"), 2_000, "spectator new-leader");
    expect(watch.seen.events).toEqual(
      expect.arrayContaining([
        { v: PROTOCOL_VERSION, kind: "overtake", desk: 2, passed: 1 },
        { v: PROTOCOL_VERSION, kind: "passed", desk: 1, by: 2 },
        { v: PROTOCOL_VERSION, kind: "new-leader", desk: 2 },
      ]),
    );

    // Both finish: the race ends for everyone.
    typeKeys(player!.client, "our", 1_300, 10);
    typeKeys(host!.client, "njour", 1_300, 10);
    for (let i = 0; i < 20 && watch.seen.ended.length === 0; i++) await tick(r.booted);
    await until(() => watch.seen.ended.length === 1, 3_000, "spectator ended");
    await until(() => host!.seen.ended.length === 1, 3_000, "host ended");
    expect(watch.seen.ended).toEqual(host!.seen.ended);

    // Same `t`, same snapshot: both were there from the start, so the streams are identical (a
    // `t` may repeat on the final snapshot, so compare the sequences, not a map by `t`).
    expect(watch.seen.snapshots.length).toBeGreaterThanOrEqual(9);
    expect(watch.seen.snapshots).toEqual(host!.seen.snapshots);
  }, 20_000);
});

describe("spectator refusals (C4)", () => {
  it("keys, abandon, bonus:play -> rejected { spectator }; host:start/settings -> not-host", async () => {
    const r = await room();
    const watch = await r.spectate();
    const ack = await watch.client
      .timeout(2_000)
      .emitWithAck("host:start", { v: PROTOCOL_VERSION });
    expect(ack).toEqual({ ok: false, error: "not-host" });
    expect((await r.start()).ok).toBe(true);
    await reachGo(r.booted, r.lobby, r.booted.clock.now() + 3_000);

    const before = structuredClone([...r.booted.server.desks.states(r.lobby).entries()]);
    typeKeys(watch.client, "bonjour", 10, 1);
    watch.client.emit("abandon", { v: PROTOCOL_VERSION });
    watch.client.emit("bonus:play", { v: PROTOCOL_VERSION });
    // Malformed payloads are parsed first and dropped: no reply at all.
    watch.client.emit("keys", { v: PROTOCOL_VERSION, batch: "nope" } as never);
    watch.client.emit("abandon", { v: 999 } as never);
    watch.client.emit("bonus:play", "x" as never);
    await until(() => watch.seen.rejected.length >= 3, 2_000, "rejected");
    await settle();
    // One per well-formed message (keys, abandon, bonus:play), none for the malformed ones.
    expect(watch.seen.rejected).toEqual(
      Array.from({ length: 3 }, () => ({ v: PROTOCOL_VERSION, reason: "spectator" })),
    );
    expect([...r.booted.server.desks.states(r.lobby).entries()]).toEqual(before);
    expect(r.booted.server.desks.states(r.lobby).size).toBe(2);
  });

  it("never in ended.ranking nor in the results posted to the web (lobbySize 2)", async () => {
    const r = await room();
    const [host, player] = r.seats;
    const watch = await r.spectate();
    expect((await r.start()).ok).toBe(true);
    await reachGo(r.booted, r.lobby, r.booted.clock.now() + 3_000);
    await tick(r.booted, 3);
    typeKeys(host!.client, "bonjour", 100, 10);
    typeKeys(player!.client, "bonjour", 120, 10);
    for (let i = 0; i < 20 && watch.seen.ended.length === 0; i++) await tick(r.booted);
    await until(() => watch.seen.ended.length === 1, 3_000, "ended");
    expect(watch.seen.ended[0]!.ranking.map((e) => e.desk).sort()).toEqual([1, 2]);
    await until(() => r.results.length === 1, 3_000, "results posted");
    expect(r.results[0]).toMatchObject({ lobbySize: 2 });
    expect(r.results[0]!.results.map((x) => x.desk).sort()).toEqual([1, 2]);
  }, 15_000);
});

describe("a spectator carrying the host's own sub (host's projector tab)", () => {
  it("cannot change settings, start, shadow or evict the host's desk, nor type", async () => {
    const r = await room();
    const [host] = r.seats;
    const hostRosters = host!.seen.rosters;
    const tab = await r.spectate(HOST_SUB);
    expect(tab.seen.welcome).toMatchObject({ role: "spectator", you: null });

    const patch = { v: PROTOCOL_VERSION, patch: { bots: [{ level: "clerk" }] } };
    const settingsAck = await tab.client
      .timeout(2_000)
      .emitWithAck("host:settings", patch as never);
    expect(settingsAck).toEqual({ ok: false, error: "not-host" });
    expect(await r.booted.server.registry.settings(r.lobby)).toEqual(DEFAULT_RACE_SETTINGS);
    expect(
      await tab.client.timeout(2_000).emitWithAck("host:start", { v: PROTOCOL_VERSION }),
    ).toEqual({ ok: false, error: "not-host" });
    expect(r.booted.server.presence.sockets(r.lobby, HOST_SUB)).toBe(1);

    // Closing the projector tab leaves the host seated, with no roster broadcast.
    tab.client.disconnect();
    await settle(300);
    expect(await r.booted.server.registry.members(r.lobby)).toHaveLength(2);
    expect(host!.seen.rosters).toBe(hostRosters);

    // During the race: the tab's keys never reach desk 1, and closing it is not a line cut.
    const tab2 = await r.spectate(HOST_SUB);
    expect((await r.start()).ok).toBe(true);
    await reachGo(r.booted, r.lobby, r.booted.clock.now() + 3_000);
    typeKeys(tab2.client, "bon", 10, 1);
    await until(() => tab2.seen.rejected.length === 1, 2_000, "rejected");
    expect(tab2.seen.rejected[0]!.reason).toBe("spectator");
    expect(r.booted.server.desks.states(r.lobby).get(1)?.cursor).toBe(0);
    tab2.client.disconnect();
    await tick(r.booted, 2);
    expect(r.booted.server.presence.sockets(r.lobby, HOST_SUB)).toBe(1);
    expect(r.booted.server.desks.states(r.lobby).get(1)?.status).toBe("typing");
    expect(host!.seen.events.filter((e) => e.kind === "line-cut")).toEqual([]);
  }, 15_000);
});

describe("disconnect and scale (C5)", () => {
  it("a spectator leaving during running emits no line-cut and no roster", async () => {
    const r = await room();
    const [host, player] = r.seats;
    const watch = await r.spectate();
    expect((await r.start()).ok).toBe(true);
    await reachGo(r.booted, r.lobby, r.booted.clock.now() + 3_000);
    const rosters = [host!.seen.rosters, player!.seen.rosters];
    watch.client.disconnect();
    await tick(r.booted, 3);
    await settle(200);
    expect([host!.seen.rosters, player!.seen.rosters]).toEqual(rosters);
    for (const s of [host!, player!]) {
      expect(s.seen.events.filter((e) => e.kind === "line-cut")).toEqual([]);
    }
  });

  it("50 spectators and 30 players all hold the same snapshot after one tick", async () => {
    const r = await room(30);
    const watchers: Seat[] = [];
    for (let i = 0; i < 50; i++) watchers.push(await r.spectate(`usr_w${i}_${r.lobby}`));
    expect((await r.start()).ok).toBe(true);
    await reachGo(r.booted, r.lobby, r.booted.clock.now() + 3_000);
    const everyone = [...r.seats, ...watchers];
    const counts = everyone.map((s) => s.seen.snapshots.length);
    r.booted.clock.advance(TICK_MS);
    await until(
      () => everyone.every((s, i) => s.seen.snapshots.length > counts[i]!),
      10_000,
      "80 snapshots",
    );
    const reference = r.seats[0]!.seen.snapshots.at(-1)!;
    for (const s of everyone) expect(s.seen.snapshots.at(-1)).toEqual(reference);
    expect(reference.desks).toHaveLength(30);
    expect(await r.booted.server.registry.members(r.lobby)).toHaveLength(30);
  }, 30_000);
});
