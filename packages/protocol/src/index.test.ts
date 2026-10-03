import { describe, expect, it } from "vitest";
import { envelopeSchema, PROTOCOL_VERSION } from "./index";

// Wiring test: the package resolves and schemas parse at the edge.
describe("@fifth-copy/protocol", () => {
  it("accepts the current version and rejects others", () => {
    expect(envelopeSchema.safeParse({ v: PROTOCOL_VERSION, type: "ping" }).success).toBe(true);
    expect(envelopeSchema.safeParse({ v: PROTOCOL_VERSION + 1, type: "ping" }).success).toBe(false);
  });
});
