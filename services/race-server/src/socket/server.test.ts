import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RACE_SETTINGS,
  deskIdentity,
  PROTOCOL_VERSION,
  type RaceSettings,
  welcomeSchema,
} from "@fifth-copy/protocol";
import {
  boot,
  connectError,
  postRoomType,
  SECRET,
  startedRace,
  track,
  until,
  WAIT_MS,
  type Booted,
  type Racer,
} from "../testing/harness";
import { internalHeaders } from "../http/sign";

let t: Booted | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await t?.stop();
  t = undefined;
});

const ada = { desk: 1, name: "Ada", isHost: false, isBot: false, color: 0, marker: "circle" };

describe("waiting room over Socket.IO (C1)", () => {
  it("welcomes a joiner with its desk, rosters both on join and the first on leave", async () => {
    t = await boot(process.env.REDIS_URL);
    const lobby = await t.openRoom();
    const a = t.connect({ v: PROTOCOL_VERSION, token: await t.token({ lobby, name: "Ada" }) });
    const seenA = track(a);
    await until(() => !!seenA.welcome, 2_000, "welcome A");
    expect(seenA.welcome).toEqual({
      v: PROTOCOL_VERSION,
      role: "player",
      you: 1,
      room: { code: "KGB-4821", phase: "waiting" },
      members: [ada],
      settings: DEFAULT_RACE_SETTINGS,
      race: null,
      state: null,
      overlay: null,
      bonus: null,
      // #178: every welcome carries the user's resume key (32 random bytes hex).
      resumeKey: expect.stringMatching(/^[0-9a-f]{64}$/),
      serverNow: t.clock.now(),
      autoStartAt: null,
    });

    const b = t.connect({ v: PROTOCOL_VERSION, token: await t.token({ lobby, name: "Bob" }) });
    const seenB = track(b);
    await until(() => seenA.roster?.length === 2 && seenB.roster?.length === 2, 2_000, "roster 2");
    expect(seenB.welcome?.you).toBe(2);
    expect(seenB.welcome?.members.map((m) => m.name)).toEqual(["Ada", "Bob"]);

    b.disconnect();
    await until(() => seenA.roster?.length === 1, 2_000, "roster 1");
    expect(seenA.roster).toEqual([ada]);
    expect(await t.server.registry.members(lobby)).toHaveLength(1);
  });

  it("welcomes a joiner with the settings the room was opened with over POST /internal/rooms (#568 C5)", async () => {
    t = await boot(process.env.REDIS_URL);
    const lobbyId = t.lobby();
    const settings: RaceSettings = {
      ...DEFAULT_RACE_SETTINGS,
      bots: [{ level: "major" }],
      timerS: 120,
    };
    const body = JSON.stringify({
      v: PROTOCOL_VERSION,
      lobbyId,
      code: "KGB-4821",
      hostUserId: "usr_host",
      settings,
    });
    const res = await fetch(`${t.url}/internal/rooms`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...internalHeaders({ rawBody: body, secret: SECRET, nowMs: t.clock.now() }),
      },
      body,
    });
    expect(res.status).toBe(200);
    const host = track(
      t.connect({
        v: PROTOCOL_VERSION,
        token: await t.token({ lobby: lobbyId, sub: "usr_host", role: "host" }),
      }),
    );
    await until(() => !!host.welcome, 2_000, "host welcome");
    const seen = track(
      t.connect({ v: PROTOCOL_VERSION, token: await t.token({ lobby: lobbyId }) }),
    );
    // The settings' one bot is seated at open on desk 2 (#156): the player takes desk 3.
    await until(() => !!seen.welcome && host.roster?.length === 3, 2_000, "welcome");
    expect(seen.welcome?.settings).toEqual(settings);

    // #557 C4: the v4 welcome parses, carries the token role, no race yet, the server clock.
    for (const [who, role, you] of [
      [host, "host", 1],
      [seen, "player", 3],
    ] as const) {
      const welcome = who.welcome!;
      expect(welcomeSchema.safeParse(welcome).success).toBe(true);
      expect(welcome).toMatchObject({
        role,
        you,
        room: { phase: "waiting" },
        race: null,
        state: null,
        overlay: null,
        bonus: null,
        resumeKey: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      expect(Math.abs(welcome.serverNow - t.clock.now())).toBeLessThanOrEqual(1_000);
    }
    for (const member of [...seen.welcome!.members, ...host.roster!]) {
      expect(member).toMatchObject({ isBot: member.desk === 2, ...deskIdentity(member.desk) });
    }
    expect(host.roster?.find((m) => m.desk === 1)?.isHost).toBe(true);
  });

  it("two sockets of one user share a desk, released only when the last disconnects", async () => {
    t = await boot(process.env.REDIS_URL);
    const lobby = await t.openRoom();
    const watcher = track(t.connect({ v: PROTOCOL_VERSION, token: await t.token({ lobby }) }));
    await until(() => !!watcher.welcome, 2_000, "watcher welcome");
    const token = await t.token({ lobby, sub: "usr_twice", name: "Twice" });
    const tab1 = t.connect({ v: PROTOCOL_VERSION, token });
    const seen1 = track(tab1);
    await until(() => !!seen1.welcome, 2_000, "tab1 welcome");
    const tab2 = t.connect({ v: PROTOCOL_VERSION, token });
    const seen2 = track(tab2);
    await until(() => !!seen2.welcome, 2_000, "tab2 welcome");
    expect(seen2.welcome?.you).toBe(seen1.welcome?.you);
    expect(seen2.welcome?.members).toHaveLength(2);

    tab1.disconnect();
    await new Promise((r) => setTimeout(r, 200));
    expect(await t.server.registry.members(lobby)).toHaveLength(2);
    tab2.disconnect();
    await until(() => watcher.roster?.length === 1, 2_000, "watcher roster 1");
  });
});

