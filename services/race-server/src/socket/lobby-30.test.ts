import { afterEach, describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "@fifth-copy/protocol";
import { boot, connectError, HOST_SUB, track, until, type Booted } from "../testing/harness";

// Spec 5.2 proof: one waiting room holds 30 players and every one of them sees all 30. Server-side
// socket.io-client sockets against the real server on an ephemeral port and real Redis, no browser.
let t: Booted | undefined;
afterEach(async () => {
  await t?.stop();
  t = undefined;
});

const desks = (roster: { desk: number }[] | undefined) => (roster ?? []).map((m) => m.desk);
const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("lobby of 30 (C5)", () => {
  it("every client's latest roster lists 30 members on desks 1..30, then 25 after 5 leave", async () => {
    t = await boot(process.env.REDIS_URL);
    const lobby = await t.openRoom();
    const tokens = await Promise.all(
      range(30).map((i) => t!.token({ lobby, sub: `usr_${i}_${lobby}`, name: `Player ${i}` })),
    );
    const clients = tokens.map((token) => t!.connect({ v: PROTOCOL_VERSION, token }));
    const seen = clients.map(track);

    await until(() => seen.every((s) => s.roster?.length === 30), 10_000, "30 rosters of 30");
    for (const s of seen) expect(desks(s.roster)).toEqual(range(30));
    expect(new Set(seen.map((s) => s.welcome?.you)).size).toBe(30);

    for (const c of clients.slice(0, 5)) c.disconnect();
    const stay = seen.slice(5);
    await until(() => stay.every((s) => s.roster?.length === 25), 5_000, "25 rosters of 25");
    const remaining = new Set(stay.map((s) => s.welcome!.you));
    for (const s of stay) expect(new Set(desks(s.roster))).toEqual(remaining);
  }, 20_000);

  it("#876 C3 with the host watching, 30 typists are seated, the 31st is refused room-full; START needs 2 desks; the race holds no host desk", async () => {
    t = await boot(process.env.REDIS_URL);
    const lobby = await t.openRoom();
    const host = t.connect({
      v: PROTOCOL_VERSION,
      token: await t.token({ lobby, sub: HOST_SUB, name: "Teacher", role: "host" }),
    });
    const seenHost = track(host);
    await until(() => seenHost.welcome?.you === 1, 5_000, "host seated");
    const ack = await host
      .timeout(2_000)
      .emitWithAck("host:settings", { v: PROTOCOL_VERSION, patch: { hostWatches: true } });
    expect(ack).toMatchObject({ ok: true });
    const start = () => host.timeout(5_000).emitWithAck("host:start", { v: PROTOCOL_VERSION });

    const first = t.connect({
      v: PROTOCOL_VERSION,
      token: await t.token({ lobby, sub: `usr_1_${lobby}`, name: "Player 1" }),
    });
    await until(() => seenHost.roster?.length === 1, 5_000, "one typist");
    expect(await start()).toEqual({ ok: false, error: "too-few" });

    const tokens = await Promise.all(
      range(29).map((i) =>
        t!.token({ lobby, sub: `usr_${i + 1}_x_${lobby}`, name: `Player ${i + 2}` }),
      ),
    );
    const clients = [first, ...tokens.map((token) => t!.connect({ v: PROTOCOL_VERSION, token }))];
    await until(() => seenHost.roster?.length === 30, 10_000, "30 typists");
    expect(desks(seenHost.roster)).toEqual(range(30));
    expect(seenHost.roster?.some((m) => m.isHost)).toBe(false);

    const late = t.connect({
      v: PROTOCOL_VERSION,
      token: await t.token({ lobby, sub: `usr_late_${lobby}`, name: "Late" }),
    });
    expect(await connectError(late)).toBe("room-full");

    expect(await start()).toMatchObject({ ok: true });
    const room = await t.server.registry.room(lobby);
    expect(room?.desks).toHaveLength(30);
    expect(room?.desks?.some((d) => d.userId === HOST_SUB)).toBe(false);
    expect(clients).toHaveLength(30);
  }, 20_000);
});
