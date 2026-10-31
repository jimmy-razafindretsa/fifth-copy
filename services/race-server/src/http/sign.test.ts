import { describe, expect, it } from "vitest";
import { INTERNAL_HMAC_TEST_VECTOR, INTERNAL_NONCE_HEX } from "@fifth-copy/protocol";
import { verifyInternalRequest } from "./hmac";
import { internalHeaders, signInternalBody } from "./sign";

describe("race-server internal signer (#518 C1)", () => {
  const { secret, timestamp, nonce, body, signature } = INTERNAL_HMAC_TEST_VECTOR;

  it("reproduces INTERNAL_HMAC_TEST_VECTOR.signature for the vector body and nonce", () => {
    expect(signInternalBody({ timestamp, nonce, rawBody: body, secret })).toBe(signature);
  });

  it("builds the three headers from the server clock, truncated to seconds", () => {
    expect(
      internalHeaders({ rawBody: body, secret, nowMs: Number(timestamp) * 1000 + 999, nonce }),
    ).toEqual({
      "x-fc-timestamp": timestamp,
      "x-fc-nonce": nonce,
      "x-fc-signature": signature,
    });
  });

  it("draws a fresh 32-hex nonce per call by default", () => {
    const nowMs = Number(timestamp) * 1000;
    const a = internalHeaders({ rawBody: body, secret, nowMs });
    const b = internalHeaders({ rawBody: body, secret, nowMs });
    expect(a["x-fc-nonce"]).toMatch(INTERNAL_NONCE_HEX);
    expect(b["x-fc-nonce"]).toMatch(INTERNAL_NONCE_HEX);
    expect(a["x-fc-nonce"]).not.toBe(b["x-fc-nonce"]);
    expect(a["x-fc-signature"]).not.toBe(b["x-fc-signature"]);
  });

  it("is accepted by the race server's own verifier and changes with body and secret", () => {
    const nowMs = Number(timestamp) * 1000;
    const headers = internalHeaders({ rawBody: body, secret, nowMs });
    expect(
      verifyInternalRequest({
        secret,
        timestamp: headers["x-fc-timestamp"],
        nonce: headers["x-fc-nonce"],
        signature: headers["x-fc-signature"],
        rawBody: body,
        nowMs,
      }),
    ).toEqual({ ok: true });
    expect(signInternalBody({ timestamp, nonce, rawBody: `${body} `, secret })).not.toBe(signature);
    expect(signInternalBody({ timestamp, nonce, rawBody: body, secret: `${secret}x` })).not.toBe(
      signature,
    );
    expect(signInternalBody({ timestamp, nonce: "0".repeat(32), rawBody: body, secret })).not.toBe(
      signature,
    );
  });
});
