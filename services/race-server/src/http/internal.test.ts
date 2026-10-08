import { afterEach, describe, expect, it, vi } from "vitest";
import {
  INTERNAL_HEADERS,
  INTERNAL_HMAC_TEST_VECTOR as V,
  PROTOCOL_VERSION,
  internalErrorSchema,
  openRoomResponseSchema,
} from "@fifth-copy/protocol";
import { createHmac } from "node:crypto";
import { createRaceServer, type RaceServer } from "../app";
import { createFakeClock, createFakeScheduler } from "../clock";
import { membersKey, roomKey } from "../rooms/keys";
import { connectRedis, fixtureWebApi } from "../testing/harness";
import { MAX_INTERNAL_BODY_BYTES } from "./internal";

// Over real HTTP and real Redis. The vector's lobby id is fixed (`lob_test`), so its keys are deleted
// before and after each test; its secret is the vector's, not the worktree's.
let server: RaceServer | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await server?.close();
  server = undefined;
  const redis = await connectRedis(process.env.REDIS_URL);
  await redis.del(roomKey("lob_test"), membersKey("lob_test"));
  redis.disconnect();
});

async function start(skewS = 0) {
  const redis = await connectRedis(process.env.REDIS_URL);
  await redis.del(roomKey("lob_test"), membersKey("lob_test"));
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

function sign(body: string, timestamp = V.timestamp) {
  return createHmac("sha256", V.secret).update(`${timestamp}.${body}`).digest("hex");
}

function post(
  base: string,
  {
    body = V.body as string,
    timestamp = V.timestamp as string,
    signature = V.signature as string,
  } = {},
) {
  return fetch(`${base}/internal/rooms`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [INTERNAL_HEADERS.timestamp]: timestamp,
      [INTERNAL_HEADERS.signature]: signature,
    },
    body,
  });
}

async function expectError(res: Response, status: number, error: string) {
  expect(res.status).toBe(status);
  const json = internalErrorSchema.parse(await res.json());
  expect(json).toEqual({ v: PROTOCOL_VERSION, error });
}

describe("POST /internal/rooms (C3)", () => {
  it("opens the room with the test vector, then answers created: false on the identical replay", async () => {
    const base = await start();
    const first = await post(base);
    expect(first.status).toBe(200);
    expect(openRoomResponseSchema.parse(await first.json())).toEqual({
      v: PROTOCOL_VERSION,
      roomId: "lob_test",
      phase: "waiting",
      created: true,
    });
    const again = await post(base);
    expect(await again.json()).toMatchObject({ created: false });
    expect(await server!.registry.members("lob_test")).toEqual([]);
    expect(await (await fetch(`${base}/health`)).json()).toMatchObject({ rooms: 1 });
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
      await expectError(await post(base, { body, signature: sign(body) }), 400, "bad-body");
    }
  });

  it("answers 400 bad-body for a body without settings or with invalid settings, opening nothing (#568)", async () => {
    const base = await start();
    const { settings, ...rest } = JSON.parse(V.body) as Record<string, unknown>;
    for (const body of [
      JSON.stringify(rest),
      JSON.stringify({ ...rest, settings: { ...(settings as object), wordCount: 5 } }),
    ]) {
      await expectError(await post(base, { body, signature: sign(body) }), 400, "bad-body");
    }
    expect(await server!.registry.members("lob_test")).toBeNull();
  });

  it("answers 400 bad-body for an oversized body, before hashing it", async () => {
    const base = await start();
    const body = "x".repeat(MAX_INTERNAL_BODY_BYTES + 1);
    await expectError(await post(base, { body, signature: sign(body) }), 400, "bad-body");
  });

  it("answers 426 version for another protocol version", async () => {
    const base = await start();
    const body = V.body.replace(`"v":${PROTOCOL_VERSION}`, '"v":1');
    await expectError(await post(base, { body, signature: sign(body) }), 426, "version");
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
