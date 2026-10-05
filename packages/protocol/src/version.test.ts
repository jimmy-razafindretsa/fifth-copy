import { describe, expect, it } from "vitest";
import { envelopeSchema, PROTOCOL_VERSION } from "./index";

describe("version", () => {
  it("is 2", () => {
    expect(PROTOCOL_VERSION).toBe(2);
  });

  it.each([
    ["documented example", { v: 2, type: "ping" }, true],
    ["v: 1", { v: 1, type: "ping" }, false],
    ["next version", { v: PROTOCOL_VERSION + 1, type: "ping" }, false],
    ["missing type", { v: 2 }, false],
  ])("envelopeSchema: %s", (_, payload, ok) => {
    expect(envelopeSchema.safeParse(payload).success).toBe(ok);
  });
});
