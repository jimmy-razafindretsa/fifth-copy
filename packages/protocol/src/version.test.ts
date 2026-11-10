import { describe, expect, it } from "vitest";
import { envelopeSchema, PROTOCOL_VERSION } from "./index";

describe("version", () => {
  it("is 15 (#133: `host:kick`, reject reason `removed`)", () => {
    expect(PROTOCOL_VERSION).toBe(15);
  });

  it.each([
    ["documented example", { v: PROTOCOL_VERSION, type: "ping" }, true],
    ["v: 1", { v: 1, type: "ping" }, false],
    ["previous version", { v: PROTOCOL_VERSION - 1, type: "ping" }, false],
    ["next version", { v: PROTOCOL_VERSION + 1, type: "ping" }, false],
    ["missing type", { v: PROTOCOL_VERSION }, false],
  ])("envelopeSchema: %s", (_, payload, ok) => {
    expect(envelopeSchema.safeParse(payload).success).toBe(ok);
  });
});