describe("handshake rejections over the wire (C2)", () => {
  it.each([
    ["version", async (b: Booted, lobby: string) => ({ v: 1, token: await b.token({ lobby }) })],
    [
      "bad-token",
      async (b: Booted, lobby: string) => ({
        v: PROTOCOL_VERSION,
        token: await b.token({ lobby }, "w".repeat(40)),
      }),
    ],
    ["bad-token", async () => ({ v: PROTOCOL_VERSION })],
    [
      "no-room",
      async (b: Booted) => ({
        v: PROTOCOL_VERSION,
        token: await b.token({ lobby: b.lobby(), role: "spectator" }),
      }),
    ],
    [
      "no-room",
      async (b: Booted) => ({ v: PROTOCOL_VERSION, token: await b.token({ lobby: b.lobby() }) }),
    ],
  ] as const)("refuses with %s and leaves the roster unchanged", async (reason, auth) => {
    t = await boot(process.env.REDIS_URL);
    const lobby = await t.openRoom();
    const client = t.connect(await auth(t, lobby));
    expect(await connectError(client)).toBe(reason);
    expect(await t.server.registry.members(lobby)).toEqual([]);
  });
});

describe("logs (C4)", () => {
  it("never print the secret or the race token", async () => {
    const lines: string[] = [];
    for (const level of ["log", "info", "warn", "error"] as const) {
      vi.spyOn(console, level).mockImplementation(
        (...args: unknown[]) => void lines.push(args.map(String).join(" ")),
      );
    }
    t = await boot(process.env.REDIS_URL);
    const lobby = await t.openRoom();
    const token = await t.token({ lobby });
    const ok = track(t.connect({ v: PROTOCOL_VERSION, token }));
    await until(() => !!ok.welcome, 2_000, "welcome");
    expect(await connectError(t.connect({ v: PROTOCOL_VERSION, token: `${token}x` }))).toBe(
      "bad-token",
    );
    await t.stop();
    t = undefined;
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain(SECRET);
      expect(line).not.toContain(token);
    }
  });
});

