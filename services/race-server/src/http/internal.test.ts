import type { Redis } from "ioredis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  INTERNAL_HEADERS,
  INTERNAL_HMAC_TEST_VECTOR as V,
  INTERNAL_MAX_SKEW_S,
  INTERNAL_NONCE_TTL_S,
  PROTOCOL_VERSION,
  internalErrorSchema,
  openRoomResponseSchema,
} from "@fifth-copy/protocol";
import { createHmac, randomBytes } from "node:crypto";
import { createRaceServer, type RaceServer } from "../app";
import { createFakeClock, createFakeScheduler } from "../clock";
import { membersKey, nonceKey, roomKey } from "../rooms/keys";
import { connectRedis, fixtureWebApi } from "../testing/harness";
import { MAX_INTERNAL_BODY_BYTES } from "./internal";

// Over real HTTP and real Redis. The vector's lobby id (`lob_test`) and nonce are fixed, so their keys
// are deleted before and after each test; its secret is the vector's, not the worktree's. Every other
// request signs a fresh random nonce (#518).
let server: RaceServer | undefined;
async function resetVectorKeys() {
  const redis = await connectRedis(process.env.REDIS_URL);
  await redis.del(roomKey("lob_test"), membersKey("lob_test"), nonceKey(V.nonce));
  redis.disconnect();
}
beforeEach(resetVectorKeys);
afterEach(async () => {
  vi.restoreAllMocks();
  await server?.close();
  server = undefined;
  await resetVectorKeys();
});

async function start(skewS = 0, redisOverride?: (redis: Redis) => Redis) {
  // A test may restart the server on another clock; the Redis state stays.
  await server?.close();
  let redis = await connectRedis(process.env.REDIS_URL);
  if (redisOverride) redis = redisOverride(redis);
  const clock = createFakeClock((Number(V.timestamp) + skewS) * 1000);
  server = createRaceServer({
    env: { RACE_TOKEN_SECRET: V.secret, WEB_ORIGIN: "http://localhost:3000", RACE_FAST_CLOCK: "0" },
    redis,
    clock,
    scheduler: createFakeScheduler(clock),
    webApi: fixtureWebApi(clock).api,
    // The shared test db's `rooms` index lists other test files' live rooms (#204).
    recovery: false,
  });
  return `http://127.0.0.1:${await server.listen(0, "127.0.0.1")}`;
}

const freshNonce = () => randomBytes(16).toString("hex");

function sign(body: string, nonce: string, timestamp = V.timestamp) {
  return createHmac("sha256", V.secret).update(`${timestamp}.${nonce}.${body}`).digest("hex");
}

/** The vector request by default; `nonce: null` leaves the nonce header out. */
function post(
  base: string,
  {
    body = V.body as string,
    timestamp = V.timestamp as string,
    nonce = V.nonce as string | null,
    signature = V.signature as string,
  } = {},
) {
  return fetch(`${base}/internal/rooms`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [INTERNAL_HEADERS.timestamp]: timestamp,
      ...(nonce === null ? {} : { [INTERNAL_HEADERS.nonce]: nonce }),
      [INTERNAL_HEADERS.signature]: signature,
    },
    body,
  });
}

/** `body` signed with a fresh nonce at the vector timestamp. */
function postSigned(base: string, body: string) {
  const nonce = freshNonce();
  return post(base, { body, nonce, signature: sign(body, nonce) });
}

async function expectError(res: Response, status: number, error: string) {
  expect(res.status).toBe(status);
  const json = internalErrorSchema.parse(await res.json());
  expect(json).toEqual({ v: PROTOCOL_VERSION, error });
}

