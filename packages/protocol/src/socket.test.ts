import { describe, expect, it } from "vitest";
import {
  handshakeAuthSchema,
  memberSchema,
  rejectReasonSchema,
  rosterSchema,
  serverEvents,
  welcomeSchema,
} from "./index";

const member = { desk: 1, name: "Ada", isHost: true };
const welcome = { v: 2, you: 1, room: { code: "KGB-4821", phase: "waiting" }, members: [member] };

describe("socket schemas", () => {
  it.each([
    ["handshake example", handshakeAuthSchema, { v: 2, token: "jwt" }, true],
    ["handshake v: 1", handshakeAuthSchema, { v: 1, token: "jwt" }, false],
    ["handshake missing token", handshakeAuthSchema, { v: 2 }, false],
    ["reject example", rejectReasonSchema, "bad-token", true],
    ["reject wrong enum", rejectReasonSchema, "banned", false],
    ["member example", memberSchema, member, true],
    ["member desk 0", memberSchema, { ...member, desk: 0 }, false],
    ["member missing isHost", memberSchema, { desk: 1, name: "Ada" }, false],
    ["welcome example", welcomeSchema, welcome, true],
    ["welcome v: 1", welcomeSchema, { ...welcome, v: 1 }, false],
    ["welcome missing you", welcomeSchema, { ...welcome, you: undefined }, false],
    [
      "welcome wrong phase",
      welcomeSchema,
      { ...welcome, room: { code: "KGB-4821", phase: "racing" } },
      false,
    ],
    [
      "welcome bad code",
      welcomeSchema,
      { ...welcome, room: { code: "KOB-4821", phase: "waiting" } },
      false,
    ],
    ["roster example", rosterSchema, { v: 2, members: [member] }, true],
    ["roster v: 1", rosterSchema, { v: 1, members: [member] }, false],
    ["roster missing members", rosterSchema, { v: 2 }, false],
  ] as const)("%s", (_, schema, payload, ok) => {
    expect(schema.safeParse(payload).success).toBe(ok);
  });

  it("maps every server event to its schema", () => {
    expect(serverEvents.welcome).toBe(welcomeSchema);
    expect(serverEvents.roster).toBe(rosterSchema);
  });
});
