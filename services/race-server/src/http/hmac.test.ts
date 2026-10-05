import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INTERNAL_HMAC_TEST_VECTOR as V, INTERNAL_MAX_SKEW_S } from "@fifth-copy/protocol";
import { verifyInternalRequest } from "./hmac";

const nowMs = Number(V.timestamp) * 1000;
const base = { secret: V.secret, timestamp: V.timestamp, signature: V.signature, rawBody: V.body };

describe("verifyInternalRequest (C3, C4)", () => {
  it("accepts the shared known-answer vector", () => {
    expect(verifyInternalRequest({ ...base, nowMs })).toEqual({ ok: true });
  });

  it("accepts a timestamp exactly at the skew limit, in both directions", () => {
    for (const d of [-INTERNAL_MAX_SKEW_S, INTERNAL_MAX_SKEW_S]) {
      expect(verifyInternalRequest({ ...base, nowMs: nowMs + d * 1000 })).toEqual({ ok: true });
    }
  });

  it.each([
    ["a wrong signature", { signature: "0".repeat(64) }, "bad-signature"],
    ["a signature of another length", { signature: "abcd" }, "bad-signature"],
    ["a non-hex signature", { signature: "z".repeat(64) }, "bad-signature"],
    ["a missing signature", { signature: undefined }, "bad-signature"],
    [
      "a body changed after signing",
      { rawBody: V.body.replace("lob_test", "lob_evil") },
      "bad-signature",
    ],
    ["another secret", { secret: "x".repeat(48) }, "bad-signature"],
    ["a missing timestamp", { timestamp: undefined }, "stale-timestamp"],
    ["a non-numeric timestamp", { timestamp: "17672256OO" }, "stale-timestamp"],
  ] as const)("rejects %s", (_, patch, error) => {
    expect(verifyInternalRequest({ ...base, ...patch, nowMs })).toEqual({ ok: false, error });
  });

  it("rejects a timestamp 301 s old or 301 s ahead as stale", () => {
    for (const d of [301, -301]) {
      expect(verifyInternalRequest({ ...base, nowMs: nowMs + d * 1000 })).toEqual({
        ok: false,
        error: "stale-timestamp",
      });
    }
  });

  it("compares in constant time", () => {
    expect(readFileSync(new URL("./hmac.ts", import.meta.url), "utf8")).toContain(
      "timingSafeEqual",
    );
  });
});
