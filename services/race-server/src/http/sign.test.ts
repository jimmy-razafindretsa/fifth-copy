import { describe, expect, it } from "vitest";
import { INTERNAL_HMAC_TEST_VECTOR } from "@fifth-copy/protocol";
import { verifyInternalRequest } from "./hmac";
import { internalHeaders, signInternalBody } from "./sign";

describe("race-server internal signer (C4)", () => {
  const { secret, timestamp, body, signature } = INTERNAL_HMAC_TEST_VECTOR;

  it("reproduces INTERNAL_HMAC_TEST_VECTOR.signature for the vector body", () => {
    expect(signInternalBody({ timestamp, rawBody: body, secret })).toBe(signature);
  });

  it("builds the two headers from the server clock, truncated to seconds", () => {
    expect(
      internalHeaders({ rawBody: body, secret, nowMs: Number(timestamp) * 1000 + 999 }),
    ).toEqual({
      "x-fc-timestamp": timestamp,
      "x-fc-signature": signature,
    });
  });

  it("is accepted by the race server's own verifier and changes with body and secret", () => {
    const nowMs = Number(timestamp) * 1000;
    const headers = internalHeaders({ rawBody: body, secret, nowMs });
    expect(
      verifyInternalRequest({
        secret,
        timestamp: headers["x-fc-timestamp"],
        signature: headers["x-fc-signature"],
        rawBody: body,
        nowMs,
      }),
    ).toEqual({ ok: true });
    expect(signInternalBody({ timestamp, rawBody: `${body} `, secret })).not.toBe(signature);
    expect(signInternalBody({ timestamp, rawBody: body, secret: `${secret}x` })).not.toBe(
      signature,
    );
  });
});
