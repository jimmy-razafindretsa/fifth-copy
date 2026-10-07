import { describe, expect, it } from "vitest";
import {
  INTERNAL_HEADERS,
  INTERNAL_HMAC_TEST_VECTOR,
  PROTOCOL_VERSION,
} from "@fifth-copy/protocol";
import { internalHeaders } from "./sign";
import { MAX_INTERNAL_BODY_BYTES, requireInternal } from "./verify";

const { secret, timestamp, body, signature } = INTERNAL_HMAC_TEST_VECTOR;
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

describe("requireInternal (C2)", () => {
  it("passes INTERNAL_HMAC_TEST_VECTOR and returns the parsed body", async () => {
    const result = await requireInternal(
      request(body, {
        [INTERNAL_HEADERS.timestamp]: timestamp,
        [INTERNAL_HEADERS.signature]: signature,
      }),
      { secret, nowMs: vectorNowMs },
    );
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
      await requireInternal(request(body, { [INTERNAL_HEADERS.timestamp]: timestamp }), opts),
    ).toEqual({ ok: false, status: 401, error: "bad-signature" });
    expect(
      await requireInternal(
        request(body, {
          [INTERNAL_HEADERS.timestamp]: timestamp,
          [INTERNAL_HEADERS.signature]: signature.toUpperCase(),
        }),
        opts,
      ),
    ).toMatchObject({ status: 401, error: "bad-signature" });
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
