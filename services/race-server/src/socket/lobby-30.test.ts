import { afterEach, describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "@fifth-copy/protocol";
import { boot, track, until, type Booted } from "../testing/harness";

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
});
