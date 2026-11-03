import { describe, expect, it } from "vitest";
import {
  INTERNAL_HEADERS,
  INTERNAL_HMAC_TEST_VECTOR,
  PROTOCOL_VERSION,
} from "@fifth-copy/protocol";
import type { NonceClaim, NonceStore } from "./nonces";
import { internalHeaders } from "./sign";
import {
  internalRefusalResponse,
  MAX_INTERNAL_BODY_BYTES,
  requireInternal as verifyWith,
} from "./verify";

/** An in-memory store that counts its claims; `outage` makes every claim `unavailable`. */
function memoryStore({ outage = false } = {}) {
  const seen = new Set<string>();
  const claims: string[] = [];
  const store: NonceStore = {
    async claim(nonce): Promise<NonceClaim> {
      claims.push(nonce);
      if (outage) return "unavailable";
      if (seen.has(nonce)) return "replay";
      seen.add(nonce);
      return "claimed";
    },
  };
  return Object.assign(store, { claims, seen });
}

/** The cases below predate the store (#518): each call gets a fresh one, so none is a replay. */
const requireInternal = (
  request: Request,
  opts: Omit<Parameters<typeof verifyWith>[1], "nonces"> & { nonces?: NonceStore },
) => verifyWith(request, { nonces: memoryStore(), ...opts });

const { secret, timestamp, nonce, body, signature } = INTERNAL_HMAC_TEST_VECTOR;
const vectorNowMs = Number(timestamp) * 1000;

function request(rawBody: string, headers: Record<string, string>) {
  return new Request("http://web.test/api/internal/races", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: rawBody,
  });
}
const signed = (rawBody: string, nowS = Number(timestamp)) =>
  request(rawBody, internalHeaders({ rawBody, secret, now: nowS }));

const vectorHeaders = {
  [INTERNAL_HEADERS.timestamp]: timestamp,
  [INTERNAL_HEADERS.nonce]: nonce,
  [INTERNAL_HEADERS.signature]: signature,
};

describe("requireInternal (C2, #518 C1)", () => {
  it("passes INTERNAL_HMAC_TEST_VECTOR and returns the parsed body", async () => {
    const result = await requireInternal(request(body, vectorHeaders), {
      secret,
      nowMs: vectorNowMs,
    });
    expect(result).toEqual({ ok: true, body: JSON.parse(body) });
  });

  it("accepts a skew of 300 s either way and refuses 301 s as stale-timestamp", async () => {
    for (const skew of [-300, 300]) {
      const ok = await requireInternal(signed(body), { secret, nowMs: vectorNowMs + skew * 1000 });
      expect(ok.ok).toBe(true);
    }
    for (const skew of [-301, 301]) {
      expect(
        await requireInternal(signed(body), { secret, nowMs: vectorNowMs + skew * 1000 }),
      ).toEqual({ ok: false, status: 401, error: "stale-timestamp" });
    }
  });

  it("refuses missing headers, a bad timestamp format and a bad signature format", async () => {
    const opts = { secret, nowMs: vectorNowMs };
    expect(await requireInternal(request(body, {}), opts)).toEqual({
      ok: false,
      status: 401,
      error: "stale-timestamp",
    });
    expect(
      await requireInternal(request(body, { [INTERNAL_HEADERS.timestamp]: "1e9" }), opts),
    ).toMatchObject({ status: 401, error: "stale-timestamp" });
    expect(
      await requireInternal(
        request(body, { [INTERNAL_HEADERS.timestamp]: timestamp, [INTERNAL_HEADERS.nonce]: nonce }),
        opts,
      ),
    ).toEqual({ ok: false, status: 401, error: "bad-signature" });
    expect(
      await requireInternal(
        request(body, { ...vectorHeaders, [INTERNAL_HEADERS.signature]: signature.toUpperCase() }),
        opts,
      ),
    ).toMatchObject({ status: 401, error: "bad-signature" });
  });

  it("#518: refuses a missing, malformed or substituted nonce as bad-signature", async () => {
    const opts = { secret, nowMs: vectorNowMs };
    const { [INTERNAL_HEADERS.nonce]: _omit, ...withoutNonce } = vectorHeaders;
    void _omit;
    expect(await requireInternal(request(body, withoutNonce), opts)).toEqual({
      ok: false,
      status: 401,
      error: "bad-signature",
    });
    for (const bad of [nonce.toUpperCase(), nonce.slice(1), `${nonce}a`, "0".repeat(32)]) {
      expect(
        await requireInternal(
          request(body, { ...vectorHeaders, [INTERNAL_HEADERS.nonce]: bad }),
          opts,
        ),
      ).toEqual({ ok: false, status: 401, error: "bad-signature" });
    }
  });

  it("refuses a body tampered after signing, and another secret, as bad-signature", async () => {
    const headers = internalHeaders({ rawBody: body, secret, now: Number(timestamp) });
    const tampered = body.replace('"wordCount":50', '"wordCount":51');
    expect(
      await requireInternal(request(tampered, headers), { secret, nowMs: vectorNowMs }),
    ).toEqual({ ok: false, status: 401, error: "bad-signature" });
    expect(
      await requireInternal(signed(body), { secret: `${secret}x`, nowMs: vectorNowMs }),
    ).toMatchObject({ status: 401, error: "bad-signature" });
  });

  it("refuses a body over 64 KiB as bad-body before checking anything else", async () => {
    const big = JSON.stringify({ v: PROTOCOL_VERSION, pad: "x".repeat(MAX_INTERNAL_BODY_BYTES) });
    expect(await requireInternal(signed(big), { secret, nowMs: vectorNowMs })).toEqual({
      ok: false,
      status: 400,
      error: "bad-body",
    });
    expect(await requireInternal(request(big, {}), { secret, nowMs: vectorNowMs })).toMatchObject({
      status: 400,
    });
  });

  it("a route may raise the cap (#189): accepted up to maxBodyBytes, refused one byte over", async () => {
    const pad = (n: number) => {
      const base = JSON.stringify({ ...JSON.parse(body), pad: "" });
      return JSON.stringify({ ...JSON.parse(body), pad: "x".repeat(n - base.length) });
    };
    const maxBodyBytes = 4 * MAX_INTERNAL_BODY_BYTES;
    const atCap = pad(maxBodyBytes);
    expect(Buffer.byteLength(atCap)).toBe(maxBodyBytes);
    const opts = { secret, nowMs: vectorNowMs, maxBodyBytes };
    expect((await requireInternal(signed(atCap), opts)).ok).toBe(true);
    expect(await requireInternal(signed(pad(maxBodyBytes + 1)), opts)).toEqual({
      ok: false,
      status: 400,
      error: "bad-body",
    });
    // The default stays 64 KiB for every other route.
    expect(await requireInternal(signed(atCap), { secret, nowMs: vectorNowMs })).toMatchObject({
      status: 400,
      error: "bad-body",
    });
  });

  it("refuses signed non-JSON and non-object bodies as bad-body", async () => {
    for (const raw of ["not json", "[1]", "null", "42"]) {
      expect(await requireInternal(signed(raw), { secret, nowMs: vectorNowMs })).toEqual({
        ok: false,
        status: 400,
        error: "bad-body",
      });
    }
  });

  it("refuses a signed body with the previous protocol version as 426 version", async () => {
    const old = JSON.stringify({ ...JSON.parse(body), v: PROTOCOL_VERSION - 1 });
    expect(await requireInternal(signed(old), { secret, nowMs: vectorNowMs })).toEqual({
      ok: false,
      status: 426,
      error: "version",
    });
  });
});

