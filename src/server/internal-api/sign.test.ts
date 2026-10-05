import { describe, expect, it } from "vitest";
import { INTERNAL_HEADERS, INTERNAL_HMAC_TEST_VECTOR } from "@fifth-copy/protocol";
import { internalHeaders, signInternalBody } from "./sign";

describe("internal API signing", () => {
  it("C3: signing the INTERNAL_HMAC_TEST_VECTOR body at its timestamp reproduces its signature", () => {
    const { secret, timestamp, body, signature } = INTERNAL_HMAC_TEST_VECTOR;
    expect(signInternalBody({ timestamp, rawBody: body, secret })).toBe(signature);
  });

  it("C3: internalHeaders carries x-fc-timestamp and x-fc-signature for the vector", () => {
    const { secret, timestamp, body, signature } = INTERNAL_HMAC_TEST_VECTOR;
    const headers = internalHeaders({ rawBody: body, secret, now: Number(timestamp) });
    expect(INTERNAL_HEADERS).toEqual({ timestamp: "x-fc-timestamp", signature: "x-fc-signature" });
    expect(headers).toEqual({ "x-fc-timestamp": timestamp, "x-fc-signature": signature });
  });

  it("changes with the body, the timestamp and the secret", () => {
    const { secret, timestamp, body, signature } = INTERNAL_HMAC_TEST_VECTOR;
    expect(signInternalBody({ timestamp, rawBody: `${body} `, secret })).not.toBe(signature);
    expect(signInternalBody({ timestamp: "1767225601", rawBody: body, secret })).not.toBe(signature);
    expect(signInternalBody({ timestamp, rawBody: body, secret: `${secret}x` })).not.toBe(signature);
  });
});
