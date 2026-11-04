import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RACE_SETTINGS, PROTOCOL_VERSION } from "@fifth-copy/protocol";
import { boot, connectRedis, HOST_SUB, track, until, type Booted } from "../testing/harness";
import { instanceKey, roomKey } from "./keys";
import { LEASE_TTL_MS } from "./owner";
import { RECONCILE_MS } from "./registry";

// #704 C1: Railway boots the new race server before it SIGTERMs the old one, on the same Redis. The
// new boot must not void the races the old (draining) process still runs (ADR 0008 restart
// behaviour applies only to rooms whose owner is gone). Real Redis, own key space, recovery on.

const url = process.env.REDIS_URL;
let boots: Booted[] = [];
let redis: Redis | undefined;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const b of boots) await b.stop();
  boots = [];
  redis?.disconnect();
  redis = undefined;
});

async function space() {
  const prefix = `t704-${randomUUID()}:`;
  redis = await connectRedis(url, prefix);
  const bootOne = async () => {
    const b = await boot(url, { redisPrefix: prefix, recovery: true });
    boots.push(b);
    return b;
  };
  return { bootOne, redis };
}

async function untimedRace(b: Booted) {
  const lobby = await b.openRoom("OWN-0001", { ...DEFAULT_RACE_SETTINGS, timerS: null });
  await b.server.registry.join(lobby, { userId: HOST_SUB, name: "Host" });
  await b.server.registry.join(lobby, { userId: "usr_o1", name: "Oda" });
  expect((await b.server.lifecycle.start(lobby, { sub: HOST_SUB, role: "host" })).ok).toBe(true);
  b.clock.advance(3_000);
  await until(() => b.server.desks.get(lobby)?.phase === "running", 3_000, "GO");
  return lobby;
}

describe("room owner lease (#704 C1)", () => {
  it("a second boot leaves the live race of a process that is still alive untouched", async () => {
    const { bootOne, redis } = await space();
    const old = await bootOne();
    const lobby = await untimedRace(old);
    const owner = await redis.hget(roomKey(lobby), "owner");
    expect(owner).toBe(old.server.instanceId);
    const ttl = await redis.pttl(instanceKey(owner!));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(LEASE_TTL_MS);

    const fresh = await bootOne();
    expect((await redis.hgetall(roomKey(lobby))).phase).toBe("running");
    expect(fresh.server.registry.count()).toBe(0);
    expect(old.server.desks.get(lobby)?.phase).toBe("running");

    // Still alive at the next reconcile: still untouched.
    fresh.clock.advance(RECONCILE_MS);
    await new Promise((r) => setTimeout(r, 100));
    expect((await redis.hgetall(roomKey(lobby))).phase).toBe("running");
  });

  it("voids the race at the next reconcile once its owner's lease is gone", async () => {
    const { bootOne, redis } = await space();
    const old = await bootOne();
    const lobby = await untimedRace(old);
    const fresh = await bootOne();
    expect((await redis.hgetall(roomKey(lobby))).phase).toBe("running");

    // The old process was killed: its lease expires (here: deleted), its room is orphaned.
    await redis.del(instanceKey(old.server.instanceId));
    fresh.clock.advance(RECONCILE_MS);
    await until(() => fresh.server.registry.count() === 1, 3_000, "orphan voided");
    expect(await redis.hgetall(roomKey(lobby))).toMatchObject({
      phase: "ended",
      endReason: "void",
    });
  });

  it("voids a race another process started after this boot once that owner is gone, and tells this process's sockets", async () => {
    const { bootOne, redis } = await space();
    const old = await bootOne();
    const lobby = await old.openRoom("OWN-0002", { ...DEFAULT_RACE_SETTINGS, timerS: null });
    // The new deployment boots while the room waits: it counts it as its own.
    const fresh = await bootOne();
    expect(fresh.server.registry.count()).toBe(1);
    const client = fresh.connect({
      v: PROTOCOL_VERSION,
      token: await fresh.token({ lobby, sub: HOST_SUB, role: "host" }),
    });
    const host = track(client);
    const ended: { reason: string; raceId: string }[] = [];
    client.on("ended", (e) => void ended.push(e));
    await until(() => !!host.welcome, 3_000, "welcome");

    // The draining process starts the race (its own host socket), then dies at its cap or is killed.
    await old.server.registry.join(lobby, { userId: "usr_o2", name: "Ola" });
    expect((await old.server.lifecycle.start(lobby, { sub: HOST_SUB, role: "host" })).ok).toBe(
      true,
    );
    const raceId = await redis.hget(roomKey(lobby), "raceId");
    fresh.clock.advance(RECONCILE_MS);
    await new Promise((r) => setTimeout(r, 100));
    expect((await redis.hgetall(roomKey(lobby))).phase).toBe("countdown");

    await redis.del(instanceKey(old.server.instanceId));
    fresh.clock.advance(RECONCILE_MS);
    await until(() => ended.length > 0, 3_000, "void heard");
    expect(ended[0]).toMatchObject({ reason: "void", raceId });
    expect(await redis.hgetall(roomKey(lobby))).toMatchObject({
      phase: "ended",
      endReason: "void",
    });
    client.disconnect();
  });

  it("a closed process gives its lease up, so a restart voids its races as before", async () => {
    const { bootOne, redis } = await space();
    const old = await bootOne();
    const lobby = await untimedRace(old);
    const id = old.server.instanceId;
    const fresh = await old.restart();
    boots = boots.filter((b) => b !== old).concat(fresh);
    expect(await redis.exists(instanceKey(id))).toBe(0);
    expect(await redis.hgetall(roomKey(lobby))).toMatchObject({
      phase: "ended",
      endReason: "void",
    });
  });
});