describe("requireInternal replay store (#716)", () => {
  it("C1: a second request with the same nonce answers 401 replay, also 300 s later", async () => {
    const nonces = memoryStore();
    const opts = { secret, nowMs: vectorNowMs, nonces };
    expect((await verifyWith(request(body, vectorHeaders), opts)).ok).toBe(true);
    expect(await verifyWith(request(body, vectorHeaders), opts)).toEqual({
      ok: false,
      status: 401,
      error: "replay",
    });
    expect(
      await verifyWith(request(body, vectorHeaders), { ...opts, nowMs: vectorNowMs + 300_000 }),
    ).toEqual({ ok: false, status: 401, error: "replay" });
    expect(nonces.claims).toEqual([nonce, nonce, nonce]);
    // A fresh nonce on the same body is a new request.
    expect((await verifyWith(signed(body), opts)).ok).toBe(true);
  });

  it("C1: claims before parsing, like the race server: a replayed non-JSON body is a replay", async () => {
    const nonces = memoryStore();
    const headers = internalHeaders({ rawBody: "not json", secret, now: Number(timestamp) });
    const opts = { secret, nowMs: vectorNowMs, nonces };
    expect(await verifyWith(request("not json", headers), opts)).toMatchObject({
      error: "bad-body",
    });
    expect(await verifyWith(request("not json", headers), opts)).toMatchObject({
      status: 401,
      error: "replay",
    });
  });

  it("C2: a request failing the body cap, timestamp, nonce or signature check never claims", async () => {
    const nonces = memoryStore();
    const opts = { secret, nowMs: vectorNowMs, nonces };
    const big = JSON.stringify({ v: PROTOCOL_VERSION, pad: "x".repeat(MAX_INTERNAL_BODY_BYTES) });
    const refused = [
      signed(big),
      signed(body, Number(timestamp) - 301),
      signed(body, Number(timestamp) + 301),
      request(body, { ...vectorHeaders, [INTERNAL_HEADERS.timestamp]: "1e9" }),
      request(body, { [INTERNAL_HEADERS.timestamp]: timestamp, [INTERNAL_HEADERS.signature]: signature }),
      request(body, { ...vectorHeaders, [INTERNAL_HEADERS.nonce]: nonce.toUpperCase() }),
      request(body, { ...vectorHeaders, [INTERNAL_HEADERS.signature]: "0".repeat(64) }),
      request(body.replace('"wordCount":50', '"wordCount":51'), vectorHeaders),
    ];
    for (const req of refused) expect((await verifyWith(req, opts)).ok).toBe(false);
    expect(await verifyWith(signed(body), { ...opts, secret: `${secret}x` })).toMatchObject({
      error: "bad-signature",
    });
    expect(nonces.claims).toEqual([]);
    // The genuine request is then still accepted: nothing was burnt by the refusals.
    expect((await verifyWith(request(body, vectorHeaders), opts)).ok).toBe(true);
  });

  it("C3: store unavailable (Redis down or slow): a bare 503, the body is not parsed", async () => {
    const nonces = memoryStore({ outage: true });
    const result = await verifyWith(request(body, vectorHeaders), {
      secret,
      nowMs: vectorNowMs,
      nonces,
    });
    expect(result).toEqual({ ok: false, status: 503 });
    expect(nonces.seen.size).toBe(0);
    if (result.ok) throw new Error("unreachable");
    const response = internalRefusalResponse(result);
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("");
  });

  it("refusals other than 503 answer the protocol error body", async () => {
    const response = internalRefusalResponse({ ok: false, status: 401, error: "replay" });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ v: PROTOCOL_VERSION, error: "replay" });
  });
});