describe("POST /internal/rooms (C3)", () => {
  it("opens the room with the test vector; the same body with a fresh nonce answers created: false", async () => {
    const base = await start();
    const first = await post(base);
    expect(first.status).toBe(200);
    expect(openRoomResponseSchema.parse(await first.json())).toEqual({
      v: PROTOCOL_VERSION,
      roomId: "lob_test",
      phase: "waiting",
      created: true,
    });
    const again = await postSigned(base, V.body);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ created: false });
    expect(await server!.registry.members("lob_test")).toEqual([]);
    expect(await (await fetch(`${base}/health`)).json()).toMatchObject({ rooms: 1 });
  });

  it("#518 C2: answers 401 replay for the identical request inside the skew window", async () => {
    const base = await start();
    expect((await post(base)).status).toBe(200);
    await expectError(await post(base), 401, "replay");
    // Still a replay at the far edge of the window, 300 s later.
    const later = await start(INTERNAL_MAX_SKEW_S);
    await expectError(await post(later), 401, "replay");
  });

  it("#518 C2: keeps the nonce key with a TTL >= INTERNAL_MAX_SKEW_S", async () => {
    const base = await start();
    expect((await post(base)).status).toBe(200);
    const redis = await connectRedis(process.env.REDIS_URL);
    const ttl = await redis.ttl(nonceKey(V.nonce));
    redis.disconnect();
    expect(ttl).toBeGreaterThanOrEqual(INTERNAL_MAX_SKEW_S);
    expect(ttl).toBeLessThanOrEqual(INTERNAL_NONCE_TTL_S);
  });

  it("#518 C3: answers 401 bad-signature for a missing or malformed nonce, opening nothing", async () => {
    const base = await start();
    await expectError(await post(base, { nonce: null }), 401, "bad-signature");
    for (const nonce of ["", V.nonce.toUpperCase(), V.nonce.slice(1), `${V.nonce}0`]) {
      await expectError(await post(base, { nonce, signature: sign(V.body, nonce) }), 401, "bad-signature");
    }
    expect(await server!.registry.members("lob_test")).toBeNull();
  });

  it("#518: a request that fails the signature does not consume its nonce", async () => {
    const base = await start();
    await expectError(await post(base, { signature: "0".repeat(64) }), 401, "bad-signature");
    const stale = await start(INTERNAL_MAX_SKEW_S + 1);
    await expectError(await post(stale), 401, "stale-timestamp");
    const redis = await connectRedis(process.env.REDIS_URL);
    expect(await redis.exists(nonceKey(V.nonce))).toBe(0);
    redis.disconnect();
    const ok = await start();
    expect((await post(ok)).status).toBe(200);
  });

  it("#518: fails closed with a 500 when Redis cannot record the nonce", async () => {
    const base = await start(0, (redis) => {
      const set = redis.set.bind(redis);
      vi.spyOn(redis, "set").mockImplementation(((...args: Parameters<typeof set>) =>
        String(args[0]).startsWith("internal:nonce:")
          ? Promise.reject(new Error("redis down"))
          : set(...args)) as typeof redis.set);
      return redis;
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const res = await post(base);
    expect(res.status).toBe(500);
    expect(await server!.registry.members("lob_test")).toBeNull();
  });

  it("answers 401 bad-signature for a wrong signature or a body changed after signing", async () => {
    const base = await start();
    await expectError(await post(base, { signature: "0".repeat(64) }), 401, "bad-signature");
    await expectError(
      await post(base, { body: V.body.replace("usr_test", "usr_evil") }),
      401,
      "bad-signature",
    );
    expect(await server!.registry.members("lob_test")).toBeNull();
  });

  it("answers 401 stale-timestamp for a timestamp 301 s old", async () => {
    const base = await start(301);
    await expectError(await post(base), 401, "stale-timestamp");
  });

  it("answers 400 bad-body for an unparseable or invalid body with a valid signature", async () => {
    const base = await start();
    for (const body of [
      "{not json",
      "null",
      "[]",
      JSON.stringify({ v: PROTOCOL_VERSION, lobbyId: "x" }),
    ]) {
      await expectError(await postSigned(base, body), 400, "bad-body");
    }
  });

  it("answers 400 bad-body for a body without settings or with invalid settings, opening nothing (#568)", async () => {
    const base = await start();
    const { settings, ...rest } = JSON.parse(V.body) as Record<string, unknown>;
    for (const body of [
      JSON.stringify(rest),
      JSON.stringify({ ...rest, settings: { ...(settings as object), wordCount: 5 } }),
    ]) {
      await expectError(await postSigned(base, body), 400, "bad-body");
    }
    expect(await server!.registry.members("lob_test")).toBeNull();
  });

  it("answers 400 bad-body for an oversized body, before hashing it", async () => {
    const base = await start();
    const body = "x".repeat(MAX_INTERNAL_BODY_BYTES + 1);
    await expectError(await postSigned(base, body), 400, "bad-body");
  });

  it("answers 426 version for another protocol version", async () => {
    const base = await start();
    const body = V.body.replace(`"v":${PROTOCOL_VERSION}`, '"v":1');
    await expectError(await postSigned(base, body), 426, "version");
  });

  it("checks the signature before parsing: garbage with a bad signature is 401, not 400", async () => {
    const base = await start();
    await expectError(
      await post(base, { body: "{not json", signature: "0".repeat(64) }),
      401,
      "bad-signature",
    );
  });

  it("keeps 404 for unknown paths and methods", async () => {
    const base = await start();
    expect((await fetch(`${base}/internal/rooms`)).status).toBe(404);
    expect((await fetch(`${base}/internal/nope`, { method: "POST" })).status).toBe(404);
  });
});

describe("internal route logs (C4)", () => {
  it("never print the secret, the signature or the body", async () => {
    const lines: string[] = [];
    for (const level of ["log", "info", "warn", "error"] as const) {
      vi.spyOn(console, level).mockImplementation(
        (...args: unknown[]) => void lines.push(args.map(String).join(" ")),
      );
    }
    const base = await start();
    await post(base);
    await post(base, { signature: "0".repeat(64) });
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain(V.secret);
      expect(line).not.toContain(V.signature);
      expect(line).not.toContain("usr_test");
    }
  });
});