describe("health and shutdown (C6)", () => {
  it("answers /health with the open rooms while sockets are connected", async () => {
    t = await boot(process.env.REDIS_URL);
    const lobby = await t.openRoom();
    const seen = track(t.connect({ v: PROTOCOL_VERSION, token: await t.token({ lobby }) }));
    await until(() => !!seen.welcome, 2_000, "welcome");
    const res = await fetch(`${t.url}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, rooms: 1, draining: false });
  });

  it("close() disconnects every client and resolves within 5 s", async () => {
    t = await boot(process.env.REDIS_URL);
    const lobby = await t.openRoom();
    const clients = await Promise.all(
      [1, 2, 3].map(async () =>
        t!.connect({ v: PROTOCOL_VERSION, token: await t!.token({ lobby }) }),
      ),
    );
    const seen = clients.map(track);
    await until(() => seen.every((s) => !!s.welcome), 2_000, "welcomes");
    const disconnected = clients.map((c) => new Promise<string>((r) => c.once("disconnect", r)));
    const started = Date.now();
    await t.server.close();
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(await Promise.all(disconnected)).toHaveLength(3);
    // close() already quit Redis: stop() only needs to clean the keys.
    const booted = t;
    t = undefined;
    await booted.stop().catch(() => undefined);
  });
});

describe("a room whose racer dropped for good still closes (#658 C2)", () => {
  it("one racer drops mid-race, the race ends, the other leaves: room kept for Race again (#143), state released", async () => {
    const race = await startedRace(process.env.REDIS_URL, {
      players: 2,
      settings: { ...DEFAULT_RACE_SETTINGS, timerS: 60 },
    });
    t = race.booted;
    const { lobby } = race;
    const [host, player] = race.racers as [Racer, Racer];
    player.client.disconnect();
    await until(() => host.seen.events.some((e) => e.kind === "line-cut"), WAIT_MS, "line-cut");
    // the host keeps typing nothing; the timer ends the race (idle warn/kick may fire, harmless)
    for (let left = 60_000; left > 0; left -= 1_000) {
      t.clock.advance(1_000);
      await new Promise((r) => setImmediate(r));
    }
    await until(() => host.seen.ended.length === 1, WAIT_MS, "ended");
    await until(() => host.seen.roster?.length === 1, WAIT_MS, "dropped racer released");

    host.client.disconnect();
    // The ended room outlives its last human under a grace TTL (#143); the process frees it (#658).
    await expect
      .poll(() => t!.server.desks.get(lobby), { timeout: WAIT_MS, interval: 20 })
      .toBeUndefined();
    expect(await t.server.registry.room(lobby)).toMatchObject({ phase: "ended", seated: [] });
    expect(t.server.presence.sockets(lobby, host.sub)).toBe(0);
  });
});

describe("public room auto start at the edge (#814 C5)", () => {
  it("every welcome carries the stored instant; auto-start reaches players and spectators", async () => {
    t = await boot(process.env.REDIS_URL);
    const lobby = await t.openRoom("KGB-4821", {
      ...DEFAULT_RACE_SETTINGS,
      lobbyType: "public",
      bots: [{ level: "clerk" }],
    });
    const join = async (claims: Parameters<Booted["token"]>[0]) => {
      const client = t!.connect({ v: PROTOCOL_VERSION, token: await t!.token(claims) });
      const seen = Object.assign(track(client), { autoStart: [] as (number | null)[] });
      client.on("auto-start", (a) => void seen.autoStart.push(a.startsAt));
      await until(() => !!seen.welcome, WAIT_MS, `welcome ${claims.sub}`);
      return seen;
    };
    // The host's welcome precedes the review its join triggers.
    const host = await join({ lobby, sub: "usr_host", name: "Ada", role: "host" });
    expect(host.welcome!.autoStartAt).toBeNull();
    await until(() => host.autoStart.length === 1, WAIT_MS, "auto-start");
    const startsAt = host.autoStart[0]!;
    expect(startsAt).toBe(t.clock.now() + 45_000);

    const guest = await join({ lobby, sub: "usr_guest", name: "Bob" });
    expect(guest.welcome!.autoStartAt).toBe(startsAt);
    const watcher = await join({ lobby, sub: "usr_watch", name: "Eve", role: "spectator" });
    expect(watcher.welcome!.autoStartAt).toBe(startsAt);

    // A drop goes to the whole audience, spectators included.
    await t.server.registry.setBots(lobby, []);
    await t.server.registry.leave(lobby, "usr_guest");
    await t.server.lifecycle.reviewAutoStart(lobby);
    await until(
      () => host.autoStart.length === 2 && watcher.autoStart.length === 1,
      WAIT_MS,
      "dropped",
    );
    expect(host.autoStart[1]).toBeNull();
    expect(watcher.autoStart).toEqual([null]);
  }, 20_000);
});

describe("room visibility broadcast (#815 C3)", () => {
  it("an ok toggle sends `settings` with the new lobbyType to players and spectators; the stored value sends nothing", async () => {
    t = await boot(process.env.REDIS_URL);
    const opened: RaceSettings = { ...DEFAULT_RACE_SETTINGS, timerS: 120 };
    const lobby = await t.openRoom("KGB-4821", opened);
    const connect = async (claims: Parameters<Booted["token"]>[0]) => {
      const seen = track(t!.connect({ v: PROTOCOL_VERSION, token: await t!.token(claims) }));
      await until(() => !!seen.welcome, WAIT_MS, `welcome ${claims.sub}`);
      return seen;
    };
    const host = await connect({ lobby, sub: "usr_host", name: "Ada", role: "host" });
    const guest = await connect({ lobby, sub: "usr_guest", name: "Bob" });
    const watcher = await connect({ lobby, sub: "usr_watch", name: "Eve", role: "spectator" });

    const res = await postRoomType(t, lobby, "public");
    expect(res).toEqual({ status: 200, body: { v: PROTOCOL_VERSION, result: "ok" } });
    const expected = { ...opened, lobbyType: "public" };
    await until(
      () => [host, guest, watcher].every((s) => s.settings.length === 1),
      WAIT_MS,
      "settings broadcast",
    );
    for (const seen of [host, guest, watcher]) expect(seen.settings).toEqual([expected]);

    // Already PUBLIC: ok, and no second broadcast.
    expect((await postRoomType(t, lobby, "public")).body).toEqual({
      v: PROTOCOL_VERSION,
      result: "ok",
    });
    await new Promise((r) => setTimeout(r, 150));
    for (const seen of [host, guest, watcher]) expect(seen.settings).toHaveLength(1);
  });
});
