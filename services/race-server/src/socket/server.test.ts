import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  DEFAULT_RACE_SETTINGS,
  deskIdentity,
  INTERNAL_HEADERS,
  PROTOCOL_VERSION,
  type RaceSettings,
  welcomeSchema,
} from "@fifth-copy/protocol";
import { boot, connectError, SECRET, track, until, type Booted } from "../testing/harness";

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
      // #178: every welcome carries the user's resume key (32 random bytes hex).
      resumeKey: expect.stringMatching(/^[0-9a-f]{64}$/),
      serverNow: t.clock.now(),
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
    const timestamp = String(Math.floor(t.clock.now() / 1000));
    const res = await fetch(`${t.url}/internal/rooms`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [INTERNAL_HEADERS.timestamp]: timestamp,
        [INTERNAL_HEADERS.signature]: createHmac("sha256", SECRET)
          .update(`${timestamp}.${body}`)
          .digest("hex"),
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
