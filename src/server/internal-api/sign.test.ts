import { describe, expect, it } from "vitest";
import {
  INTERNAL_HEADERS,
  INTERNAL_HMAC_TEST_VECTOR,
  INTERNAL_NONCE_HEX,
} from "@fifth-copy/protocol";
import { internalHeaders, signInternalBody } from "./sign";

const { secret, timestamp, nonce, body, signature } = INTERNAL_HMAC_TEST_VECTOR;

describe("internal API signing (#518 C1)", () => {
  it("signing the INTERNAL_HMAC_TEST_VECTOR body at its timestamp and nonce reproduces its signature", () => {
    expect(signInternalBody({ timestamp, nonce, rawBody: body, secret })).toBe(signature);
  });

  it("internalHeaders carries x-fc-timestamp, x-fc-nonce and x-fc-signature for the vector", () => {
    const headers = internalHeaders({ rawBody: body, secret, now: Number(timestamp), nonce });
    expect(INTERNAL_HEADERS).toEqual({
      timestamp: "x-fc-timestamp",
      signature: "x-fc-signature",
      nonce: "x-fc-nonce",
    });
    expect(headers).toEqual({
      "x-fc-timestamp": timestamp,
      "x-fc-nonce": nonce,
      "x-fc-signature": signature,
    });
  });

  it("draws a fresh 32-hex nonce per call by default", () => {
    const a = internalHeaders({ rawBody: body, secret, now: Number(timestamp) });
    const b = internalHeaders({ rawBody: body, secret, now: Number(timestamp) });
    expect(a["x-fc-nonce"]).toMatch(INTERNAL_NONCE_HEX);
    expect(b["x-fc-nonce"]).toMatch(INTERNAL_NONCE_HEX);
    expect(a["x-fc-nonce"]).not.toBe(b["x-fc-nonce"]);
  });

  it("changes with the body, the timestamp, the nonce and the secret", () => {
    const sign = (patch: Partial<Parameters<typeof signInternalBody>[0]>) =>
      signInternalBody({ timestamp, nonce, rawBody: body, secret, ...patch });
    expect(sign({ rawBody: `${body} ` })).not.toBe(signature);
    expect(sign({ timestamp: "1767225601" })).not.toBe(signature);
    expect(sign({ nonce: "0".repeat(32) })).not.toBe(signature);
    expect(sign({ secret: `${secret}x` })).not.toBe(signature);
  });
});
